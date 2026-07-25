/**
 * Sandbox registry — the durable record of provisioned sandboxes (T2 / issue #45).
 *
 * `.claude/continuity/sandboxes.json` is the single point of contact between the
 * maintainer-only launcher (`tools/sandbox-launcher/`, which carries the provider
 * SDK) and ctk's zero-dependency hooks (which may only observe and reap).
 *
 * Two invariants this module exists to hold:
 *
 * 1. **Never throw into a hook.** Every read degrades to `[]`. A hand-edited or
 *    truncated file must not take down a SessionEnd handler.
 * 2. **`hasRecords` is false and cheap for an installer.** The overwhelmingly
 *    common case is a user who has never provisioned anything; that path is one
 *    `existsSync` and an early return. This is inertness gate 1 of ADR-0001 §3.
 *
 * NOT barrel-exported from `lib/index.ts` on purpose — that keeps tsup from
 * bundling sandbox code into the four plugins that never reference it.
 *
 * @module lib/sandbox/registry
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONTINUITY_DIRS } from '../continuity.js';
import { acquireLock, releaseLock } from '../lock.js';
import { type SandboxRecord, isSandboxRecord } from './types.js';

const REGISTRY_FILE = 'sandboxes.json';

/** 20 × 100 ms = 2 s. Matches the other continuity writers. */
const MAX_LOCK_ATTEMPTS = 20;

/**
 * Absolute path to the registry file for a project.
 *
 * @param projectDir - Project root
 */
export function registryPath(projectDir: string): string {
  return path.join(projectDir, CONTINUITY_DIRS.base, REGISTRY_FILE);
}

/**
 * Read all well-formed records. Returns `[]` for a missing, corrupt, or
 * non-array file, and silently drops individual rows that fail the shape check.
 *
 * @param projectDir - Project root
 */
export function readRegistry(projectDir: string): SandboxRecord[] {
  try {
    const raw = fs.readFileSync(registryPath(projectDir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isSandboxRecord);
  } catch {
    return [];
  }
}

/**
 * Whether any sandbox is currently recorded.
 *
 * Inertness gate 1: for a project that has never provisioned a sandbox the file
 * does not exist, so this costs a single `existsSync` and never parses.
 *
 * @param projectDir - Project root
 */
export function hasRecords(projectDir: string): boolean {
  if (!fs.existsSync(registryPath(projectDir))) {
    return false;
  }
  return readRegistry(projectDir).length > 0;
}

/**
 * Apply a pure transform to the registry under an exclusive lock.
 *
 * Read-modify-write happens entirely inside the lock so concurrent writers
 * cannot lose each other's records. The write is temp+rename so a reader never
 * observes a partial file.
 *
 * @returns true if the new contents were durably written
 */
async function mutate(
  projectDir: string,
  transform: (current: SandboxRecord[]) => SandboxRecord[]
): Promise<boolean> {
  const file = registryPath(projectDir);

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    return false;
  }

  const lockDir = `${file}.lock`;
  if (!(await acquireLock(lockDir, MAX_LOCK_ATTEMPTS))) {
    return false;
  }

  try {
    const next = transform(readRegistry(projectDir));
    const tempFile = `${file}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(tempFile, file);
    return true;
  } catch {
    return false;
  } finally {
    releaseLock(lockDir);
  }
}

/**
 * Insert a record, replacing any existing row with the same `sandbox_id`.
 *
 * Callers must register a sandbox BEFORE handing its handle to anything that
 * can fail — a crash between provisioning and the first write would otherwise
 * leave a billable sandbox with no record of its existence.
 *
 * @param projectDir - Project root
 * @param rec        - Record to upsert
 */
export function addRecord(projectDir: string, rec: SandboxRecord): Promise<boolean> {
  return mutate(projectDir, (current) => [
    ...current.filter((r) => r.sandbox_id !== rec.sandbox_id),
    rec,
  ]);
}

/**
 * Drop a record by id. Succeeds whether or not the id was present.
 *
 * @param projectDir - Project root
 * @param sandboxId  - Provider-assigned id
 */
export function removeRecord(projectDir: string, sandboxId: string): Promise<boolean> {
  return mutate(projectDir, (current) => current.filter((r) => r.sandbox_id !== sandboxId));
}

/**
 * Drop every record.
 *
 * @param projectDir - Project root
 */
export function clearRegistry(projectDir: string): Promise<boolean> {
  return mutate(projectDir, () => []);
}
