/**
 * E2E tests for the resilient POSIX shell wrapper script.
 *
 * Tests the wrapper's defense-in-depth behavior:
 * - Valid hook execution through wrapper
 * - Missing dist/ fallback
 * - Missing CLAUDE_PLUGIN_ROOT derivation
 * - Missing hook name fallback
 *
 * @module tests/bin/run-hook-wrapper
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

// `hooks/` — where the wrapper script lives.
const HOOKS_DIR = path.resolve(__dirname, '..', '..');
const WRAPPER_PATH = path.join(HOOKS_DIR, 'bin', 'run-hook-wrapper.sh');

// The PLUGIN root, i.e. the PARENT of hooks/. The wrapper resolves its runner as
// `$CLAUDE_PLUGIN_ROOT/hooks/dist/bin/run-hook.js`, so passing hooks/ here makes
// it look for `hooks/hooks/dist/...`, which does not exist — every test in this
// file was then asserting the "compiled hooks not found" fallback branch rather
// than a real hook execution, and passing, because they only checked
// `continue`. Caught while adding the opt-in gate tests below, which are the
// first here to assert actual handler output.
const PLUGIN_ROOT = path.resolve(HOOKS_DIR, '..');

/**
 * Run the wrapper script with given args and input.
 */
function runWrapper(
  hookName: string,
  input?: string,
  env?: Record<string, string>
): { stdout: string; exitCode: number } {
  const mergedEnv = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    ...env,
  };

  try {
    const cmd = input
      ? `echo '${input.replace(/'/g, "'\\''")}' | sh "${WRAPPER_PATH}" ${hookName}`
      : `sh "${WRAPPER_PATH}" ${hookName}`;

    const stdout = execSync(cmd, {
      env: mergedEnv,
      timeout: 15000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return { stdout: stdout.trim(), exitCode: 0 };
  } catch (error: unknown) {
    // execSync throws on non-zero exit
    const execError = error as { stdout?: Buffer | string; status?: number };
    const stdout = execError.stdout
      ? typeof execError.stdout === 'string'
        ? execError.stdout
        : execError.stdout.toString('utf8')
      : '';
    return { stdout: stdout.trim(), exitCode: execError.status ?? 1 };
  }
}

/**
 * Assert the wrapper actually spawned the runner rather than bailing out early.
 *
 * The wrapper has three pre-execution exits — empty hook name, missing dist/,
 * and the opt-in gate — and all three return JSON with `continue: true`. So a
 * test asserting only `continue` passes whether or not a hook ever ran, which
 * is how every test in this file stayed green while the harness pointed
 * CLAUDE_PLUGIN_ROOT at the wrong directory and took the "compiled hooks not
 * found" path on every invocation. Reverting that harness bug used to fail
 * exactly one of eleven tests. Found by adversarial review of #56, round 2.
 *
 * The bundle-not-found message is the marker: it can only appear when the
 * wrapper gave up before Node.
 */
function expectRanTheHook(stdout: string): Record<string, unknown> {
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  expect(String(parsed['systemMessage'] ?? '')).not.toContain('compiled hooks not found');
  return parsed;
}

describe('run-hook-wrapper.sh', () => {
  it('should execute a valid hook and return JSON', () => {
    const input = JSON.stringify({
      hook_event_name: 'SessionStart',
      source: 'test',
    });

    const { stdout, exitCode } = runWrapper('lifecycle/session-loader', input);

    expect(exitCode).toBe(0);
    expect(stdout).toBeTruthy();

    const parsed = expectRanTheHook(stdout);
    expect(parsed).toHaveProperty('continue');
  });

  // The next two tests deliberately do NOT use expectRanTheHook: an empty hook
  // name and a missing bundle are the wrapper's own pre-execution branches, and
  // asserting the fallback IS the point of them.
  it('should return safe JSON when no hook name provided', () => {
    const { stdout, exitCode } = runWrapper('');

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.continue).toBe(true);
    expect(parsed.suppressOutput).toBe(true);
  });

  it('should return warning JSON when dist/ is missing', () => {
    // Point to a fake plugin root with no dist/
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'wrapper-test-'));
    const binDir = path.join(tmpDir, 'hooks', 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    // Copy the wrapper to temp location
    fs.copyFileSync(WRAPPER_PATH, path.join(binDir, 'run-hook-wrapper.sh'));

    try {
      const { stdout, exitCode } = runWrapper('lifecycle/session-loader', undefined, {
        CLAUDE_PLUGIN_ROOT: tmpDir,
      });

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.continue).toBe(true);
      expect(parsed.systemMessage).toContain('compiled hooks not found');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should derive CLAUDE_PLUGIN_ROOT from script location', () => {
    const input = JSON.stringify({
      hook_event_name: 'SessionStart',
      source: 'test',
    });

    // Run without CLAUDE_PLUGIN_ROOT — wrapper should derive it
    const { stdout, exitCode } = runWrapper('lifecycle/session-loader', input, {
      CLAUDE_PLUGIN_ROOT: '',
    });

    expect(exitCode).toBe(0);
    // The whole point of this test is that derivation found a REAL plugin root.
    // Asserting `continue` alone passed even when derivation was irrelevant
    // because the harness root was wrong anyway.
    const parsed = expectRanTheHook(stdout);
    expect(parsed).toHaveProperty('continue');
  });

  it('should handle unknown hook names gracefully', () => {
    const input = JSON.stringify({
      hook_event_name: 'SessionStart',
      source: 'test',
    });

    const { stdout, exitCode } = runWrapper('nonexistent/hook-name', input);

    expect(exitCode).toBe(0);
    // "Gracefully" means the RUNNER declined an unknown name, not that the
    // wrapper never got there.
    const parsed = expectRanTheHook(stdout);
    expect(parsed['continue']).toBe(true);
  });

  it('should always exit 0', () => {
    // Even with garbage input, should exit 0 — and still reach the runner, so
    // this covers the runner's own bad-input handling rather than the
    // wrapper's bail-out.
    const { stdout, exitCode } = runWrapper('lifecycle/session-loader', 'not json at all');

    expect(exitCode).toBe(0);
    expectRanTheHook(stdout);
  });

  describe('opt-in gate (pre-Node short circuit)', () => {
    // WHY THE GATE IS IN THE SHELL AND NOT IN THE HANDLER.
    //
    // phi-output-redactor checked its env var inside the handler, which is
    // after the process spawn. Measured, opt-in OFF: 25.3ms bare node startup +
    // 8.6ms bundle load + 13.5ms wrapper = 47.4ms per invocation (116ms with 7
    // cores busy), of which the redaction itself is 0.4ms. Claude Code fires
    // MessageDisplay once per MARKDOWN BLOCK, so a ten-paragraph answer cost
    // ~480ms of added display latency on every ctk install, opted in or not.
    // Gating in the shell: 7.1ms. Found by adversarial review of #56.
    //
    // HOW THESE TESTS OBSERVE THE GATE AT ALL. My first attempt asserted that a
    // declined invocation has no `hookSpecificOutput` — and that is VACUOUS,
    // because the handler's own env check produces the identical output when it
    // runs. Deleting the whole `case` block left all 10 tests green (measured).
    // Same defect r1 found in the prototype suite one commit earlier, and I
    // wrote "verified" in this comment before running it.
    //
    // The gate sits BEFORE the wrapper checks that dist/ exists, so pointing
    // CLAUDE_PLUGIN_ROOT at a tree with no compiled bundle separates them
    // deterministically, with no timing assertion:
    //   gate fires  -> plain SAFE_JSON, the runner is never consulted
    //   gate absent -> the "compiled hooks not found" systemMessage
    //
    // MUST-FAIL CONTROL: delete the `case` block and `short-circuits before the
    // wrapper looks for the compiled bundle` fails (measured 2026-07-26).
    const MESSAGE_DISPLAY = JSON.stringify({
      hook_event_name: 'MessageDisplay',
      session_id: 'test',
      index: 0,
      final: true,
      delta: 'Patient SSN 123-45-6789 admitted.',
    });

    it('short-circuits before the wrapper looks for the compiled bundle', () => {
      // The observable that only the gate changes. With no dist/ under the
      // given root, an ungated hook reports "compiled hooks not found"; the
      // gated one never gets that far.
      const noBundle = fs.mkdtempSync(path.join(os.tmpdir(), 'ctk-nobundle-'));
      try {
        const gated = runWrapper('messagedisplay/phi-output-redactor', MESSAGE_DISPLAY, {
          CONTINUITY_PHI_OUTPUT_REDACT: '',
          CLAUDE_PLUGIN_ROOT: noBundle,
        });
        const ungated = runWrapper('lifecycle/session-loader', MESSAGE_DISPLAY, {
          CLAUDE_PLUGIN_ROOT: noBundle,
        });

        expect(JSON.parse(gated.stdout)).toEqual({ continue: true, suppressOutput: true });
        expect(JSON.parse(gated.stdout).systemMessage).toBeUndefined();
        // Sanity: the same missing bundle IS reported for a hook with no gate,
        // so the assertion above is about the gate and not about the fixture.
        expect(JSON.parse(ungated.stdout).systemMessage).toContain('compiled hooks not found');
      } finally {
        fs.rmSync(noBundle, { recursive: true, force: true });
      }
    });

    it('declines without producing a MessageDisplay payload when the opt-in is unset', () => {
      const { stdout, exitCode } = runWrapper(
        'messagedisplay/phi-output-redactor',
        MESSAGE_DISPLAY,
        { CONTINUITY_PHI_OUTPUT_REDACT: '' }
      );

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.continue).toBe(true);
      expect(parsed.hookSpecificOutput).toBeUndefined();
    });

    it('declines when the opt-in is set to something other than "1"', () => {
      for (const value of ['0', 'true', 'yes']) {
        const { stdout } = runWrapper('messagedisplay/phi-output-redactor', MESSAGE_DISPLAY, {
          CONTINUITY_PHI_OUTPUT_REDACT: value,
        });

        expect(JSON.parse(stdout).hookSpecificOutput, `value '${value}'`).toBeUndefined();
      }
    });

    it('STILL REDACTS when the opt-in is set — the gate must not break the feature', () => {
      // The half that matters: a gate that always declines would be the inert
      // handler defect wearing a performance fix's clothing.
      const { stdout, exitCode } = runWrapper(
        'messagedisplay/phi-output-redactor',
        MESSAGE_DISPLAY,
        { CONTINUITY_PHI_OUTPUT_REDACT: '1' }
      );

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.hookSpecificOutput.hookEventName).toBe('MessageDisplay');
      expect(parsed.hookSpecificOutput.displayContent).toBe('Patient SSN [SSN-REDACTED] admitted.');
    });

    it('does not gate hooks that are not opt-in', () => {
      // The gate is a named allowlist, not a blanket env check. A hook absent
      // from the `case` must run regardless of that variable.
      //
      // My first version asserted only `continue === true`, which the GATED
      // path also returns — so widening the case label to include
      // pretool/security-blocker left the whole suite green while ctk's
      // security pre-tool hook was short-circuited for every user who has not
      // opted into PHI redaction. Exactly the risk the wrapper's own comment
      // names. Found by adversarial review of #56, round 2.
      //
      // Inverting the observable used above makes over-gating detectable: with
      // no compiled bundle, an UNGATED hook must still reach the dist/ check
      // and report it. A gated one never gets there.
      const noBundle = fs.mkdtempSync(path.join(os.tmpdir(), 'ctk-nobundle-'));
      try {
        const { stdout, exitCode } = runWrapper(
          'pretool/security-blocker',
          JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }),
          { CONTINUITY_PHI_OUTPUT_REDACT: '', CLAUDE_PLUGIN_ROOT: noBundle }
        );

        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout).systemMessage).toContain('compiled hooks not found');
      } finally {
        fs.rmSync(noBundle, { recursive: true, force: true });
      }
    });
  });
});
