/**
 * SessionEnd Hook - Reap sandboxes the happy path failed to clean up.
 *
 * ctk-specific by design: no other plugin has any business knowing about
 * sandboxes, and keeping this out of `shared/hooks-infra/src/hooks/` keeps the
 * shared tree free of the concept entirely.
 *
 * ## What this hook may and may not do
 *
 * It may OBSERVE and REAP. It may never CREATE. ADR-0001 §3 settles the identity
 * question — sandboxed-ADW dispatch is maintainer tooling, not a shipped plugin
 * feature, and ctk installs on machines whose owners hold no cloud account and
 * want none. Because provisioning is structurally absent here, the worst a bug
 * in this file can do is fail to clean something up. It cannot bill anyone.
 *
 * ## Inertness, in the order the gates run
 *
 * 1. No `.claude/continuity/sandboxes.json` → return. One `existsSync`. This is
 *    the state of every installer who has never provisioned a sandbox, which is
 *    to say: essentially all of them.
 * 2. Registry present but empty or corrupt → return.
 * 3. `tools/sandbox-launcher/` not installed → return. So even a hand-crafted
 *    registry file cannot cause a subprocess to run.
 *
 * ## Why the spawn is detached
 *
 * SessionEnd allows this hook 5 seconds (`hooks.json`). A reap needs to reach
 * the provider over the network. Awaiting that inside the budget would get the
 * hook killed partway through cleanup — so the child is spawned detached and
 * unref'd, and outlives the session it was launched from.
 *
 * ## What this hook is NOT
 *
 * It is not a guarantee that no sandbox leaks. It needs a reachable provider and
 * working credentials, and it is racing session shutdown. The actual guarantee
 * is the provider-side creation timeout, which auto-terminates a sandbox with no
 * cooperation from this process — the only mechanism that survives the
 * zero-turns-after-termination behaviour R1 (#51) measured. ctk 2.9.0 shipped an
 * overclaimed guard and a reviewer dismantled it; this is a best-effort net and
 * says so.
 *
 * @module lifecycle/sandbox-reaper
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logDebug, logError, logInfo } from '../lib/logging.js';
import { outputSilentSuccess } from '../lib/output.js';
import { hasRecords } from '../lib/sandbox/registry.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'sandbox-reaper';

/** Maintainer-only launcher. Absent from every plugin install. */
const LAUNCHER_DIR = 'tools/sandbox-launcher';
const LAUNCHER_ENTRY = 'src/reap.ts';
const LAUNCHER_RUNNER = 'node_modules/.bin/tsx';

/**
 * SessionEnd hook - destroys sandboxes left behind by an interrupted session.
 *
 * Always returns outputSilentSuccess() -- SessionEnd hooks cannot block.
 *
 * @param input - Hook input from Claude Code (`source` indicates the end reason)
 * @returns HookResult (always silent success)
 */
export async function sandboxReaper(_input: HookInput): Promise<HookResult> {
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] || '.';

  // Gate 1 -- the installer path. Cheapest possible check, and the only one
  // that runs for the overwhelming majority of sessions.
  if (!hasRecords(projectDir)) {
    return outputSilentSuccess();
  }

  // Gate 2 -- the launcher carries the provider SDK and the credentials. If it
  // is not installed, there is nothing that could act on the registry anyway.
  const launcherDir = path.join(projectDir, LAUNCHER_DIR);
  const entry = path.join(launcherDir, LAUNCHER_ENTRY);
  const runner = path.join(launcherDir, LAUNCHER_RUNNER);

  if (!fs.existsSync(entry) || !fs.existsSync(runner)) {
    logDebug(HOOK_NAME, 'Sandbox records found but launcher is not installed; skipping reap');
    return outputSilentSuccess();
  }

  try {
    const child = spawn(runner, [entry, projectDir], {
      cwd: launcherDir,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    logInfo(HOOK_NAME, 'Detached sandbox reap started');
  } catch (error) {
    // A session must end cleanly even if cleanup cannot start. The provider's
    // creation timeout still terminates anything left behind.
    logError(HOOK_NAME, `Failed to start sandbox reap: ${error}`);
  }

  return outputSilentSuccess();
}

export default sandboxReaper;
