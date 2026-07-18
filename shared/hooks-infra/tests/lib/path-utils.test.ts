/**
 * Tests for path utility functions
 *
 * These tests are SECURITY-CRITICAL. The path utilities prevent symlink bypass
 * attacks (ME-001) where malicious symlinks could access files outside the project.
 *
 * @module tests/lib/path-utils
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CREDENTIAL_PATTERNS,
  ENV_PATTERNS,
  GIT_PATTERNS,
  SSH_PATTERNS,
  SYSTEM_DIR_PATTERNS,
  hasPathTraversal,
  isPathProtected,
  isProtectedPath,
  isSamePath,
  isWithinProject,
  makeAbsolute,
  makeRelativeToProject,
  normalizePath,
  resolveRealPath,
} from '../../src/lib/path-utils.js';

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a temporary directory for testing
 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'path-utils-test-'));
}

/**
 * Clean up a temporary directory
 */
function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// =============================================================================
// normalizePath TESTS
// =============================================================================

describe('normalizePath', () => {
  describe('basic normalization', () => {
    it('should remove leading ./ prefix', () => {
      expect(normalizePath('./src/file.ts')).toBe('src/file.ts');
      expect(normalizePath('./file.ts')).toBe('file.ts');
    });

    it('should collapse multiple slashes', () => {
      expect(normalizePath('src//file.ts')).toBe('src/file.ts');
      expect(normalizePath('src///lib//file.ts')).toBe('src/lib/file.ts');
    });

    it('should resolve ../ components', () => {
      expect(normalizePath('src/../lib/file.ts')).toBe('lib/file.ts');
      expect(normalizePath('foo/bar/../baz')).toBe('foo/baz');
    });

    it('should handle combinations', () => {
      expect(normalizePath('./foo/../bar/./baz')).toBe('bar/baz');
    });
  });

  describe('edge cases', () => {
    it('should return "." for empty input', () => {
      expect(normalizePath('')).toBe('.');
    });

    it('should handle "." input', () => {
      expect(normalizePath('.')).toBe('.');
    });

    it('should preserve absolute paths', () => {
      expect(normalizePath('/absolute/path')).toBe('/absolute/path');
    });

    it('should handle path that normalizes to root', () => {
      expect(normalizePath('/foo/..')).toBe('/');
    });
  });
});

// =============================================================================
// resolveRealPath TESTS
// =============================================================================

describe('resolveRealPath', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    // Set project dir to temp dir for testing
    process.env['CLAUDE_PROJECT_DIR'] = tempDir;
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
    delete process.env['CLAUDE_PROJECT_DIR'];
  });

  describe('existing files', () => {
    it('should resolve absolute path to existing file', () => {
      const filePath = path.join(tempDir, 'existing.txt');
      fs.writeFileSync(filePath, 'test');

      const resolved = resolveRealPath(filePath);
      expect(resolved).toBe(fs.realpathSync(filePath));
    });

    it('should resolve relative path to existing file', () => {
      const filePath = path.join(tempDir, 'existing.txt');
      fs.writeFileSync(filePath, 'test');

      // Relative to project dir
      const resolved = resolveRealPath('existing.txt');
      expect(resolved).toBe(fs.realpathSync(filePath));
    });
  });

  describe('non-existent files', () => {
    it('should resolve non-existent file in existing directory', () => {
      const resolved = resolveRealPath(path.join(tempDir, 'new-file.txt'));
      expect(resolved).toBe(path.join(fs.realpathSync(tempDir), 'new-file.txt'));
    });

    it('should handle non-existent nested path', () => {
      const resolved = resolveRealPath(path.join(tempDir, 'nonexistent', 'file.txt'));
      // Should return normalized absolute path
      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved).toContain('nonexistent');
    });
  });

  describe('symlink handling - SECURITY CRITICAL', () => {
    it('should resolve symlinks to their targets', () => {
      // Create a real file
      const realFile = path.join(tempDir, 'real-file.txt');
      fs.writeFileSync(realFile, 'content');

      // Create a symlink
      const symlink = path.join(tempDir, 'symlink.txt');
      fs.symlinkSync(realFile, symlink);

      const resolved = resolveRealPath(symlink);
      expect(resolved).toBe(fs.realpathSync(realFile));
    });

    it('should resolve symlinks pointing outside project - ME-001 attack vector', () => {
      // This is the critical security test!
      // Create symlink inside project pointing to /etc/passwd (outside project)
      const symlink = path.join(tempDir, 'evil-link');

      try {
        // Only run if /etc/passwd exists (Unix systems)
        if (fs.existsSync('/etc/passwd')) {
          fs.symlinkSync('/etc/passwd', symlink);

          const resolved = resolveRealPath(symlink);
          // The resolved path should be /etc/passwd, NOT the symlink path
          expect(resolved).toBe('/etc/passwd');
        }
      } catch {
        // Skip on systems where we can't create symlinks or /etc/passwd doesn't exist
      }
    });

    it('should resolve nested symlinks', () => {
      // Create directory structure
      const subdir = path.join(tempDir, 'subdir');
      fs.mkdirSync(subdir);

      const realFile = path.join(subdir, 'real.txt');
      fs.writeFileSync(realFile, 'content');

      // Create symlink to directory
      const symlinkDir = path.join(tempDir, 'link-to-subdir');
      fs.symlinkSync(subdir, symlinkDir);

      const resolved = resolveRealPath(path.join(symlinkDir, 'real.txt'));
      expect(resolved).toBe(fs.realpathSync(realFile));
    });
  });
});


// =============================================================================
// isWithinProject TESTS - SECURITY CRITICAL
// =============================================================================

describe('isWithinProject', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('basic boundary checking', () => {
    it('should return true for file inside project', () => {
      const filePath = path.join(tempDir, 'src', 'file.ts');
      expect(isWithinProject(filePath, tempDir)).toBe(true);
    });

    it('should return true for project root itself', () => {
      expect(isWithinProject(tempDir, tempDir)).toBe(true);
    });

    it('should return false for file outside project', () => {
      expect(isWithinProject('/etc/passwd', tempDir)).toBe(false);
      expect(isWithinProject('/tmp/other-project/file.ts', tempDir)).toBe(false);
    });

    it('should return false for sibling directory', () => {
      // Create a sibling temp dir
      const siblingDir = createTempDir();
      try {
        expect(isWithinProject(siblingDir, tempDir)).toBe(false);
      } finally {
        cleanupTempDir(siblingDir);
      }
    });

    it('should not match directories with similar prefix', () => {
      // /project should not match /project-other
      const projectDir = path.join(tempDir, 'project');
      const otherDir = path.join(tempDir, 'project-other');
      fs.mkdirSync(projectDir);
      fs.mkdirSync(otherDir);

      const fileInOther = path.join(otherDir, 'file.ts');
      expect(isWithinProject(fileInOther, projectDir)).toBe(false);
    });
  });

  describe('symlink bypass prevention - ME-001 SECURITY', () => {
    it('should detect symlink pointing outside project', () => {
      // This is the CRITICAL security test for ME-001
      const symlink = path.join(tempDir, 'evil-symlink');

      try {
        if (fs.existsSync('/etc/passwd')) {
          fs.symlinkSync('/etc/passwd', symlink);

          // The symlink is INSIDE the project, but it POINTS to /etc/passwd
          // isWithinProject MUST return false because the real target is outside
          expect(isWithinProject(symlink, tempDir)).toBe(false);
        }
      } catch {
        // Skip on systems where we can't create symlinks
      }
    });

    it('should allow symlink pointing inside project', () => {
      const realFile = path.join(tempDir, 'real.txt');
      fs.writeFileSync(realFile, 'content');

      const symlink = path.join(tempDir, 'link.txt');
      fs.symlinkSync(realFile, symlink);

      // Both the symlink and target are inside project
      expect(isWithinProject(symlink, tempDir)).toBe(true);
    });

    it('should detect nested symlink attack', () => {
      // Create directory with symlink
      const subdir = path.join(tempDir, 'subdir');
      fs.mkdirSync(subdir);

      try {
        if (fs.existsSync('/etc')) {
          // Symlink subdir/etc -> /etc
          fs.symlinkSync('/etc', path.join(subdir, 'etc'));

          // subdir/etc/passwd looks like it's in project, but resolves to /etc/passwd
          const maliciousPath = path.join(subdir, 'etc', 'passwd');
          expect(isWithinProject(maliciousPath, tempDir)).toBe(false);
        }
      } catch {
        // Skip if can't create symlinks
      }
    });
  });

  describe('relative path handling', () => {
    it('should handle relative paths', () => {
      process.env['CLAUDE_PROJECT_DIR'] = tempDir;
      try {
        expect(isWithinProject('./src/file.ts', tempDir)).toBe(true);
      } finally {
        delete process.env['CLAUDE_PROJECT_DIR'];
      }
    });
  });
});

// =============================================================================
// isProtectedPath TESTS
// =============================================================================

describe('isProtectedPath', () => {
  describe('environment files', () => {
    it('should detect .env file', () => {
      const result = isProtectedPath('.env');
      expect(result.isProtected).toBe(true);
      expect(result.category).toBe('env');
    });

    it('should detect .env.local file', () => {
      const result = isProtectedPath('.env.local');
      expect(result.isProtected).toBe(true);
      expect(result.category).toBe('env');
    });

    it('should detect .env.production file', () => {
      const result = isProtectedPath('.env.production');
      expect(result.isProtected).toBe(true);
      expect(result.category).toBe('env');
    });

    it('should detect .envrc file', () => {
      const result = isProtectedPath('.envrc');
      expect(result.isProtected).toBe(true);
      expect(result.category).toBe('env');
    });

    it('should detect nested env file', () => {
      const result = isProtectedPath('config/.env');
      expect(result.isProtected).toBe(true);
      expect(result.category).toBe('env');
    });
  });

  describe('git internals', () => {
    it('should detect .git directory', () => {
      const result = isProtectedPath('.git/config');
      expect(result.isProtected).toBe(true);
      expect(result.category).toBe('git');
    });

    it('should detect .gitconfig file', () => {
      const result = isProtectedPath('.gitconfig');
      expect(result.isProtected).toBe(true);
      expect(result.category).toBe('git');
    });

    it('should detect nested .git directory', () => {
      const result = isProtectedPath('submodule/.git/HEAD');
      expect(result.isProtected).toBe(true);
      expect(result.category).toBe('git');
    });
  });

  describe('SSH keys and certificates', () => {
    it('should detect SSH private keys', () => {
      expect(isProtectedPath('.ssh/id_rsa').isProtected).toBe(true);
      expect(isProtectedPath('.ssh/id_ed25519').isProtected).toBe(true);
      expect(isProtectedPath('.ssh/id_ecdsa').isProtected).toBe(true);
    });

    it('should detect SSH config files', () => {
      expect(isProtectedPath('.ssh/known_hosts').isProtected).toBe(true);
      expect(isProtectedPath('.ssh/authorized_keys').isProtected).toBe(true);
    });

    it('should detect PEM files', () => {
      expect(isProtectedPath('.ssh/server.pem').isProtected).toBe(true);
    });
  });

  describe('credential files', () => {
    it('should detect AWS credentials', () => {
      const result = isProtectedPath('.aws/credentials');
      expect(result.isProtected).toBe(true);
      expect(result.category).toBe('credential');
    });

    it('should detect npm credentials', () => {
      expect(isProtectedPath('.npmrc').isProtected).toBe(true);
    });

    it('should detect secrets files', () => {
      expect(isProtectedPath('secrets.yml').isProtected).toBe(true);
      expect(isProtectedPath('secrets.yaml').isProtected).toBe(true);
    });

    it('should detect kubernetes config', () => {
      expect(isProtectedPath('.kube/config').isProtected).toBe(true);
    });

    it('should detect docker config', () => {
      expect(isProtectedPath('.docker/config.json').isProtected).toBe(true);
    });
  });

  describe('system directories', () => {
    it('should detect /etc paths', () => {
      const result = isProtectedPath('/etc/passwd');
      expect(result.isProtected).toBe(true);
      expect(result.category).toBe('system');
    });

    it('should detect /usr paths', () => {
      expect(isProtectedPath('/usr/bin/ls').isProtected).toBe(true);
    });

    it('should detect /var paths', () => {
      expect(isProtectedPath('/var/log/syslog').isProtected).toBe(true);
    });

    it('should detect macOS /private paths', () => {
      expect(isProtectedPath('/private/etc/hosts').isProtected).toBe(true);
      expect(isProtectedPath('/private/var/log').isProtected).toBe(true);
    });

    it('should detect /root paths', () => {
      expect(isProtectedPath('/root/.bashrc').isProtected).toBe(true);
    });

    it('should detect /private/tmp paths outside the claude scratchpad', () => {
      expect(isProtectedPath('/private/tmp/other/file.txt').isProtected).toBe(true);
      expect(isProtectedPath('/private/tmp/claude-x/file.txt').isProtected).toBe(true);
    });

    it('should allow the CC harness scratchpad under /private/tmp/claude-<uid>/', () => {
      expect(
        isProtectedPath('/private/tmp/claude-501/-Users-me-proj/abc-123/scratchpad/out.md')
          .isProtected
      ).toBe(false);
    });
  });

  describe('safe paths', () => {
    it('should allow normal source files', () => {
      expect(isProtectedPath('src/index.ts').isProtected).toBe(false);
      expect(isProtectedPath('./lib/utils.js').isProtected).toBe(false);
    });

    it('should allow package files', () => {
      expect(isProtectedPath('package.json').isProtected).toBe(false);
      expect(isProtectedPath('tsconfig.json').isProtected).toBe(false);
    });

    it('should allow documentation', () => {
      expect(isProtectedPath('README.md').isProtected).toBe(false);
      expect(isProtectedPath('docs/guide.md').isProtected).toBe(false);
    });
  });

  describe('symlink bypass detection - SECURITY', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir();
      process.env['CLAUDE_PROJECT_DIR'] = tempDir;
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
      delete process.env['CLAUDE_PROJECT_DIR'];
    });

    it('should detect symlink to protected system file', () => {
      const symlink = path.join(tempDir, 'innocent-looking-file');

      try {
        if (fs.existsSync('/etc/passwd')) {
          fs.symlinkSync('/etc/passwd', symlink);

          // Even though the symlink name looks innocent,
          // isProtectedPath should detect that it points to /etc
          const result = isProtectedPath(symlink);
          expect(result.isProtected).toBe(true);
          expect(result.category).toBe('system');
        }
      } catch {
        // Skip on systems where we can't create symlinks
      }
    });
  });
});

// =============================================================================
// isPathProtected TESTS
// =============================================================================

describe('isPathProtected', () => {
  it('should return boolean true for protected paths', () => {
    expect(isPathProtected('.env')).toBe(true);
    expect(isPathProtected('/etc/passwd')).toBe(true);
  });

  it('should return boolean false for safe paths', () => {
    expect(isPathProtected('src/index.ts')).toBe(false);
    expect(isPathProtected('README.md')).toBe(false);
  });
});

// =============================================================================
// hasPathTraversal TESTS
// =============================================================================

describe('hasPathTraversal', () => {
  it('should detect leading ../', () => {
    expect(hasPathTraversal('../etc/passwd')).toBe(true);
    expect(hasPathTraversal('../../file.txt')).toBe(true);
  });

  it('should detect ../ that escapes', () => {
    // path.normalize resolves foo/../bar to bar, but ../foo stays as ../foo
    expect(hasPathTraversal('../outside/file.txt')).toBe(true);
  });

  it('should not flag safe paths', () => {
    expect(hasPathTraversal('src/file.ts')).toBe(false);
    expect(hasPathTraversal('./src/file.ts')).toBe(false);
    expect(hasPathTraversal('/absolute/path')).toBe(false);
  });

  it('should handle paths that normalize away traversal', () => {
    // foo/../bar normalizes to bar (no traversal)
    expect(hasPathTraversal('foo/../bar')).toBe(false);
  });
});

// =============================================================================
// isSamePath TESTS
// =============================================================================

describe('isSamePath', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    process.env['CLAUDE_PROJECT_DIR'] = tempDir;
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
    delete process.env['CLAUDE_PROJECT_DIR'];
  });

  it('should return true for identical paths', () => {
    const filePath = path.join(tempDir, 'file.txt');
    fs.writeFileSync(filePath, 'test');

    expect(isSamePath(filePath, filePath)).toBe(true);
  });

  it('should return true for symlink and target', () => {
    const realFile = path.join(tempDir, 'real.txt');
    fs.writeFileSync(realFile, 'content');

    const symlink = path.join(tempDir, 'link.txt');
    fs.symlinkSync(realFile, symlink);

    expect(isSamePath(symlink, realFile)).toBe(true);
  });

  it('should return false for different files', () => {
    const file1 = path.join(tempDir, 'file1.txt');
    const file2 = path.join(tempDir, 'file2.txt');
    fs.writeFileSync(file1, 'content1');
    fs.writeFileSync(file2, 'content2');

    expect(isSamePath(file1, file2)).toBe(false);
  });
});

// =============================================================================
// makeRelativeToProject TESTS
// =============================================================================

describe('makeRelativeToProject', () => {
  it('should convert absolute path to relative', () => {
    const projectDir = '/home/user/project';
    const absolutePath = '/home/user/project/src/index.ts';

    expect(makeRelativeToProject(absolutePath, projectDir)).toBe('src/index.ts');
  });

  it('should handle path outside project', () => {
    const projectDir = '/home/user/project';
    const outsidePath = '/home/user/other/file.ts';

    const relative = makeRelativeToProject(outsidePath, projectDir);
    expect(relative).toBe('../other/file.ts');
  });
});

// =============================================================================
// makeAbsolute TESTS
// =============================================================================

describe('makeAbsolute', () => {
  it('should return absolute path unchanged', () => {
    const absolutePath = '/absolute/path/file.ts';
    expect(makeAbsolute(absolutePath)).toBe(absolutePath);
  });

  it('should resolve relative path against project dir', () => {
    const projectDir = '/home/user/project';
    const relativePath = 'src/index.ts';

    expect(makeAbsolute(relativePath, projectDir)).toBe('/home/user/project/src/index.ts');
  });
});

// =============================================================================
// PATTERN EXPORT TESTS
// =============================================================================

describe('pattern exports', () => {
  it('should export ENV_PATTERNS', () => {
    expect(Array.isArray(ENV_PATTERNS)).toBe(true);
    expect(ENV_PATTERNS.length).toBeGreaterThan(0);
    expect(ENV_PATTERNS[0]).toBeInstanceOf(RegExp);
  });

  it('should export GIT_PATTERNS', () => {
    expect(Array.isArray(GIT_PATTERNS)).toBe(true);
    expect(GIT_PATTERNS.length).toBeGreaterThan(0);
  });

  it('should export SSH_PATTERNS', () => {
    expect(Array.isArray(SSH_PATTERNS)).toBe(true);
    expect(SSH_PATTERNS.length).toBeGreaterThan(0);
  });

  it('should export CREDENTIAL_PATTERNS', () => {
    expect(Array.isArray(CREDENTIAL_PATTERNS)).toBe(true);
    expect(CREDENTIAL_PATTERNS.length).toBeGreaterThan(0);
  });

  it('should export SYSTEM_DIR_PATTERNS', () => {
    expect(Array.isArray(SYSTEM_DIR_PATTERNS)).toBe(true);
    expect(SYSTEM_DIR_PATTERNS.length).toBeGreaterThan(0);
  });
});
