/**
 * Reaper — destroys sandboxes the happy path failed to clean up.
 *
 * Recovery for the failure R1 (#51) measured: a terminating event gives a
 * process ZERO turns afterward, so `finally` blocks may never run. Whatever they
 * miss shows up here as a leftover registry row.
 *
 * Best-effort, and the framing matters. It needs a reachable provider and working
 * credentials. It is not what stops a sandbox costing money — compute is bounded
 * by the creation timeout and storage by the snapshot expiration, both set at
 * create time. Do not describe this as a completeness proof.
 *
 * ## Why there is no longer an "expired" shortcut
 *
 * An earlier version dropped any row whose `expires_at` had passed when destroy
 * failed, reasoning the provider must already have terminated it. Two things were
 * wrong. `expires_at` bounds a SESSION, not the sandbox — a timed-out sandbox
 * still exists and its snapshot still bills. And the value was a client-side
 * guess, wrong whenever the plan clamped the timeout or a session was resumed. A
 * harness demonstrated the consequence: a live, undeleted sandbox whose only
 * record had been deleted.
 *
 * A row is now dropped only when the provider itself confirms the sandbox is
 * gone. "Unreachable" is never treated as "absent".
 *
 * @module reap
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRegistry, removeRecord } from '../../../shared/hooks-infra/src/lib/sandbox/registry.js';
import { teardown } from './launcher.js';
import type { SandboxProvider } from './provider.js';

export interface ReapOptions {
  projectDir: string;
  /** Provider implementations keyed by the `provider` field of a record. */
  providers: Map<string, SandboxProvider>;
  /**
   * Only reap rows belonging to this session.
   *
   * Omit to reap everything, which is correct for a maintainer running cleanup
   * by hand but NOT for anything automatic: two sessions can share a project, and
   * an unscoped reap destroys the other session's in-flight sandbox.
   */
  sessionId?: string;
}

export interface ReapResult {
  /** Destroyed (or confirmed already gone) and deregistered. */
  reaped: string[];
  /** Rows left in place — provider unreachable or sandbox still alive. */
  failed: string[];
  /** Destroyed at the provider, but the registry row could not be removed. */
  orphanedRows: string[];
  /** Rows left in place because no implementation is registered for them. */
  unknownProvider: string[];
  /** Rows skipped because they belong to another session. */
  skipped: string[];
}

/**
 * Destroy every sandbox recorded in the registry (optionally scoped to one
 * session).
 */
export async function reap(opts: ReapOptions): Promise<ReapResult> {
  const { projectDir, providers, sessionId } = opts;

  const result: ReapResult = {
    reaped: [],
    failed: [],
    orphanedRows: [],
    unknownProvider: [],
    skipped: [],
  };

  for (const record of readRegistry(projectDir)) {
    if (sessionId !== undefined && record.session_id !== sessionId) {
      result.skipped.push(record.sandbox_id);
      continue;
    }

    const provider = providers.get(record.provider);
    if (!provider) {
      // Keep the row: dropping it strands a real sandbox with no trace.
      result.unknownProvider.push(record.sandbox_id);
      continue;
    }

    const handle = {
      id: record.sandbox_id,
      provider: record.provider,
      expiresAt: new Date(record.expires_at),
    };

    const { destroyed, deregistered } = await teardown(provider, handle, projectDir);

    if (destroyed && deregistered) {
      result.reaped.push(record.sandbox_id);
      continue;
    }

    if (destroyed) {
      // Gone at the provider but the row survives -- it will be retried, and
      // meanwhile it keeps the reaper looking like it has work to do.
      result.orphanedRows.push(record.sandbox_id);
      continue;
    }

    // Destroy failed. Ask the provider whether the sandbox is actually gone
    // before touching the row. Only an authoritative "no" justifies dropping the
    // last record of something that might still be running.
    try {
      if (!(await provider.exists(handle))) {
        const removed = await removeRecord(projectDir, record.sandbox_id);
        (removed ? result.reaped : result.orphanedRows).push(record.sandbox_id);
        continue;
      }
    } catch {
      // Unreachable. Keep the row.
    }

    result.failed.push(record.sandbox_id);
  }

  return result;
}

/** CLI entrypoint. Run by hand as `npm run reap [projectDir]`. */
async function main(): Promise<void> {
  const projectDir = process.argv[2] ?? process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();

  // Imported lazily so `reap()` stays unit-testable without the provider SDK.
  const { VercelProvider } = await import('./providers/vercel.js');

  const providers = new Map<string, SandboxProvider>([['vercel', new VercelProvider()]]);
  const result = await reap({ projectDir, providers });

  process.stdout.write(`${JSON.stringify(result)}\n`);

  if (result.failed.length > 0 || result.orphanedRows.length > 0) {
    process.exitCode = 1;
  }
}

// Only run when executed directly, never on import.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await main();
}
