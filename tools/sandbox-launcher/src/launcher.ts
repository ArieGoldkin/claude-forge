/**
 * Launcher — provisioning sequenced so a crash is always recoverable.
 *
 * The ordering is the design, and it comes from R1 (#51): a terminating event
 * gives a process ZERO turns afterward, so cleanup scheduled after the work may
 * never execute.
 *
 * ## The record is written BEFORE the sandbox exists
 *
 * An earlier version wrote it after `provision()` resolved, which sounds early
 * but is not: create covers VM boot plus a git clone, tens of seconds, and it is
 * the single longest window in the flow. A crash inside it left a live, billing
 * sandbox whose name lived only in the dead process's memory.
 *
 * So the caller's name is reserved in the registry as `provisioning` first, and
 * only then handed to the provider. A crash anywhere after that leaves a row the
 * reaper can act on. If the reservation itself fails, no sandbox is created at
 * all — refusing to provision is strictly better than provisioning something
 * nothing is tracking.
 *
 * ## What actually bounds cost
 *
 * Not this file. Compute is bounded by the creation `timeoutMs` and storage by
 * `snapshotExpirationMs`, both set at create; explicit `destroy()` is the only
 * thing that removes a sandbox. The layers here are best-effort cleanup on top
 * of those bounds, not a substitute for them.
 *
 * @module launcher
 */

import { randomUUID } from 'node:crypto';
import { addRecord, removeRecord } from '../../../shared/hooks-infra/src/lib/sandbox/registry.js';
import type { SandboxRecord } from '../../../shared/hooks-infra/src/lib/sandbox/types.js';
import {
  type ProvisionOptions,
  type SandboxHandle,
  SandboxNotFoundError,
  type SandboxProvider,
} from './provider.js';

export interface LaunchOptions extends Omit<ProvisionOptions, 'name'> {
  /** Project root whose `.claude/continuity/sandboxes.json` records this sandbox. */
  projectDir: string;
  /** Claude Code session provisioning the sandbox. */
  sessionId: string;
  /** Explicit sandbox name. Generated when omitted. */
  name?: string;
  /** Prefix for the generated name. */
  namePrefix?: string;
}

/** Raised when a sandbox cannot be recorded, so none is created. */
export class RegistryUnavailableError extends Error {
  constructor(name: string) {
    super(`refusing to provision ${name}: the sandbox registry could not be written`);
    this.name = 'RegistryUnavailableError';
  }
}

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Collision-resistant sandbox name.
 *
 * Uses real entropy rather than a timestamp plus a per-instance counter: that
 * scheme collides across processes started in the same millisecond, and because
 * the registry upserts by id, a collision silently deletes the other sandbox's
 * only record.
 */
export function generateSandboxName(prefix = 'adw'): string {
  return `${prefix}-${randomUUID().slice(0, 12)}`;
}

/**
 * Provision a sandbox and record it.
 *
 * The caller owns teardown; prefer {@link withSandbox} unless the sandbox must
 * outlive the current function.
 *
 * @throws {RegistryUnavailableError} if the name cannot be reserved
 */
export async function launch(
  provider: SandboxProvider,
  opts: LaunchOptions
): Promise<SandboxHandle> {
  const { projectDir, sessionId, name, namePrefix, ...provisionOpts } = opts;
  const sandboxName = name ?? generateSandboxName(namePrefix);

  const reserved = await addRecord(projectDir, {
    sandbox_id: sandboxName,
    provider: provider.name,
    created_at: isoNow(),
    // Best available bound until the provider reports the real one. Deliberately
    // pessimistic: it must not make the row look already-expired, or a reaper
    // racing this call could drop it.
    expires_at: new Date(Date.now() + provisionOpts.timeoutMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    session_id: sessionId,
    status: 'provisioning',
  } satisfies SandboxRecord);

  if (!reserved) {
    // The registry is the only durable trace of a sandbox. Without it, creating
    // one produces an orphan nothing can find.
    throw new RegistryUnavailableError(sandboxName);
  }

  const handle = await provider.provision({ ...provisionOpts, name: sandboxName });

  // Upgrade the row with the provider's real expiry. A failure here is not fatal
  // -- the `provisioning` row already makes the sandbox reapable.
  await addRecord(projectDir, {
    sandbox_id: handle.id,
    provider: handle.provider,
    created_at: isoNow(),
    expires_at: handle.expiresAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    session_id: sessionId,
    status: 'running',
  } satisfies SandboxRecord);

  return handle;
}

export interface TeardownResult {
  /** The sandbox is gone at the provider. */
  destroyed: boolean;
  /** The registry row was removed. */
  deregistered: boolean;
}

/**
 * Stop, destroy, and deregister a sandbox.
 *
 * `stop` and `destroy` are attempted independently so a failing `stop` cannot
 * strand a sandbox that `destroy` would have removed. The row is dropped only
 * once the sandbox is genuinely gone; an unreachable provider leaves it in place
 * on purpose so the next reap retries.
 *
 * Returns both facts separately because they can disagree: a sandbox can be
 * destroyed while the registry write fails, and reporting that as plain success
 * hides a row that will never clear.
 */
export async function teardown(
  provider: SandboxProvider,
  handle: SandboxHandle,
  projectDir: string
): Promise<TeardownResult> {
  try {
    await provider.stop(handle);
  } catch (err) {
    // Not-found is fine -- destroy will confirm. Anything else may still be
    // destroyable, so keep going.
    if (!(err instanceof SandboxNotFoundError)) {
      // fall through
    }
  }

  try {
    await provider.destroy(handle);
  } catch (err) {
    // "Already gone" IS the desired end state. Any other error means the sandbox
    // may still be alive and billing, so the row must survive.
    if (!(err instanceof SandboxNotFoundError)) {
      return { destroyed: false, deregistered: false };
    }
  }

  const deregistered = await removeRecord(projectDir, handle.id);
  return { destroyed: true, deregistered };
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
