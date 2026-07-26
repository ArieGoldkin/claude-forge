/**
 * Tests for permission-profiles library
 *
 * @module tests/lib/permission-profiles
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  type PermissionProfile,
  clearProfileCache,
  evaluatePermission,
  getProfilePath,
  matchesCommandPattern,
  matchesPathPattern,
  matchesToolPattern,
} from '../../src/lib/permission-profiles.js';

// =============================================================================
// TEST DATA
// =============================================================================

const testProfile: PermissionProfile = {
  name: 'test',
  description: 'Test profile',
  auto_approve: {
    tools: ['Read', 'Glob', 'Grep'],
    paths: ['$PROJECT/src/**', '$PROJECT/tests/**', '$PROJECT/*.md'],
    commands: ['ls', 'git status', 'npm list'],
  },
  require_approval: {
    paths: ['$PROJECT/package.json', '$PROJECT/.claude/**'],
    commands: ['npm install', 'git commit', 'git push'],
  },
  deny: {
    paths: ['$PROJECT/.env', '$PROJECT/.env.*', '**/.ssh/**'],
    commands: ['rm -rf /', 'sudo', 'dd if='],
  },
};

const projectDir = '/project';

// =============================================================================
// matchesPathPattern TESTS
// =============================================================================

describe('matchesPathPattern', () => {
  describe('exact matches', () => {
    it('should match exact file paths', () => {
      expect(matchesPathPattern('/project/.env', ['$PROJECT/.env'], projectDir)).toBe(true);
    });

    it('should match with $PROJECT substitution', () => {
      expect(matchesPathPattern('/project/src/index.ts', ['$PROJECT/src/**'], projectDir)).toBe(
        true
      );
    });
  });

  describe('glob patterns', () => {
    it('should match single * patterns', () => {
      expect(matchesPathPattern('/project/README.md', ['$PROJECT/*.md'], projectDir)).toBe(true);
    });

    it('should not match subdirectory with single *', () => {
      expect(matchesPathPattern('/project/docs/README.md', ['$PROJECT/*.md'], projectDir)).toBe(
        false
      );
    });

    it('should match ** recursive patterns', () => {
      expect(
        matchesPathPattern('/project/src/components/Button.tsx', ['$PROJECT/src/**'], projectDir)
      ).toBe(true);
    });

    it('should match deeply nested paths with **', () => {
      expect(
        matchesPathPattern('/project/src/a/b/c/d/file.ts', ['$PROJECT/src/**'], projectDir)
      ).toBe(true);
    });

    // Review !209 finding #2: trailing /** boundary semantics, made explicit.
    // The bare directory node matches (zero segments — deny rules must cover
    // it); sibling names sharing the prefix must NOT match.
    it('should match the bare directory itself with trailing /**', () => {
      expect(matchesPathPattern('/project/src', ['$PROJECT/src/**'], projectDir)).toBe(true);
    });

    it('should not match sibling names sharing the directory prefix', () => {
      expect(matchesPathPattern('/project/srcfoo', ['$PROJECT/src/**'], projectDir)).toBe(false);
      expect(matchesPathPattern('/project/src.bak/x.ts', ['$PROJECT/src/**'], projectDir)).toBe(
        false
      );
    });
  });

  describe('wildcard extensions', () => {
    it('should match .env.* pattern', () => {
      expect(matchesPathPattern('/project/.env.local', ['$PROJECT/.env.*'], projectDir)).toBe(true);
      expect(matchesPathPattern('/project/.env.production', ['$PROJECT/.env.*'], projectDir)).toBe(
        true
      );
    });
  });

  describe('no match', () => {
    it('should return false for non-matching paths', () => {
      expect(matchesPathPattern('/project/other/file.ts', ['$PROJECT/src/**'], projectDir)).toBe(
        false
      );
    });

    it('should return false for empty patterns', () => {
      expect(matchesPathPattern('/project/file.ts', [], projectDir)).toBe(false);
    });

    it('should return false for empty path', () => {
      expect(matchesPathPattern('', ['$PROJECT/**'], projectDir)).toBe(false);
    });
  });

  // Regression: $PROJECT was substituted pre-escaped BEFORE the escape pass,
  // which re-escaped its backslashes — every $PROJECT rule silently never
  // matched when the project path contained a regex-special char (e.g. a
  // dotted dirname like /Users/jane.doe). Found in the CC v2.1.173 audit.
  describe('$PROJECT with regex-special chars in project path (double-escape regression)', () => {
    const dottedDir = '/Users/jane.doe/projects/my-app';

    it('should match $PROJECT/** under a dotted project path', () => {
      expect(matchesPathPattern(`${dottedDir}/src/index.ts`, ['$PROJECT/src/**'], dottedDir)).toBe(
        true
      );
    });

    it('should match $PROJECT/*.md under a dotted project path', () => {
      expect(matchesPathPattern(`${dottedDir}/README.md`, ['$PROJECT/*.md'], dottedDir)).toBe(true);
    });

    it('should still treat the dot in the project path as a literal', () => {
      // 'janeXdoe' must NOT match — the '.' is a literal char, not a regex wildcard
      expect(
        matchesPathPattern(
          '/Users/janeXdoe/projects/my-app/src/index.ts',
          ['$PROJECT/src/**'],
          dottedDir
        )
      ).toBe(false);
    });

    it('should match a project path containing parens', () => {
      const parenDir = '/Users/dev/work (client)/app';
      expect(matchesPathPattern(`${parenDir}/src/main.ts`, ['$PROJECT/src/**'], parenDir)).toBe(
        true
      );
    });

    // Globstar must match ZERO directories (standard glob semantics) — the
    // old '.*' substitution demanded one level, so 'a/**/b.json' never
    // matched the direct child 'a/b.json' (shipped require_approval rules
    // failed open on that shape).
    it('should match zero intermediate directories with **', () => {
      expect(
        matchesPathPattern(
          `${dottedDir}/.claude/settings.json`,
          ['$PROJECT/.claude/**/*.json'],
          dottedDir
        )
      ).toBe(true);
      expect(
        matchesPathPattern(
          `${dottedDir}/.claude/a/b/settings.json`,
          ['$PROJECT/.claude/**/*.json'],
          dottedDir
        )
      ).toBe(true);
      expect(
        matchesPathPattern(
          `${dottedDir}/.claude/settings.yaml`,
          ['$PROJECT/.claude/**/*.json'],
          dottedDir
        )
      ).toBe(false);
    });

    it('should match the shipped default.json rules under a dotted project path', () => {
      // default.json is the live consumer of $PROJECT rules — assert its own
      // shapes match (auto_approve fails safe, but require_approval fails OPEN)
      const defaultJsonAutoApprove = [
        '$PROJECT/src/**',
        '$PROJECT/hooks/**',
        '$PROJECT/*.md',
        '$PROJECT/*.json',
        '$PROJECT/*.ts',
      ];
      const defaultJsonRequireApproval = ['$PROJECT/package.json', '$PROJECT/.claude/**/*.json'];
      expect(
        matchesPathPattern(`${dottedDir}/hooks/src/index.ts`, defaultJsonAutoApprove, dottedDir)
      ).toBe(true);
      expect(
        matchesPathPattern(`${dottedDir}/package.json`, defaultJsonRequireApproval, dottedDir)
      ).toBe(true);
      expect(
        matchesPathPattern(
          `${dottedDir}/.claude/settings.json`,
          defaultJsonRequireApproval,
          dottedDir
        )
      ).toBe(true);
    });
  });
});

// =============================================================================
// matchesCommandPattern TESTS
// =============================================================================

describe('matchesCommandPattern', () => {
  describe('prefix matching', () => {
    it('should match command prefixes', () => {
      expect(matchesCommandPattern('ls -la', ['ls'])).toBe(true);
      expect(matchesCommandPattern('git status', ['git status'])).toBe(true);
      expect(matchesCommandPattern('npm list --depth=0', ['npm list'])).toBe(true);
    });

    it('should match exact commands', () => {
      expect(matchesCommandPattern('ls', ['ls'])).toBe(true);
    });
  });

  describe('compound commands', () => {
    it('should match prefix after &&', () => {
      expect(matchesCommandPattern('cd /path && ls -la', ['ls'])).toBe(true);
    });

    it('should match prefix after space', () => {
      expect(matchesCommandPattern('echo hello && npm install lodash', ['npm install'])).toBe(true);
    });
  });

  describe('dangerous commands', () => {
    it('should match rm -rf /', () => {
      expect(matchesCommandPattern('rm -rf /', ['rm -rf /'])).toBe(true);
    });

    it('should match sudo commands', () => {
      expect(matchesCommandPattern('sudo apt install', ['sudo'])).toBe(true);
    });
  });

  describe('no match', () => {
    it('should return false for non-matching commands', () => {
      expect(matchesCommandPattern('npm test', ['npm install'])).toBe(false);
    });

    it('should return false for empty prefixes', () => {
      expect(matchesCommandPattern('ls', [])).toBe(false);
    });

    it('should return false for empty command', () => {
      expect(matchesCommandPattern('', ['ls'])).toBe(false);
    });
  });
});

// =============================================================================
// matchesToolPattern TESTS
// =============================================================================

describe('matchesToolPattern', () => {
  it('should match tool names', () => {
    expect(matchesToolPattern('Read', ['Read', 'Glob', 'Grep'])).toBe(true);
    expect(matchesToolPattern('Glob', ['Read', 'Glob', 'Grep'])).toBe(true);
  });

  it('should return false for non-matching tools', () => {
    expect(matchesToolPattern('Write', ['Read', 'Glob', 'Grep'])).toBe(false);
  });

  it('should return false for empty tool list', () => {
    expect(matchesToolPattern('Read', [])).toBe(false);
  });

  it('should return false for empty tool name', () => {
    expect(matchesToolPattern('', ['Read'])).toBe(false);
  });
});

// =============================================================================
// evaluatePermission TESTS
// =============================================================================

describe('evaluatePermission', () => {
  describe('deny rules', () => {
    it('should deny .env file access', () => {
      const decision = evaluatePermission(
        testProfile,
        'Write',
        '/project/.env',
        undefined,
        projectDir
      );
      expect(decision).toBe('deny');
    });

    it('should deny .env.local file access', () => {
      const decision = evaluatePermission(
        testProfile,
        'Write',
        '/project/.env.local',
        undefined,
        projectDir
      );
      expect(decision).toBe('deny');
    });

    it('should deny dangerous commands', () => {
      const decision = evaluatePermission(testProfile, 'Bash', undefined, 'rm -rf /', projectDir);
      expect(decision).toBe('deny');
    });

    it('should deny sudo commands', () => {
      const decision = evaluatePermission(
        testProfile,
        'Bash',
        undefined,
        'sudo apt update',
        projectDir
      );
      expect(decision).toBe('deny');
    });
  });

  describe('require_approval rules', () => {
    it('should require approval for package.json', () => {
      const decision = evaluatePermission(
        testProfile,
        'Write',
        '/project/package.json',
        undefined,
        projectDir
      );
      expect(decision).toBe('require_approval');
    });

    it('should require approval for .claude config files', () => {
      const decision = evaluatePermission(
        testProfile,
        'Write',
        '/project/.claude/settings.json',
        undefined,
        projectDir
      );
      expect(decision).toBe('require_approval');
    });

    it('should require approval for npm install', () => {
      const decision = evaluatePermission(
        testProfile,
        'Bash',
        undefined,
        'npm install lodash',
        projectDir
      );
      expect(decision).toBe('require_approval');
    });

    it('should require approval for git commit', () => {
      const decision = evaluatePermission(
        testProfile,
        'Bash',
        undefined,
        'git commit -m "message"',
        projectDir
      );
      expect(decision).toBe('require_approval');
    });
  });

  describe('auto_approve rules', () => {
    it('should auto-approve Read tool', () => {
      const decision = evaluatePermission(testProfile, 'Read', '/some/file', undefined, projectDir);
      expect(decision).toBe('allow');
    });

    it('should auto-approve Glob tool', () => {
      const decision = evaluatePermission(testProfile, 'Glob', undefined, undefined, projectDir);
      expect(decision).toBe('allow');
    });

    it('should auto-approve Grep tool', () => {
      const decision = evaluatePermission(testProfile, 'Grep', undefined, undefined, projectDir);
      expect(decision).toBe('allow');
    });

    it('should auto-approve src files', () => {
      const decision = evaluatePermission(
        testProfile,
        'Write',
        '/project/src/index.ts',
        undefined,
        projectDir
      );
      expect(decision).toBe('allow');
    });

    it('should auto-approve test files', () => {
      const decision = evaluatePermission(
        testProfile,
        'Write',
        '/project/tests/unit.test.ts',
        undefined,
        projectDir
      );
      expect(decision).toBe('allow');
    });

    it('should auto-approve markdown files', () => {
      const decision = evaluatePermission(
        testProfile,
        'Write',
        '/project/README.md',
        undefined,
        projectDir
      );
      expect(decision).toBe('allow');
    });

    it('should auto-approve ls commands', () => {
      const decision = evaluatePermission(testProfile, 'Bash', undefined, 'ls -la', projectDir);
      expect(decision).toBe('allow');
    });

    it('should auto-approve git status', () => {
      const decision = evaluatePermission(testProfile, 'Bash', undefined, 'git status', projectDir);
      expect(decision).toBe('allow');
    });
  });

  describe('no match', () => {
    it('should return null for unmatched operations', () => {
      const decision = evaluatePermission(
        testProfile,
        'CustomTool',
        '/some/random/path',
        undefined,
        projectDir
      );
      expect(decision).toBeNull();
    });

    it('should return null for unmatched commands', () => {
      const decision = evaluatePermission(
        testProfile,
        'Bash',
        undefined,
        'unknown-command',
        projectDir
      );
      expect(decision).toBeNull();
    });
  });

  describe('priority order', () => {
    it('should prioritize deny over auto_approve', () => {
      // Create a profile where .env is both denied and in src/**
      const conflictProfile: PermissionProfile = {
        name: 'conflict',
        auto_approve: {
          paths: ['$PROJECT/**'],
        },
        deny: {
          paths: ['$PROJECT/.env'],
        },
      };

      const decision = evaluatePermission(
        conflictProfile,
        'Write',
        '/project/.env',
        undefined,
        projectDir
      );
      expect(decision).toBe('deny');
    });

    it('should prioritize deny over require_approval', () => {
      const conflictProfile: PermissionProfile = {
        name: 'conflict',
        require_approval: {
          paths: ['$PROJECT/**'],
        },
        deny: {
          paths: ['$PROJECT/.env'],
        },
      };

      const decision = evaluatePermission(
        conflictProfile,
        'Write',
        '/project/.env',
        undefined,
        projectDir
      );
      expect(decision).toBe('deny');
    });

    it('should prioritize require_approval over auto_approve', () => {
      const conflictProfile: PermissionProfile = {
        name: 'conflict',
        auto_approve: {
          paths: ['$PROJECT/**'],
        },
        require_approval: {
          paths: ['$PROJECT/package.json'],
        },
      };

      const decision = evaluatePermission(
        conflictProfile,
        'Write',
        '/project/package.json',
        undefined,
        projectDir
      );
      expect(decision).toBe('require_approval');
    });
  });
});

// =============================================================================
// getProfilePath TESTS
// =============================================================================

describe('getProfilePath', () => {
  it('should return correct path for default profile', () => {
    const path = getProfilePath('/project');
    expect(path).toBe('/project/.claude/permissions/default.json');
  });

  it('should return correct path for named profile', () => {
    const path = getProfilePath('/project', 'strict');
    expect(path).toBe('/project/.claude/permissions/strict.json');
  });
});

// =============================================================================
// CACHE TESTS
// =============================================================================

describe('clearProfileCache', () => {
  afterEach(() => {
    clearProfileCache();
  });

  it('should not throw when clearing cache', () => {
    expect(() => clearProfileCache()).not.toThrow();
  });
});
