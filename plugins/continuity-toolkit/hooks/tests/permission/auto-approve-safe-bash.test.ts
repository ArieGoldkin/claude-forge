/**
 * Tests for auto-approve-safe-bash hook
 *
 * @module tests/permission/auto-approve-safe-bash
 */

import { describe, expect, it } from 'vitest';
import {
  autoApproveSafeBash,
  containsDangerousPattern,
  getSafePrefix,
  hasEnvVarAssignment,
  hasSafePrefix,
  isExactSafeCommand,
  requiresApproval,
} from '../../src/permission/auto-approve-safe-bash.js';
import type { HookInput } from '../../src/types.js';

// =============================================================================
// TEST HELPERS
// =============================================================================

function createBashInput(command: string, sessionId?: string): HookInput {
  return {
    tool_name: 'Bash',
    tool_input: { command },
    ...(sessionId && { session_id: sessionId }),
  };
}

function createNonBashInput(toolName: string): HookInput {
  return {
    tool_name: toolName as HookInput['tool_name'],
    tool_input: {},
  };
}

// =============================================================================
// containsDangerousPattern TESTS
// =============================================================================

describe('containsDangerousPattern', () => {
  describe('redirect operators', () => {
    it('should detect single redirect >', () => {
      expect(containsDangerousPattern('echo hello > file.txt')).toBe(true);
      expect(containsDangerousPattern('cat foo > bar')).toBe(true);
      expect(containsDangerousPattern('command>output')).toBe(true);
    });

    it('should detect append redirect >>', () => {
      expect(containsDangerousPattern('echo hello >> file.txt')).toBe(true);
      expect(containsDangerousPattern('cat foo >> bar')).toBe(true);
    });
  });

  describe('pipes to dangerous commands', () => {
    it('should detect pipe to rm', () => {
      expect(containsDangerousPattern('find . | rm')).toBe(true);
      expect(containsDangerousPattern('ls |rm')).toBe(true);
      expect(containsDangerousPattern('echo test |  rm')).toBe(true);
    });

    it('should detect pipe to dd', () => {
      expect(containsDangerousPattern('cat file | dd')).toBe(true);
      expect(containsDangerousPattern('echo test |dd')).toBe(true);
    });

    it('should detect pipe to mv', () => {
      expect(containsDangerousPattern('find . | mv')).toBe(true);
      expect(containsDangerousPattern('echo test | mv')).toBe(true);
    });
  });

  describe('subshells', () => {
    it('should detect $() subshell', () => {
      expect(containsDangerousPattern('echo $(whoami)')).toBe(true);
      expect(containsDangerousPattern('rm $(cat files.txt)')).toBe(true);
    });

    it('should detect backtick subshell', () => {
      expect(containsDangerousPattern('echo `whoami`')).toBe(true);
      expect(containsDangerousPattern('rm `cat files.txt`')).toBe(true);
    });
  });

  describe('backgrounding', () => {
    it('should detect & at end', () => {
      expect(containsDangerousPattern('long-command &')).toBe(true);
      expect(containsDangerousPattern('sleep 100&')).toBe(true);
    });

    it('should detect & with trailing space at end', () => {
      expect(containsDangerousPattern('command & ')).toBe(true);
      expect(containsDangerousPattern('command &  ')).toBe(true);
    });
  });

  describe('safe commands', () => {
    it('should not flag safe commands', () => {
      expect(containsDangerousPattern('ls -la')).toBe(false);
      expect(containsDangerousPattern('git status')).toBe(false);
      expect(containsDangerousPattern('cat file.txt')).toBe(false);
      expect(containsDangerousPattern('pwd')).toBe(false);
    });

    it('should not flag pipes to safe commands', () => {
      expect(containsDangerousPattern('cat file | grep pattern')).toBe(false);
      expect(containsDangerousPattern('ls | head -5')).toBe(false);
    });
  });
});

// =============================================================================
// requiresApproval TESTS
// =============================================================================

describe('requiresApproval', () => {
  describe('file modifications', () => {
    it('should require approval for rm', () => {
      expect(requiresApproval('rm file.txt')).toBe(true);
      expect(requiresApproval('rm -rf /tmp/test')).toBe(true);
    });

    it('should require approval for mv', () => {
      expect(requiresApproval('mv old.txt new.txt')).toBe(true);
    });

    it('should require approval for cp', () => {
      expect(requiresApproval('cp source.txt dest.txt')).toBe(true);
    });

    it('should require approval for mkdir', () => {
      expect(requiresApproval('mkdir new-dir')).toBe(true);
    });

    it('should require approval for touch', () => {
      expect(requiresApproval('touch newfile.txt')).toBe(true);
    });

    it('should require approval for chmod', () => {
      expect(requiresApproval('chmod 755 script.sh')).toBe(true);
    });

    it('should require approval for chown', () => {
      expect(requiresApproval('chown user:group file')).toBe(true);
    });

    it('should require approval for ln', () => {
      expect(requiresApproval('ln -s source target')).toBe(true);
    });
  });

  describe('git write operations', () => {
    it('should require approval for git add', () => {
      expect(requiresApproval('git add .')).toBe(true);
      expect(requiresApproval('git add file.txt')).toBe(true);
    });

    it('should require approval for git commit', () => {
      expect(requiresApproval('git commit -m "message"')).toBe(true);
    });

    it('should require approval for git push', () => {
      expect(requiresApproval('git push origin main')).toBe(true);
    });

    it('should require approval for git pull', () => {
      expect(requiresApproval('git pull')).toBe(true);
    });

    it('should require approval for git checkout', () => {
      expect(requiresApproval('git checkout branch')).toBe(true);
    });

    it('should require approval for git merge', () => {
      expect(requiresApproval('git merge feature')).toBe(true);
    });

    it('should require approval for git rebase', () => {
      expect(requiresApproval('git rebase main')).toBe(true);
    });

    it('should require approval for git reset', () => {
      expect(requiresApproval('git reset --hard')).toBe(true);
    });

    it('should require approval for git stash (not list)', () => {
      expect(requiresApproval('git stash')).toBe(true);
      expect(requiresApproval('git stash pop')).toBe(true);
    });

    it('should require approval for git clean', () => {
      expect(requiresApproval('git clean -fd')).toBe(true);
    });
  });

  describe('package installs', () => {
    it('should require approval for npm install', () => {
      expect(requiresApproval('npm install')).toBe(true);
      expect(requiresApproval('npm install lodash')).toBe(true);
    });

    it('should require approval for npm i', () => {
      expect(requiresApproval('npm i lodash')).toBe(true);
    });

    it('should require approval for npm ci', () => {
      expect(requiresApproval('npm ci')).toBe(true);
    });

    it('should require approval for pip install', () => {
      expect(requiresApproval('pip install requests')).toBe(true);
    });

    it('should require approval for poetry install', () => {
      expect(requiresApproval('poetry install')).toBe(true);
    });

    it('should require approval for brew install', () => {
      expect(requiresApproval('brew install git')).toBe(true);
    });
  });

  describe('network operations', () => {
    it('should require approval for curl', () => {
      expect(requiresApproval('curl https://example.com')).toBe(true);
    });

    it('should require approval for wget', () => {
      expect(requiresApproval('wget https://example.com/file')).toBe(true);
    });

    it('should require approval for ssh', () => {
      expect(requiresApproval('ssh user@host')).toBe(true);
    });

    it('should require approval for scp', () => {
      expect(requiresApproval('scp file user@host:/path')).toBe(true);
    });

    it('should require approval for rsync', () => {
      expect(requiresApproval('rsync -av source dest')).toBe(true);
    });
  });

  describe('dangerous system commands', () => {
    it('should require approval for sudo', () => {
      expect(requiresApproval('sudo rm -rf /')).toBe(true);
    });

    it('should require approval for dd', () => {
      expect(requiresApproval('dd if=/dev/zero of=/dev/sda')).toBe(true);
    });

    it('should require approval for mkfs', () => {
      expect(requiresApproval('mkfs.ext4 /dev/sda1')).toBe(true);
    });
  });

  describe('process control', () => {
    it('should require approval for kill', () => {
      expect(requiresApproval('kill 1234')).toBe(true);
    });

    it('should require approval for killall', () => {
      expect(requiresApproval('killall node')).toBe(true);
    });

    it('should require approval for pkill', () => {
      expect(requiresApproval('pkill -f "pattern"')).toBe(true);
    });
  });

  describe('docker operations', () => {
    it('should require approval for docker run', () => {
      expect(requiresApproval('docker run nginx')).toBe(true);
    });

    it('should require approval for docker exec', () => {
      expect(requiresApproval('docker exec container cmd')).toBe(true);
    });

    it('should require approval for docker rm', () => {
      expect(requiresApproval('docker rm container')).toBe(true);
    });

    it('should require approval for docker compose', () => {
      expect(requiresApproval('docker compose up')).toBe(true);
    });
  });

  describe('compound commands', () => {
    it('should detect dangerous prefix after &&', () => {
      expect(requiresApproval('cd /path && rm file')).toBe(true);
    });

    it('should detect dangerous prefix after ;', () => {
      expect(requiresApproval('ls; rm file')).toBe(true);
    });
  });

  describe('safe commands', () => {
    it('should not require approval for safe commands', () => {
      expect(requiresApproval('ls -la')).toBe(false);
      expect(requiresApproval('git status')).toBe(false);
      expect(requiresApproval('pwd')).toBe(false);
      expect(requiresApproval('cat file.txt')).toBe(false);
    });
  });
});

// =============================================================================
// isExactSafeCommand TESTS
// =============================================================================

describe('isExactSafeCommand', () => {
  it('should recognize pwd', () => {
    expect(isExactSafeCommand('pwd')).toBe(true);
  });

  it('should recognize whoami', () => {
    expect(isExactSafeCommand('whoami')).toBe(true);
  });

  it('should recognize id', () => {
    expect(isExactSafeCommand('id')).toBe(true);
  });

  it('should recognize date', () => {
    expect(isExactSafeCommand('date')).toBe(true);
  });

  it('should recognize uptime', () => {
    expect(isExactSafeCommand('uptime')).toBe(true);
  });

  it('should recognize hostname', () => {
    expect(isExactSafeCommand('hostname')).toBe(true);
  });

  it('should not match commands with arguments', () => {
    expect(isExactSafeCommand('pwd -L')).toBe(false);
    expect(isExactSafeCommand('id -u')).toBe(false);
    expect(isExactSafeCommand('date +%Y')).toBe(false);
  });

  it('should not match partial matches', () => {
    expect(isExactSafeCommand('pwdx')).toBe(false);
    expect(isExactSafeCommand('uptime-check')).toBe(false);
  });
});

// =============================================================================
// getSafePrefix and hasSafePrefix TESTS
// =============================================================================

describe('getSafePrefix', () => {
  describe('file listing commands', () => {
    it('should recognize ls', () => {
      expect(getSafePrefix('ls')).toBe('ls');
      expect(getSafePrefix('ls -la')).toBe('ls');
      expect(getSafePrefix('ls -la /path')).toBe('ls');
    });

    it('should recognize tree', () => {
      expect(getSafePrefix('tree')).toBe('tree');
      expect(getSafePrefix('tree -L 2')).toBe('tree');
    });

    it('should recognize find with space', () => {
      expect(getSafePrefix('find . -name "*.ts"')).toBe('find ');
    });

    it('should recognize du', () => {
      expect(getSafePrefix('du -sh .')).toBe('du ');
    });

    it('should recognize df', () => {
      expect(getSafePrefix('df -h')).toBe('df ');
    });
  });

  describe('file reading commands', () => {
    it('should recognize cat', () => {
      expect(getSafePrefix('cat file.txt')).toBe('cat ');
    });

    it('should recognize head', () => {
      expect(getSafePrefix('head -n 10 file.txt')).toBe('head ');
    });

    it('should recognize tail', () => {
      expect(getSafePrefix('tail -f logfile')).toBe('tail ');
    });

    it('should recognize less', () => {
      expect(getSafePrefix('less file.txt')).toBe('less ');
    });

    it('should recognize bat', () => {
      expect(getSafePrefix('bat file.ts')).toBe('bat ');
    });
  });

  describe('search commands', () => {
    it('should recognize grep', () => {
      expect(getSafePrefix('grep pattern file')).toBe('grep ');
    });

    it('should recognize rg (ripgrep)', () => {
      expect(getSafePrefix('rg pattern')).toBe('rg ');
    });

    it('should recognize ag (silver searcher)', () => {
      expect(getSafePrefix('ag pattern')).toBe('ag ');
    });
  });

  describe('git read-only commands', () => {
    it('should recognize git status', () => {
      expect(getSafePrefix('git status')).toBe('git status');
    });

    it('should recognize git log', () => {
      expect(getSafePrefix('git log --oneline')).toBe('git log');
    });

    it('should recognize git diff', () => {
      expect(getSafePrefix('git diff HEAD')).toBe('git diff');
    });

    it('should recognize git show', () => {
      expect(getSafePrefix('git show HEAD')).toBe('git show');
    });

    it('should recognize git branch', () => {
      expect(getSafePrefix('git branch -a')).toBe('git branch');
    });

    it('should recognize git blame', () => {
      expect(getSafePrefix('git blame file.ts')).toBe('git blame');
    });

    it('should recognize git stash list pattern (though require-approval matches first)', () => {
      expect(getSafePrefix('git stash list')).toBe('git stash list');
    });
  });

  describe('system info commands', () => {
    it('should recognize which', () => {
      expect(getSafePrefix('which node')).toBe('which ');
    });

    it('should recognize type', () => {
      // Note: 'ls' prefix matches first due to " ls" pattern in "type ls"
      expect(getSafePrefix('type ls')).toBe('ls');
    });

    it('should recognize type with non-ls argument', () => {
      expect(getSafePrefix('type node')).toBe('type ');
    });

    it('should NOT recognize env (removed for security)', () => {
      expect(getSafePrefix('env')).toBeNull();
    });

    it('should NOT recognize printenv (removed for security)', () => {
      expect(getSafePrefix('printenv')).toBeNull();
    });

    it('should recognize echo', () => {
      expect(getSafePrefix('echo hello')).toBe('echo ');
    });
  });

  describe('package info commands', () => {
    it('should recognize npm list', () => {
      expect(getSafePrefix('npm list')).toBe('npm list');
    });

    it('should recognize npm ls', () => {
      // Note: 'ls' prefix matches first due to " ls" pattern in "npm ls"
      expect(getSafePrefix('npm ls --depth=0')).toBe('ls');
    });

    it('should recognize npm outdated', () => {
      expect(getSafePrefix('npm outdated')).toBe('npm outdated');
    });

    it('should recognize pip list', () => {
      expect(getSafePrefix('pip list')).toBe('pip list');
    });

    it('should recognize pip show', () => {
      expect(getSafePrefix('pip show requests')).toBe('pip show');
    });
  });

  describe('version commands', () => {
    it('should recognize node --version', () => {
      expect(getSafePrefix('node --version')).toBe('node --version');
    });

    it('should recognize node -v', () => {
      expect(getSafePrefix('node -v')).toBe('node -v');
    });

    it('should recognize python --version', () => {
      expect(getSafePrefix('python --version')).toBe('python --version');
    });
  });

  describe('help commands', () => {
    it('should NO LONGER match bare --help (evilcmd -h poisoning fix)', () => {
      // Bare --help/-h were removed from the safe list: getSafePrefix matched
      // them anywhere via includes(), so `evilcmd -h` auto-approved an arbitrary
      // binary. Help on an untrusted binary is not safe → now defers.
      expect(getSafePrefix('npm --help')).toBeNull();
      expect(getSafePrefix('git --help')).toBeNull();
    });

    it('should NO LONGER match bare -h', () => {
      expect(getSafePrefix('npm -h')).toBeNull();
      expect(getSafePrefix('evilcmd -h')).toBeNull();
    });

    it('should recognize man', () => {
      // Note: 'ls' prefix matches first due to " ls" pattern in "man ls"
      expect(getSafePrefix('man ls')).toBe('ls');
    });

    it('should recognize man with non-ls argument', () => {
      expect(getSafePrefix('man grep')).toBe('man ');
    });
  });

  describe('compound commands', () => {
    it('should detect safe prefix after &&', () => {
      expect(getSafePrefix('cd /path && ls -la')).toBe('ls');
    });

    it('should detect safe prefix in middle of command', () => {
      expect(getSafePrefix('something && git status')).toBe('git status');
    });
  });

  describe('no match', () => {
    it('should return null for unknown commands', () => {
      expect(getSafePrefix('unknown-command')).toBeNull();
      expect(getSafePrefix('customtool --arg')).toBeNull();
    });

    it('should return null for dangerous commands', () => {
      expect(getSafePrefix('rm -rf /')).toBeNull();
      expect(getSafePrefix('git push origin main')).toBeNull();
    });
  });
});

describe('hasSafePrefix', () => {
  it('should return true for safe commands', () => {
    expect(hasSafePrefix('ls -la')).toBe(true);
    expect(hasSafePrefix('git status')).toBe(true);
  });

  it('should return false for unsafe commands', () => {
    expect(hasSafePrefix('rm file')).toBe(false);
    expect(hasSafePrefix('unknown')).toBe(false);
  });
});

// =============================================================================
// hasEnvVarAssignment TESTS  (CC v2.1.145 analog — bypass via env var prefix)
// =============================================================================

describe('hasEnvVarAssignment', () => {
  describe('positive cases — must require approval', () => {
    it('detects PATH= prefix before safe command', () => {
      expect(hasEnvVarAssignment('PATH=/tmp ls')).toBe(true);
    });
    it('detects LD_PRELOAD= prefix', () => {
      expect(hasEnvVarAssignment('LD_PRELOAD=/tmp/evil.so cat foo.txt')).toBe(true);
    });
    it('detects IFS= prefix', () => {
      expect(hasEnvVarAssignment('IFS=, grep secret file.txt')).toBe(true);
    });
    it('detects multiple assignments before command', () => {
      expect(hasEnvVarAssignment('PATH=/tmp LD_PRELOAD=x ls')).toBe(true);
    });
    it('detects assignment in second segment of compound', () => {
      expect(hasEnvVarAssignment('cd /path && PATH=/tmp ls')).toBe(true);
    });
    it('detects assignment with non-malicious-looking var (defensive)', () => {
      expect(hasEnvVarAssignment('FOO=bar ls')).toBe(true);
      expect(hasEnvVarAssignment('DEBUG=1 ls')).toBe(true);
    });
    it('detects assignment with empty value', () => {
      expect(hasEnvVarAssignment('PATH= ls')).toBe(true);
    });
  });

  describe('negative cases — must not flag', () => {
    it('returns false for bare commands', () => {
      expect(hasEnvVarAssignment('ls -la')).toBe(false);
      expect(hasEnvVarAssignment('git status')).toBe(false);
      expect(hasEnvVarAssignment('cat file.txt')).toBe(false);
    });
    it('returns false for bare assignment with no following command', () => {
      // Bare `FOO=bar` is not bypass-relevant — it doesn't match a safe
      // prefix anyway, so it already defers to standard permission flow
      expect(hasEnvVarAssignment('FOO=bar')).toBe(false);
    });
    it('returns false for compound without assignment', () => {
      expect(hasEnvVarAssignment('cd /path && ls')).toBe(false);
      expect(hasEnvVarAssignment('ls; git status')).toBe(false);
    });
    it('returns false for equals sign inside an argument', () => {
      expect(hasEnvVarAssignment('grep "key=value" file')).toBe(false);
      expect(hasEnvVarAssignment('echo "a=b"')).toBe(false);
    });
    it('returns false for flag containing equals', () => {
      expect(hasEnvVarAssignment('grep --color=auto pattern file')).toBe(false);
    });
  });
});

// =============================================================================
// autoApproveSafeBash MAIN HOOK TESTS
// =============================================================================

describe('autoApproveSafeBash', () => {
  describe('non-Bash tools', () => {
    it('should return silent success for Write tool', async () => {
      const input = createNonBashInput('Write');
      const result = await autoApproveSafeBash(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should return silent success for Edit tool', async () => {
      const input = createNonBashInput('Edit');
      const result = await autoApproveSafeBash(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should return silent success for Read tool', async () => {
      const input = createNonBashInput('Read');
      const result = await autoApproveSafeBash(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should return silent success for Glob tool', async () => {
      const input = createNonBashInput('Glob');
      const result = await autoApproveSafeBash(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('empty or missing command', () => {
    it('should return silent success for empty command', async () => {
      const input: HookInput = {
        tool_name: 'Bash',
        tool_input: { command: '' },
      };
      const result = await autoApproveSafeBash(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should return silent success for missing command', async () => {
      const input: HookInput = {
        tool_name: 'Bash',
        tool_input: {},
      };
      const result = await autoApproveSafeBash(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('dangerous patterns', () => {
    it('should defer commands with redirect to standard flow', async () => {
      const result = await autoApproveSafeBash(createBashInput('echo hello > file.txt'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should defer commands with subshell to standard flow', async () => {
      const result = await autoApproveSafeBash(createBashInput('echo $(whoami)'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should defer commands with backgrounding to standard flow', async () => {
      const result = await autoApproveSafeBash(createBashInput('sleep 100 &'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('require-approval commands', () => {
    it('should defer rm commands to standard flow', async () => {
      const result = await autoApproveSafeBash(createBashInput('rm file.txt'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should defer git commit to standard flow', async () => {
      const result = await autoApproveSafeBash(createBashInput('git commit -m "message"'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should defer npm install to standard flow', async () => {
      const result = await autoApproveSafeBash(createBashInput('npm install lodash'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should defer curl to standard flow', async () => {
      const result = await autoApproveSafeBash(createBashInput('curl https://example.com'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('rtk proxy prefix (token-optimizing proxy)', () => {
    // When a proxy like rtk (github.com/rtk-ai/rtk) is active, its PreToolUse
    // hook rewrites `git status` → `rtk git status`. Without unwrapping, every
    // proxied read-only command would miss the allowlist and prompt — the
    // regression this block guards against.
    it('should auto-approve rtk-proxied git status', async () => {
      const result = await autoApproveSafeBash(createBashInput('rtk git status'));

      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should auto-approve rtk-proxied ls', async () => {
      const result = await autoApproveSafeBash(createBashInput('rtk ls -la'));

      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should auto-approve rtk-proxied grep', async () => {
      const result = await autoApproveSafeBash(createBashInput('rtk grep -rn foo .'));

      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should auto-approve rtk-proxied git log', async () => {
      const result = await autoApproveSafeBash(createBashInput('rtk git log --oneline'));

      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should still defer rtk-proxied git push (proxy does not launder a write)', async () => {
      const result = await autoApproveSafeBash(createBashInput('rtk git push'));

      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should still defer rtk-proxied rm (dangerous after unwrap)', async () => {
      const result = await autoApproveSafeBash(createBashInput('rtk rm -rf ~'));

      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should auto-approve a compound of two rtk-proxied safe commands', async () => {
      const result = await autoApproveSafeBash(createBashInput('rtk ls && rtk grep foo .'));

      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should defer a compound where a proxied segment requires approval', async () => {
      const result = await autoApproveSafeBash(createBashInput('rtk ls && rtk rm file.txt'));

      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('exact safe commands', () => {
    it('should auto-approve pwd', async () => {
      const result = await autoApproveSafeBash(createBashInput('pwd'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should auto-approve whoami', async () => {
      const result = await autoApproveSafeBash(createBashInput('whoami'));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should auto-approve id', async () => {
      const result = await autoApproveSafeBash(createBashInput('id'));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should auto-approve date', async () => {
      const result = await autoApproveSafeBash(createBashInput('date'));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should auto-approve uptime', async () => {
      const result = await autoApproveSafeBash(createBashInput('uptime'));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should auto-approve hostname', async () => {
      const result = await autoApproveSafeBash(createBashInput('hostname'));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });
  });

  describe('safe prefix commands', () => {
    it('should auto-approve ls commands', async () => {
      const result = await autoApproveSafeBash(createBashInput('ls -la'));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should auto-approve git status', async () => {
      const result = await autoApproveSafeBash(createBashInput('git status'));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should auto-approve git log', async () => {
      const result = await autoApproveSafeBash(createBashInput('git log --oneline -n 10'));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should auto-approve git diff', async () => {
      const result = await autoApproveSafeBash(createBashInput('git diff HEAD'));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should auto-approve cat commands', async () => {
      const result = await autoApproveSafeBash(createBashInput('cat file.txt'));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should auto-approve grep commands', async () => {
      const result = await autoApproveSafeBash(createBashInput('grep pattern file.txt'));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should auto-approve npm list', async () => {
      const result = await autoApproveSafeBash(createBashInput('npm list'));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should auto-approve node --version', async () => {
      const result = await autoApproveSafeBash(createBashInput('node --version'));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should NO LONGER auto-approve bare --help (poisoning fix — defers)', async () => {
      // `npm --help` now defers to a one-time prompt; minor friction in exchange
      // for closing the `evilcmd -h` arbitrary-binary auto-approval.
      const result = await autoApproveSafeBash(createBashInput('npm --help'));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('env/printenv NOT auto-approved', () => {
    it('should NOT auto-approve env', async () => {
      const result = await autoApproveSafeBash(createBashInput('env'));

      expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
    });

    it('should NOT auto-approve printenv', async () => {
      const result = await autoApproveSafeBash(createBashInput('printenv'));

      expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
    });

    it('should NOT auto-approve printenv HOME', async () => {
      const result = await autoApproveSafeBash(createBashInput('printenv HOME'));

      expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
    });

    it('should still auto-approve echo $HOME', async () => {
      const result = await autoApproveSafeBash(createBashInput('echo $HOME'));

      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });
  });

  describe('unrecognized commands', () => {
    it('should defer unknown commands to standard flow', async () => {
      const result = await autoApproveSafeBash(createBashInput('custom-tool --arg'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should handle commands with the prefix in the middle', async () => {
      const result = await autoApproveSafeBash(createBashInput('cd /path && ls -la'));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should detect dangerous prefix in compound command', async () => {
      const result = await autoApproveSafeBash(createBashInput('ls && rm file'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should handle very long commands', async () => {
      const longCommand = `git log --oneline ${'--all '.repeat(100)}`;
      const result = await autoApproveSafeBash(createBashInput(longCommand));

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });
  });

  describe('result structure', () => {
    it('should return correct structure for allow decision', async () => {
      const result = await autoApproveSafeBash(createBashInput('pwd'));

      expect(result).toEqual({
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
        },
      });
    });

    it('should return correct structure for silent success', async () => {
      const result = await autoApproveSafeBash(createBashInput('rm file'));

      expect(result).toEqual({
        continue: true,
        suppressOutput: true,
      });
    });

    it('should produce valid JSON when stringified', async () => {
      const result = await autoApproveSafeBash(createBashInput('git status'));

      expect(() => JSON.stringify(result)).not.toThrow();

      const json = JSON.stringify(result);
      const parsed = JSON.parse(json);

      expect(parsed.continue).toBe(true);
      expect(parsed.hookSpecificOutput.permissionDecision).toBe('allow');
    });
  });

  describe('git stash commands', () => {
    it('should defer git stash list to standard flow (matches git stash prefix)', async () => {
      const result = await autoApproveSafeBash(createBashInput('git stash list'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should defer git stash (without list) to standard flow', async () => {
      const result = await autoApproveSafeBash(createBashInput('git stash'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should defer git stash pop to standard flow', async () => {
      const result = await autoApproveSafeBash(createBashInput('git stash pop'));

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('find -exec / -delete deferral (CC v2.1.113 alignment)', () => {
    // CC v2.1.113 changed Bash(find:*) rules to no longer auto-approve -exec
    // or -delete. Our hook must match — `find` is otherwise safe, but -exec
    // and -delete turn it into a write operation that needs explicit approval.

    it('should NOT auto-approve find with -exec rm', async () => {
      const result = await autoApproveSafeBash(
        createBashInput('find . -name "*.log" -exec rm {} \\;')
      );
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined(); // deferred, not allowed
    });

    it('should NOT auto-approve find with -exec anything', async () => {
      const result = await autoApproveSafeBash(
        createBashInput('find /tmp -type f -exec chmod 600 {} \\;')
      );
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should NOT auto-approve find with -delete', async () => {
      const result = await autoApproveSafeBash(createBashInput('find . -name "*.pyc" -delete'));
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should NOT auto-approve find with long-form --exec (if ever valid)', async () => {
      // Defensive — treat any exec token as unsafe for auto-approval
      const result = await autoApproveSafeBash(createBashInput('find . -execdir rm {} \\;'));
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should still auto-approve plain find (no -exec, no -delete)', async () => {
      const result = await autoApproveSafeBash(createBashInput('find . -name "*.ts"'));
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should still auto-approve find with filter flags but no action', async () => {
      const result = await autoApproveSafeBash(createBashInput('find . -type f -size +1M'));
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should NOT auto-approve find -exec even when embedded in compound', async () => {
      const result = await autoApproveSafeBash(
        createBashInput('cd /tmp && find . -name "*.log" -exec rm {} \\;')
      );
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('env-var assignment deferral (CC v2.1.145 analog)', () => {
    it('should NOT auto-approve PATH= prefix before safe command', async () => {
      const result = await autoApproveSafeBash(createBashInput('PATH=/tmp ls'));
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should NOT auto-approve LD_PRELOAD= prefix', async () => {
      const result = await autoApproveSafeBash(
        createBashInput('LD_PRELOAD=/tmp/evil.so cat foo.txt')
      );
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should NOT auto-approve IFS= prefix', async () => {
      const result = await autoApproveSafeBash(createBashInput('IFS=, grep secret file.txt'));
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should NOT auto-approve compound with env assignment in second segment', async () => {
      const result = await autoApproveSafeBash(createBashInput('cd /path && PATH=/tmp ls'));
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should still auto-approve safe commands without env assignment', async () => {
      const result = await autoApproveSafeBash(createBashInput('ls -la'));
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should not be confused by --color=auto style flags', async () => {
      const result = await autoApproveSafeBash(createBashInput('grep --color=auto pattern file'));
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });
  });
});
