/**
 * Regression tests for lint-checker's JS/TS (biome) path.
 *
 * The defect: hooks.json gates this hook on .ts/.tsx/.js/.py, but the hook
 * only ever handled .py/.pyi. In a TypeScript monorepo every TS edit fired
 * the hook and got silently zero lint -- the flagship validation node
 * validated nothing.
 *
 * Biome fixtures below are copied from real `biome check --reporter=json`
 * output (biome 1.9.4), not invented:
 *   - `location.path` is an object {file}, not a string
 *   - `location.span` is a [startByte, endByte] pair, not row/column
 *   - `format` diagnostics carry a NULL span
 *
 * @module tests/posttool/lint-checker-biome
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyViolations,
  findBiome,
  formatMessage,
  lintChecker,
  normalizeBiomeDiagnostic,
  offsetToRowCol,
  resetBiomeCache,
  resetLinterCache,
  runBiomeCheck,
} from '../../src/posttool/lint-checker.js';
import type { BiomeDiagnostic, LintResults, LintViolation } from '../../src/posttool/lint-checker.js';
import type { HookInput } from '../../src/types.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => 'const x=1\nif (x == 1) { console.log("loose") }\n'),
  };
});

import { execFileSync, execSync } from 'node:child_process';

const mockExecSync = vi.mocked(execSync);
const mockExecFileSync = vi.mocked(execFileSync);

/** Real biome 1.9.4 output shape. */
const BIOME_JSON = JSON.stringify({
  summary: { errors: 2, warnings: 1 },
  diagnostics: [
    {
      category: 'lint/suspicious/noDoubleEquals',
      severity: 'error',
      description: 'Use === instead of ==. == is only allowed when comparing against `null`',
      location: { path: { file: '/repo/src/app.ts' }, span: [16, 18] },
    },
    {
      category: 'lint/suspicious/noConsoleLog',
      severity: 'warning',
      description: "Don't use console.log",
      location: { path: { file: '/repo/src/app.ts' }, span: [24, 44] },
    },
    {
      // The format diagnostic: NULL span. Must not crash normalization.
      category: 'format',
      severity: 'error',
      description: 'Formatter would have printed the following content:',
      location: { path: { file: '/repo/src/app.ts' }, span: null },
    },
  ],
});

function biomeFails(stdout: string) {
  const err = new Error('biome exit 1') as Error & { status: number; stdout: string };
  err.status = 1;
  err.stdout = stdout;
  return err;
}

function createEditInput(filePath: string): HookInput {
  return {
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetBiomeCache();
  resetLinterCache();
});

afterEach(() => {
  resetBiomeCache();
  resetLinterCache();
});

describe('offsetToRowCol', () => {
  it('converts a byte offset to 1-based row/column', () => {
    const content = 'const x=1\nif (x == 1) {}\n';
    // offset 0 -> very start
    expect(offsetToRowCol(content, 0)).toEqual({ row: 1, column: 1 });
    // offset 10 -> start of line 2
    expect(offsetToRowCol(content, 10)).toEqual({ row: 2, column: 1 });
  });

  it('uses UTF-8 byte offsets, not UTF-16 string indices', () => {
    // 'é' is 2 bytes in UTF-8 but 1 JS char. A naive content.slice(offset)
    // would land in the wrong column for any non-ASCII source.
    const content = 'const é = 1\nlet y = 2\n';
    const byteLenFirstLine = Buffer.from('const é = 1', 'utf8').length; // 12 bytes
    expect(offsetToRowCol(content, byteLenFirstLine + 1)).toEqual({ row: 2, column: 1 });
  });

  it('clamps out-of-range offsets instead of throwing', () => {
    expect(() => offsetToRowCol('abc', 9999)).not.toThrow();
    expect(offsetToRowCol('abc', 9999).row).toBe(1);
  });
});

describe('normalizeBiomeDiagnostic', () => {
  const contents = new Map([['/repo/src/app.ts', 'const x=1\nif (x == 1) {}\n']]);

  it('maps biome category -> code and description -> message', () => {
    const diag: BiomeDiagnostic = {
      category: 'lint/style/noVar',
      severity: 'error',
      description: 'Use let or const instead of var.',
      location: { path: { file: '/repo/src/app.ts' }, span: [0, 3] },
    };
    const v = normalizeBiomeDiagnostic(diag, contents);
    expect(v).not.toBeNull();
    expect(v?.code).toBe('lint/style/noVar');
    expect(v?.message).toBe('Use let or const instead of var.');
    expect(v?.filename).toBe('/repo/src/app.ts');
  });

  it('reads the filename from location.path.file (an object, not a string)', () => {
    const diag: BiomeDiagnostic = {
      category: 'lint/style/noVar',
      severity: 'error',
      location: { path: { file: '/repo/x.ts' }, span: [0, 1] },
    };
    expect(normalizeBiomeDiagnostic(diag, contents)?.filename).toBe('/repo/x.ts');
  });

  it('returns null when there is no filename', () => {
    const diag: BiomeDiagnostic = { category: 'lint/style/noVar', severity: 'error' };
    expect(normalizeBiomeDiagnostic(diag, contents)).toBeNull();
  });

  it('survives a null span (the format diagnostic) without throwing', () => {
    const diag: BiomeDiagnostic = {
      category: 'format',
      severity: 'error',
      location: { path: { file: '/repo/src/app.ts' }, span: null },
    };
    expect(() => normalizeBiomeDiagnostic(diag, contents)).not.toThrow();
    expect(normalizeBiomeDiagnostic(diag, contents)?.location).toEqual({ row: 1, column: 1 });
  });
});

describe('classifyViolations — both linters', () => {
  it("treats biome's lint/security/* as security", () => {
    const violations: LintViolation[] = [
      {
        code: 'lint/security/noDangerouslySetInnerHtml',
        message: 'unsafe',
        filename: 'a.tsx',
        location: { row: 1, column: 1 },
      },
      {
        code: 'lint/style/noVar',
        message: 'var',
        filename: 'a.ts',
        location: { row: 1, column: 1 },
      },
    ];
    const c = classifyViolations(violations);
    expect(c.security).toHaveLength(1);
    expect(c.general).toHaveLength(1);
    expect(c.totalCount).toBe(2);
  });

  it("still treats ruff's bandit S-prefix as security (no regression)", () => {
    const violations: LintViolation[] = [
      { code: 'S608', message: 'sql', filename: 'a.py', location: { row: 1, column: 1 } },
      { code: 'E501', message: 'long', filename: 'a.py', location: { row: 1, column: 1 } },
    ];
    const c = classifyViolations(violations);
    expect(c.security).toHaveLength(1);
    expect(c.general).toHaveLength(1);
  });

  it('does not misclassify biome style rules as security', () => {
    // Guard against a naive startsWith('S') colliding with biome categories.
    const violations: LintViolation[] = [
      {
        code: 'lint/suspicious/noDoubleEquals',
        message: '==',
        filename: 'a.ts',
        location: { row: 1, column: 1 },
      },
    ];
    expect(classifyViolations(violations).security).toHaveLength(0);
  });
});

describe('runBiomeCheck', () => {
  it('splits lint violations from format issues', () => {
    mockExecFileSync.mockImplementation(() => {
      throw biomeFails(BIOME_JSON);
    });

    const { violations, formatIssueFiles } = runBiomeCheck('/bin/biome', ['/repo/src/app.ts']);

    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.code)).toEqual([
      'lint/suspicious/noDoubleEquals',
      'lint/suspicious/noConsoleLog',
    ]);
    // the `format` diagnostic becomes a format issue, not a violation
    expect(formatIssueFiles).toEqual(['/repo/src/app.ts']);
  });

  it('returns clean on exit code 0', () => {
    mockExecFileSync.mockReturnValue('' as never);
    expect(runBiomeCheck('/bin/biome', ['/repo/a.ts'])).toEqual({
      violations: [],
      formatIssueFiles: [],
    });
  });

  it('returns clean on unparseable output rather than throwing', () => {
    mockExecFileSync.mockImplementation(() => {
      throw biomeFails('not json');
    });
    expect(() => runBiomeCheck('/bin/biome', ['/repo/a.ts'])).not.toThrow();
    expect(runBiomeCheck('/bin/biome', ['/repo/a.ts']).violations).toEqual([]);
  });
});

describe('findBiome', () => {
  it('prefers the project node_modules/.bin/biome', () => {
    const found = findBiome('/repo');
    expect(found).toBe('/repo/node_modules/.bin/biome');
    // existsSync is mocked true, so PATH lookup must not run
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});

describe('formatMessage — linter-aware format hint', () => {
  it('tells a TS author to run biome, not ruff', () => {
    const results: LintResults = {
      violations: { security: [], general: [], totalCount: 0 },
      formatIssueFiles: ['/repo/src/app.ts'],
      formatter: 'biome',
    };
    const msg = formatMessage(results, 1);
    expect(msg).toContain('biome format --write');
    expect(msg).not.toContain('ruff format');
  });

  it('still tells a Python author to run ruff', () => {
    const results: LintResults = {
      violations: { security: [], general: [], totalCount: 0 },
      formatIssueFiles: ['/repo/a.py'],
      formatter: 'ruff',
    };
    expect(formatMessage(results, 1)).toContain('ruff format');
  });
});

describe('lintChecker handler — the regression', () => {
  it('produces lint output for a .ts edit (previously silent)', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw biomeFails(BIOME_JSON);
    });

    const result = await lintChecker(createEditInput('/repo/src/app.ts'));

    // BEFORE THE FIX: collectPythonFiles filtered .ts out -> outputSilentSuccess()
    // -> this was undefined and every TS edit went unlinted.
    expect(result.systemMessage).toBeDefined();
    expect(result.systemMessage).toContain('biome');
    expect(result.hookSpecificOutput?.additionalContext).toContain('noDoubleEquals');
  });

  it.each(['/repo/a.tsx', '/repo/a.js', '/repo/a.jsx', '/repo/a.mjs', '/repo/a.cjs'])(
    'lints %s',
    async (file) => {
      mockExecFileSync.mockImplementation(() => {
        throw biomeFails(BIOME_JSON);
      });
      const result = await lintChecker(createEditInput(file));
      expect(result.systemMessage).toBeDefined();
    }
  );

  it('stays advisory — never blocks', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw biomeFails(BIOME_JSON);
    });
    const result = await lintChecker(createEditInput('/repo/src/app.ts'));
    expect(result.continue).not.toBe(false);
  });

  it('ignores unrelated extensions', async () => {
    const result = await lintChecker(createEditInput('/repo/README.md'));
    expect(result.systemMessage).toBeUndefined();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});
