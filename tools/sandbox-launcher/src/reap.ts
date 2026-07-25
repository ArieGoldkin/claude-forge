/**
 * Reaper — destroys sandboxes the happy path failed to clean up.
 *
 * This is the recovery layer for the failure R1 (#51) measured: a terminating
 * event gives a process ZERO turns afterward, so `finally` blocks and teardown
 * calls scheduled after the work may never execute. Anything they miss shows up
 * here as a leftover registry row.
 *
 * It is explicitly **best-effort**, and the honest framing matters. It needs a
 * reachable provider and working credentials; when invoked from a hook it is
 * also racing session shutdown. It is not the guarantee — the provider-side
 * creation timeout is. Do not describe this as a completeness proof; ctk 2.9.0
 * already shipped one overclaimed guard and a reviewer took it apart.
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
  /** Injectable clock so expiry handling is testable. */
  now?: Date;
}

export interface ReapResult {
  /** Sandboxes destroyed and deregistered. */
  reaped: string[];
  /** Rows dropped because the provider had already auto-terminated them. */
  expired: string[];
  /** Rows left in place — provider unreachable, so a later run retries. */
  failed: string[];
  /** Rows left in place because no implementation is registered for them. */
  unknownProvider: string[];
}

/**
 * Destroy every sandbox recorded in the registry.
 *
 * Expiry handling is the subtle part. Once `expires_at` has passed the provider
 * has already terminated the sandbox, so a failing `destroy` is expected rather
 * than alarming — the row is dropped anyway. Without that, expired rows would
 * accumulate forever and every future reap would retry corpses.
 */
export async function reap(opts: ReapOptions): Promise<ReapResult> {
  const { projectDir, providers } = opts;
  const now = opts.now ?? new Date();

  const result: ReapResult = { reaped: [], expired: [], failed: [], unknownProvider: [] };

  for (const record of readRegistry(projectDir)) {
    const provider = providers.get(record.provider);

    if (!provider) {
      // Keep the row: dropping it would strand a real sandbox with no trace.
      result.unknownProvider.push(record.sandbox_id);
      continue;
    }

    const handle = {
      id: record.sandbox_id,
      provider: record.provider,
      expiresAt: new Date(record.expires_at),
    };

    const destroyed = await teardown(provider, handle, projectDir);

    if (destroyed) {
      result.reaped.push(record.sandbox_id);
      continue;
    }

    if (handle.expiresAt.getTime() <= now.getTime()) {
      // Already auto-terminated by the provider; the row is the only leftover.
      await removeRecord(projectDir, record.sandbox_id);
      result.expired.push(record.sandbox_id);
      continue;
    }

    result.failed.push(record.sandbox_id);
  }

  return result;
}

/**
 * CLI entrypoint. Invoked detached by ctk's `sandbox-reaper` hook, and runnable
 * by hand as `npm run reap`.
 */
async function main(): Promise<void> {
  const projectDir = process.argv[2] ?? process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();

  // Imported lazily so `reap()` stays unit-testable without the provider SDK.
  const { VercelProvider } = await import('./providers/vercel.js');

  const providers = new Map<string, SandboxProvider>([['vercel', new VercelProvider()]]);
  const result = await reap({ projectDir, providers });

  process.stdout.write(`${JSON.stringify(result)}\n`);

  if (result.failed.length > 0) {
    process.exitCode = 1;
  }
}

// Only run when executed directly, never on import.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await main();
}
