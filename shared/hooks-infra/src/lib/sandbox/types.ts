/**
 * Sandbox registry types (T2 / issue #45).
 *
 * Deliberately dependency-free. This module is the ONLY sandbox vocabulary that
 * enters the plugin trees; every provider SDK stays in `tools/sandbox-launcher/`
 * per ADR-0001 §3 (sandboxed-ADW dispatch is maintainer tooling, not a shipped
 * plugin feature).
 *
 * @module lib/sandbox/types
 */

/** Lifecycle state of a provisioned sandbox. */
export type SandboxStatus = 'provisioning' | 'running' | 'stopped';

/**
 * One row of `.claude/continuity/sandboxes.json`.
 *
 * `expires_at` is the paper trail of the provider-side creation timeout — the
 * only teardown mechanism that survives process death. R1 (#51) measured that a
 * terminating event gives an agent ZERO turns afterward, so any teardown
 * scheduled after the work can simply never run. A reader seeing a record whose
 * `expires_at` has passed can treat the sandbox as self-terminated.
 */
export interface SandboxRecord {
  /** Provider-assigned sandbox identifier. */
  sandbox_id: string;
  /** Provider key, e.g. `vercel` or `fake`. */
  provider: string;
  /** ISO-8601 creation timestamp. */
  created_at: string;
  /** ISO-8601 instant at which the provider auto-terminates the sandbox. */
  expires_at: string;
  /** Claude Code session that provisioned it. */
  session_id: string;
  /** Current lifecycle state. */
  status: SandboxStatus;
}

const STATUSES: readonly string[] = ['provisioning', 'running', 'stopped'];

/**
 * Structural check for a registry row.
 *
 * Used to drop junk rather than throw — this data is read inside hooks, and a
 * hook that throws on a hand-edited file is worse than one that ignores it.
 */
export function isSandboxRecord(value: unknown): value is SandboxRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v['sandbox_id'] === 'string' &&
    v['sandbox_id'].length > 0 &&
    typeof v['provider'] === 'string' &&
    typeof v['created_at'] === 'string' &&
    typeof v['expires_at'] === 'string' &&
    typeof v['session_id'] === 'string' &&
    typeof v['status'] === 'string' &&
    STATUSES.includes(v['status'])
  );
}
