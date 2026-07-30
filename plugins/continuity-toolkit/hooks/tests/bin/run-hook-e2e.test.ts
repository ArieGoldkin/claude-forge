/**
 * E2E subprocess tests for run-hook.ts.
 *
 * Executes the hook runner as a child process to test the full pipeline:
 * stdin → parse → hook lookup → execute → stdout JSON + exit code.
 *
 * Follows the same pattern as run-hook-wrapper.test.ts.
 *
 * @module tests/bin/run-hook-e2e
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const RUN_HOOK_PATH = path.join(PLUGIN_ROOT, 'dist', 'bin', 'run-hook.js');

/**
 * Run the compiled run-hook.js via node with given args and piped input.
 *
 * NOTE: We run the compiled dist/ output rather than the TypeScript source
 * because shared hooks are symlinked from shared/hooks-infra. When tsx
 * resolves symlinks, relative imports (e.g., ../lib/input.js) resolve
 * against the symlink target directory rather than the plugin's src/,
 * causing ERR_MODULE_NOT_FOUND. The bundled dist/ has no such issue.
 */
function runHook(
  hookName: string,
  input?: string,
  env?: Record<string, string>
): { stdout: string; stderr: string; exitCode: number } {
  const args = [RUN_HOOK_PATH];
  if (hookName) {
    args.push(hookName);
  }

  const result = spawnSync('node', args, {
    input: input ?? '',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      ...env,
    },
    timeout: 15000,
    encoding: 'utf8',
  });

  return {
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    exitCode: result.status ?? 1,
  };
}

describe('run-hook.ts E2E', () => {
  it('should execute a known hook and return valid JSON', () => {
    const input = JSON.stringify({
      hook_event_name: 'SessionStart',
      source: 'test',
    });

    const { stdout, exitCode } = runHook('lifecycle/session-loader', input);

    expect(exitCode).toBe(0);
    expect(stdout).toBeTruthy();

    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('continue');
    expect(parsed.continue).toBe(true);
  });

  it('should return exit code 1 when no hook name provided', () => {
    const { exitCode, stderr } = runHook('');

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Usage: run-hook.ts');
  });

  it('should return silent success JSON for unknown hook name', () => {
    const input = JSON.stringify({ tool_name: 'Bash', tool_input: {} });
    const { stdout, exitCode } = runHook('nonexistent/fake-hook', input);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.continue).toBe(true);
    expect(parsed.suppressOutput).toBe(true);
  });

  it('should handle invalid JSON on stdin gracefully', () => {
    const { stdout, exitCode } = runHook('lifecycle/session-loader', 'not json at all');

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('continue');
  });

  it('should handle empty stdin gracefully', () => {
    const { stdout, exitCode } = runHook('lifecycle/session-loader');

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('continue');
  });

  it('should exit 0 and emit a deny decision when security-blocker blocks a dangerous command', () => {
    // #65: the denial is carried by permissionDecision, NOT by continue:false, so
    // the wrapper's exit code is now 0 (run-hook maps `result.continue ? 0 : 1`).
    // The command is still blocked — CC reads the JSON decision, and this is the
    // same shape read-cache has shipped in production all along.
    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    });

    const { stdout, exitCode } = runHook('pretool/security-blocker', input);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.continue).toBe(true);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.stopReason).toBeTruthy();
  });

  it('should always output exactly one line of valid JSON', () => {
    // Test with several different scenarios
    const scenarios = [
      { hook: 'lifecycle/session-loader', input: '{}' },
      { hook: 'nonexistent/hook', input: '{}' },
      { hook: 'lifecycle/session-loader', input: 'garbage' },
    ];

    for (const scenario of scenarios) {
      const { stdout } = runHook(scenario.hook, scenario.input);
      const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
      expect(lines.length).toBe(1);

      // Should be valid JSON
      expect(() => JSON.parse(lines[0] ?? '')).not.toThrow();
    }
  });

  it('should return exit code 0 when security-blocker allows a safe command', () => {
    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
    });

    const { stdout, exitCode } = runHook('pretool/security-blocker', input);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.continue).toBe(true);
  });
});
