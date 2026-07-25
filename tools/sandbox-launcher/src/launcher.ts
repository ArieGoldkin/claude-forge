/**
 * Launcher — provisioning sequenced so a crash is always recoverable.
 *
 * The ordering here is the whole design, and it comes straight out of R1 (#51):
 * a terminating event gives an agent ZERO turns afterward, so any cleanup
 * scheduled after the work may simply never execute. Three consequences:
 *
 * 1. The registry row is written BEFORE the handle is handed to any caller. A
 *    crash between provisioning and first use still leaves a reapable record.
 * 2. Teardown runs in `finally`, so a throwing workload still cleans up.
 * 3. Neither of those survives `SIGKILL`. The provider-side `timeoutMs` does —
 *    it is the actual guarantee; 1 and 2 are best-effort layers above it.
 *
 * @module launcher
 */

import { addRecord, removeRecord } from '../../../shared/hooks-infra/src/lib/sandbox/registry.js';
import type { SandboxRecord } from '../../../shared/hooks-infra/src/lib/sandbox/types.js';
import {
  type ProvisionOptions,
  type SandboxHandle,
  SandboxNotFoundError,
  type SandboxProvider,
} from './provider.js';

export interface LaunchOptions extends ProvisionOptions {
  /** Project root whose `.claude/continuity/sandboxes.json` records this sandbox. */
  projectDir: string;
  /** Claude Code session provisioning the sandbox. */
  sessionId: string;
}

function toRecord(handle: SandboxHandle, sessionId: string, status: SandboxRecord['status']) {
  return {
    sandbox_id: handle.id,
    provider: handle.provider,
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    expires_at: handle.expiresAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    session_id: sessionId,
    status,
  } satisfies SandboxRecord;
}

/**
 * Provision a sandbox and record it.
 *
 * The caller owns teardown. Prefer {@link withSandbox} unless you specifically
 * need a sandbox that outlives the current function.
 */
export async function launch(
  provider: SandboxProvider,
  opts: LaunchOptions
): Promise<SandboxHandle> {
  const { projectDir, sessionId, ...provisionOpts } = opts;
  const handle = await provider.provision(provisionOpts);
  // Registered before return: an exception thrown by any later line still
  // leaves a row the reaper can act on.
  await addRecord(projectDir, toRecord(handle, sessionId, 'running'));
  return handle;
}

/**
 * Stop, destroy, and deregister a sandbox.
 *
 * `stop` and `destroy` are attempted independently so a failing `stop` cannot
 * strand a sandbox that `destroy` would have removed. The registry row is
 * dropped only when the sandbox is genuinely gone — an unreachable provider
 * leaves the row in place on purpose, so the next reap retries it.
 *
 * @returns true if the sandbox was destroyed and deregistered
 */
export async function teardown(
  provider: SandboxProvider,
  handle: SandboxHandle,
  projectDir: string
): Promise<boolean> {
  try {
    await provider.stop(handle);
  } catch {
    // A sandbox that cannot be stopped may still be destroyable.
  }

  try {
    await provider.destroy(handle);
  } catch (err) {
    // "Already gone" IS the desired end state — the provider's creation timeout
    // reaching a sandbox before we did is a success, not a failure. Any other
    // error means the sandbox may still be alive and billing, so keep the row.
    if (!(err instanceof SandboxNotFoundError)) {
      return false;
    }
  }

  await removeRecord(projectDir, handle.id);
  return true;
}

/**
 * Run `fn` against a freshly provisioned sandbox, tearing it down afterwards
 * whether or not `fn` throws.
 */
export async function withSandbox<T>(
  provider: SandboxProvider,
  opts: LaunchOptions,
  fn: (handle: SandboxHandle) => Promise<T>
): Promise<T> {
  const handle = await launch(provider, opts);
  try {
    return await fn(handle);
  } finally {
    await teardown(provider, handle, opts.projectDir);
  }
}
