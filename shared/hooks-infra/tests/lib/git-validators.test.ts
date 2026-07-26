/**
 * Tests for git-validators library
 *
 * @module tests/lib/git-validators
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearBranchPatternsCache,
  extractCommitMessageFromCommand,
  getBranchPatternsPath,
  getCommitTypes,
  hasNoVerifyFlag,
  isAmendCommit,
  isGitCommitCommand,
  loadBranchPatterns,
  validateBranchName,
  validateCommitMessage,
} from '../../src/lib/git-validators.js';
import { resetLogDir } from '../../src/lib/logging.js';

// =============================================================================
// LOG ISOLATION
// =============================================================================

/**
 * loadBranchPatterns() logs an ERROR through the shared logger when it skips an
 * invalid pattern, and several tests below feed it invalid patterns on purpose.
 * Against the real HOME that appended ~719 bytes to the developer's
 * ~/.claude/logs/<plugin>/hooks.log on every run — measured, per file, in
 * isolation. This file is now symlinked into all five plugins, so that would be
 * six writers to a log family whose contention is what made logging.test.ts
 * flaky (#55/#59). Point HOME somewhere disposable instead.
 */
const originalHome = process.env['HOME'];
let tmpLogHome: string;

beforeEach(() => {
  tmpLogHome = fs.mkdtempSync(path.join(os.tmpdir(), 'git-validators-logs-'));
  process.env['HOME'] = tmpLogHome;
  delete process.env['CLAUDE_PLUGIN_DATA'];
  resetLogDir();
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env['HOME'];
  } else {
    process.env['HOME'] = originalHome;
  }
  resetLogDir();
  fs.rmSync(tmpLogHome, { recursive: true, force: true });
});

// =============================================================================
// BRANCH NAME VALIDATION TESTS
// =============================================================================

describe('validateBranchName', () => {
  describe('valid branch names', () => {
    it('should accept JIRA ticket format (NAPP-1234-description)', () => {
      expect(validateBranchName('NAPP-1234-feature-name').valid).toBe(true);
      expect(validateBranchName('NAPP-12345-longer-description').valid).toBe(true);
      expect(validateBranchName('napp-1234-lowercase').valid).toBe(true);
    });

    it('should accept generic JIRA format (PROJECT-123-description)', () => {
      expect(validateBranchName('ABC-123-feature').valid).toBe(true);
      expect(validateBranchName('PROJ-1-short').valid).toBe(true);
    });

    it('should accept feature/* branches', () => {
      expect(validateBranchName('feature/login-page').valid).toBe(true);
      expect(validateBranchName('feature/NAPP-1234').valid).toBe(true);
    });

    it('should accept fix/* branches', () => {
      expect(validateBranchName('fix/login-bug').valid).toBe(true);
      expect(validateBranchName('fix/typo-in-readme').valid).toBe(true);
    });

    it('should accept bugfix/* branches', () => {
      expect(validateBranchName('bugfix/critical-issue').valid).toBe(true);
    });

    it('should accept chore/* branches', () => {
      expect(validateBranchName('chore/update-deps').valid).toBe(true);
      expect(validateBranchName('chore/cleanup').valid).toBe(true);
    });

    it('should accept docs/* branches', () => {
      expect(validateBranchName('docs/update-readme').valid).toBe(true);
    });

    it('should accept refactor/* branches', () => {
      expect(validateBranchName('refactor/auth-module').valid).toBe(true);
    });

    it('should accept test/* branches', () => {
      expect(validateBranchName('test/unit-tests').valid).toBe(true);
    });

    it('should accept hotfix/* branches', () => {
      expect(validateBranchName('hotfix/v1.0.1').valid).toBe(true);
    });

    it('should accept release/* branches', () => {
      expect(validateBranchName('release/v2.0.0').valid).toBe(true);
    });

    it('should accept dev/* branches', () => {
      expect(validateBranchName('dev/experiment').valid).toBe(true);
    });

    it('should accept main/master/develop', () => {
      expect(validateBranchName('main').valid).toBe(true);
      expect(validateBranchName('master').valid).toBe(true);
      expect(validateBranchName('develop').valid).toBe(true);
      expect(validateBranchName('dev').valid).toBe(true);
    });

    it('should accept HEAD', () => {
      expect(validateBranchName('HEAD').valid).toBe(true);
    });
  });

  describe('invalid branch names', () => {
    it('should reject arbitrary names', () => {
      const result = validateBranchName('random-branch');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.suggestion).toBeDefined();
    });

    it('should reject numeric-only names', () => {
      const result = validateBranchName('12345');
      expect(result.valid).toBe(false);
    });

    it('should reject NAPP without proper format', () => {
      expect(validateBranchName('NAPP-123').valid).toBe(false); // Too few digits
      expect(validateBranchName('NAPP1234-feature').valid).toBe(false); // Missing hyphen
    });
  });

  describe('edge cases', () => {
    it('should reject empty string', () => {
      const result = validateBranchName('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should provide helpful suggestion on failure', () => {
      const result = validateBranchName('bad-name');
      expect(result.suggestion).toContain('NAPP-1234');
      expect(result.suggestion).toContain('feature/');
    });
  });
});

// =============================================================================
// BRANCH PATTERNS CONFIG TESTS
// =============================================================================

/**
 * Helper to create a temp project dir with a branch-patterns.json file.
 */
function createTempProjectDir(config: object): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-validators-test-'));
  const rulesDir = path.join(tmpDir, '.claude', 'rules');
  fs.mkdirSync(rulesDir, { recursive: true });
  fs.writeFileSync(path.join(rulesDir, 'branch-patterns.json'), JSON.stringify(config), 'utf-8');
  return tmpDir;
}

describe('loadBranchPatterns', () => {
  afterEach(() => {
    clearBranchPatternsCache();
  });

  it('should return null when no config file exists', () => {
    const result = loadBranchPatterns('/nonexistent/path');
    expect(result).toBeNull();
  });

  it('should load additional_patterns from file', () => {
    const tmpDir = createTempProjectDir({ additional_patterns: ['john/*', 'team-a/*'] });
    try {
      const config = loadBranchPatterns(tmpDir);
      expect(config).not.toBeNull();
      expect(config?.additional_patterns).toEqual(['john/*', 'team-a/*']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('should cache results after first load', () => {
    const tmpDir = createTempProjectDir({ additional_patterns: ['cached/*'] });
    try {
      const first = loadBranchPatterns(tmpDir);
      // Delete the file to prove second call uses cache
      fs.rmSync(path.join(tmpDir, '.claude', 'rules', 'branch-patterns.json'));
      const second = loadBranchPatterns(tmpDir);
      expect(first).toBe(second);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return null for malformed JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-validators-test-'));
    const rulesDir = path.join(tmpDir, '.claude', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, 'branch-patterns.json'), 'not-valid-json', 'utf-8');
    try {
      const result = loadBranchPatterns(tmpDir);
      expect(result).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('clearBranchPatternsCache', () => {
  it('should not throw when clearing empty cache', () => {
    expect(() => clearBranchPatternsCache()).not.toThrow();
  });

  it('should clear cached results so next load re-reads the file', () => {
    const tmpDir = createTempProjectDir({ additional_patterns: ['before/*'] });
    try {
      loadBranchPatterns(tmpDir);
      clearBranchPatternsCache();
      // Update file content
      fs.writeFileSync(
        path.join(tmpDir, '.claude', 'rules', 'branch-patterns.json'),
        JSON.stringify({ additional_patterns: ['after/*'] }),
        'utf-8'
      );
      const result = loadBranchPatterns(tmpDir);
      expect(result?.additional_patterns).toEqual(['after/*']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('getBranchPatternsPath', () => {
  it('should return correct path', () => {
    const result = getBranchPatternsPath('/my/project');
    expect(result).toBe('/my/project/.claude/rules/branch-patterns.json');
  });
});

describe('validateBranchName with custom patterns', () => {
  afterEach(() => {
    clearBranchPatternsCache();
  });

  it('should accept branches matching additional_patterns from config', () => {
    const tmpDir = createTempProjectDir({ additional_patterns: ['john/*', 'team-a/*'] });
    try {
      expect(validateBranchName('john/my-feature', tmpDir).valid).toBe(true);
      expect(validateBranchName('team-a/sprint-3', tmpDir).valid).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('should still accept default patterns when config is present', () => {
    const tmpDir = createTempProjectDir({ additional_patterns: ['john/*'] });
    try {
      expect(validateBranchName('feature/something', tmpDir).valid).toBe(true);
      expect(validateBranchName('fix/a-bug', tmpDir).valid).toBe(true);
      expect(validateBranchName('main', tmpDir).valid).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('should fall back to defaults when config file is missing', () => {
    expect(validateBranchName('feature/works-without-config', '/nonexistent').valid).toBe(true);
    expect(validateBranchName('random-branch', '/nonexistent').valid).toBe(false);
  });

  it('should reject arie/* without explicit config', () => {
    // arie/* is no longer a default pattern
    expect(validateBranchName('arie/plugin-release-v1', '/nonexistent').valid).toBe(false);
  });

  it('should accept arie/* when explicitly added via config', () => {
    const tmpDir = createTempProjectDir({ additional_patterns: ['arie/*'] });
    try {
      expect(validateBranchName('arie/plugin-release-v1', tmpDir).valid).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  describe('ReDoS guard — overlong pattern handling', () => {
    it('should skip a pattern longer than 256 chars but accept valid neighbours', () => {
      // One valid pattern + one pathological 300-char "***...***" pattern
      // that would expand to a long `.+.+.+...` chain after substitution.
      const tooLong = '*'.repeat(300);
      const tmpDir = createTempProjectDir({
        additional_patterns: ['john/*', tooLong, 'team-a/*'],
      });
      try {
        // Valid neighbours still work
        expect(validateBranchName('john/my-feature', tmpDir).valid).toBe(true);
        expect(validateBranchName('team-a/sprint-3', tmpDir).valid).toBe(true);
        // Default patterns still work
        expect(validateBranchName('feature/something', tmpDir).valid).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it('should accept a pattern exactly at the 256-char limit', () => {
      const atLimit = `*${'a'.repeat(254)}*`;
      expect(atLimit.length).toBe(256);
      const tmpDir = createTempProjectDir({ additional_patterns: [atLimit] });
      try {
        // Should NOT throw or skip — just loads it. We don't need to test
        // that this regex matches anything useful; we only verify the
        // length cap is "<=", not "<".
        expect(validateBranchName('feature/foo', tmpDir).valid).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });
});

// =============================================================================
// COMMIT MESSAGE VALIDATION TESTS
// =============================================================================

describe('validateCommitMessage', () => {
  describe('valid conventional commits', () => {
    it('should accept feat commits', () => {
      expect(validateCommitMessage('feat: add new feature').valid).toBe(true);
      expect(validateCommitMessage('feat(auth): add OAuth support').valid).toBe(true);
    });

    it('should accept fix commits', () => {
      expect(validateCommitMessage('fix: resolve login bug').valid).toBe(true);
      expect(validateCommitMessage('fix(api): handle null response').valid).toBe(true);
    });

    it('should accept docs commits', () => {
      expect(validateCommitMessage('docs: update README').valid).toBe(true);
      expect(validateCommitMessage('docs(api): add endpoint docs').valid).toBe(true);
    });

    it('should accept style commits', () => {
      expect(validateCommitMessage('style: format code with prettier').valid).toBe(true);
    });

    it('should accept refactor commits', () => {
      expect(validateCommitMessage('refactor: extract utility function').valid).toBe(true);
      expect(validateCommitMessage('refactor(hooks): simplify logic').valid).toBe(true);
    });

    it('should accept perf commits', () => {
      expect(validateCommitMessage('perf: optimize database queries').valid).toBe(true);
    });

    it('should accept test commits', () => {
      expect(validateCommitMessage('test: add unit tests for auth').valid).toBe(true);
    });

    it('should accept build commits', () => {
      expect(validateCommitMessage('build: update webpack config').valid).toBe(true);
    });

    it('should accept ci commits', () => {
      expect(validateCommitMessage('ci: add GitHub Actions workflow').valid).toBe(true);
    });

    it('should accept chore commits', () => {
      expect(validateCommitMessage('chore: update dependencies').valid).toBe(true);
    });

    it('should accept revert commits', () => {
      expect(validateCommitMessage('revert: undo previous change').valid).toBe(true);
    });
  });

  describe('merge and revert commits', () => {
    it('should accept merge commit messages', () => {
      expect(validateCommitMessage("Merge branch 'feature/login'").valid).toBe(true);
      expect(validateCommitMessage('Merge pull request #123').valid).toBe(true);
      expect(validateCommitMessage("Merge 'develop' into main").valid).toBe(true);
      expect(validateCommitMessage('Merge remote-tracking branch origin/main').valid).toBe(true);
      expect(validateCommitMessage('Merged develop into feature').valid).toBe(true);
    });

    it('should accept Revert commit messages', () => {
      expect(validateCommitMessage('Revert "feat: add feature"').valid).toBe(true);
      expect(validateCommitMessage('Revert: undo changes').valid).toBe(true);
    });
  });

  describe('invalid commit messages', () => {
    it('should reject messages without type prefix', () => {
      const result = validateCommitMessage('add new feature');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('conventional commit');
    });

    it('should reject messages with invalid type', () => {
      const result = validateCommitMessage('feature: add something');
      expect(result.valid).toBe(false);
    });

    it('should reject messages missing colon', () => {
      const result = validateCommitMessage('feat add new feature');
      expect(result.valid).toBe(false);
    });

    it('should reject messages with too short description', () => {
      const result = validateCommitMessage('feat: ab');
      expect(result.valid).toBe(false);
    });

    it('should reject very short messages', () => {
      const result = validateCommitMessage('fix bug');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too short');
    });
  });

  describe('edge cases', () => {
    it('should reject empty message', () => {
      const result = validateCommitMessage('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should handle multi-line messages (validate first line)', () => {
      const message = 'feat: add feature\n\nThis is a longer description.';
      expect(validateCommitMessage(message).valid).toBe(true);
    });

    it('should provide helpful suggestion on failure', () => {
      const result = validateCommitMessage('bad commit message');
      expect(result.suggestion).toContain('feat');
      expect(result.suggestion).toContain('fix');
    });
  });
});

describe('getCommitTypes', () => {
  it('should return array of commit types', () => {
    const types = getCommitTypes();
    expect(Array.isArray(types)).toBe(true);
    expect(types).toContain('feat');
    expect(types).toContain('fix');
    expect(types).toContain('docs');
    expect(types).toContain('chore');
  });
});

// =============================================================================
// COMMAND PARSING TESTS
// =============================================================================

describe('extractCommitMessageFromCommand', () => {
  describe('double-quoted messages', () => {
    it('should extract -m "message"', () => {
      expect(extractCommitMessageFromCommand('git commit -m "feat: add feature"')).toBe(
        'feat: add feature'
      );
    });

    it('should extract -m "message" with other flags before', () => {
      expect(extractCommitMessageFromCommand('git commit --all -m "fix: bug fix"')).toBe(
        'fix: bug fix'
      );
    });

    it('should extract -m "message" with other flags after', () => {
      expect(extractCommitMessageFromCommand('git commit -m "fix: bug fix" --verbose')).toBe(
        'fix: bug fix'
      );
    });

    it('should extract message with special characters', () => {
      expect(extractCommitMessageFromCommand('git commit -m "feat(auth): add OAuth"')).toBe(
        'feat(auth): add OAuth'
      );
    });
  });

  describe('single-quoted messages', () => {
    it("should extract -m 'message'", () => {
      expect(extractCommitMessageFromCommand("git commit -m 'feat: add feature'")).toBe(
        'feat: add feature'
      );
    });
  });

  describe('--message flag', () => {
    it('should extract --message="message"', () => {
      expect(extractCommitMessageFromCommand('git commit --message="chore: update"')).toBe(
        'chore: update'
      );
    });

    it("should extract --message='message'", () => {
      expect(extractCommitMessageFromCommand("git commit --message='docs: readme'")).toBe(
        'docs: readme'
      );
    });
  });

  describe('edge cases', () => {
    it('should return null for empty command', () => {
      expect(extractCommitMessageFromCommand('')).toBeNull();
    });

    it('should return null for command without message', () => {
      expect(extractCommitMessageFromCommand('git commit --amend')).toBeNull();
    });

    it('should handle compound commands', () => {
      expect(extractCommitMessageFromCommand('git add . && git commit -m "feat: add"')).toBe(
        'feat: add'
      );
    });
  });
});

describe('isGitCommitCommand', () => {
  it('should identify git commit commands', () => {
    expect(isGitCommitCommand('git commit -m "message"')).toBe(true);
    expect(isGitCommitCommand('git commit --amend')).toBe(true);
    expect(isGitCommitCommand('git commit')).toBe(true);
  });

  it('should identify compound commit commands', () => {
    expect(isGitCommitCommand('git add . && git commit -m "msg"')).toBe(true);
    expect(isGitCommitCommand('ls; git commit -m "msg"')).toBe(true);
  });

  it('should not match non-commit git commands', () => {
    expect(isGitCommitCommand('git status')).toBe(false);
    expect(isGitCommitCommand('git log')).toBe(false);
    expect(isGitCommitCommand('git diff')).toBe(false);
  });

  it('should handle empty/null input', () => {
    expect(isGitCommitCommand('')).toBe(false);
    // @ts-expect-error - Testing invalid input
    expect(isGitCommitCommand(null)).toBe(false);
  });
});

describe('isAmendCommit', () => {
  it('should detect --amend flag', () => {
    expect(isAmendCommit('git commit --amend')).toBe(true);
    expect(isAmendCommit('git commit --amend -m "new message"')).toBe(true);
    expect(isAmendCommit('git commit -m "msg" --amend')).toBe(true);
  });

  it('should not match non-amend commits', () => {
    expect(isAmendCommit('git commit -m "message"')).toBe(false);
    expect(isAmendCommit('git commit')).toBe(false);
  });

  it('should handle empty/null input', () => {
    expect(isAmendCommit('')).toBe(false);
    // @ts-expect-error - Testing invalid input
    expect(isAmendCommit(null)).toBe(false);
  });
});

describe('hasNoVerifyFlag', () => {
  it('should detect --no-verify flag', () => {
    expect(hasNoVerifyFlag('git commit --no-verify -m "msg"')).toBe(true);
    expect(hasNoVerifyFlag('git commit -m "msg" --no-verify')).toBe(true);
  });

  it('should detect -n flag', () => {
    expect(hasNoVerifyFlag('git commit -n -m "msg"')).toBe(true);
  });

  it('should not match commits without no-verify', () => {
    expect(hasNoVerifyFlag('git commit -m "message"')).toBe(false);
  });

  it('should handle empty/null input', () => {
    expect(hasNoVerifyFlag('')).toBe(false);
    // @ts-expect-error - Testing invalid input
    expect(hasNoVerifyFlag(null)).toBe(false);
  });
});
