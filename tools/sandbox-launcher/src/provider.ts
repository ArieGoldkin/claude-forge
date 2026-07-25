/**
 * Provider interface for sandboxed ADW dispatch (T2 / issue #45).
 *
 * ADR-0001 records vendor coupling as a Negative consequence and prescribes the
 * mitigation directly: "keep the provider behind a thin
 * `provision / seed / exec / teardown` interface so AgentCore stays a swappable
 * implementation, not a rewrite." This module is that interface.
 *
 * It deviates from the ADR's wording in one deliberate way. Reading the real
 * `@vercel/sandbox` type definitions showed teardown is **two** operations —
 * `stop()` (sandbox.d.ts:834) halts the sandbox, `delete()` (:1052) removes it.
 * A stop-only teardown leaves a stopped-but-undeleted sandbox and its snapshot
 * storage, which is billed. "No orphaned sandbox" is therefore defined against
 * both, and the interface models both.
 *
 * @module provider
 */

/**
 * The provider has no such sandbox.
 *
 * Distinguished from every other failure because for teardown it is a SUCCESS:
 * the goal is "this sandbox no longer exists", and a sandbox that was never
 * there — or that the provider already auto-terminated — satisfies it. Folding
 * this into generic failure would make the reaper retry corpses forever.
 */
export class SandboxNotFoundError extends Error {
  constructor(id: string) {
    super(`sandbox not found: ${id}`);
    this.name = 'SandboxNotFoundError';
  }
}

/** A live sandbox, as seen by the launcher. */
export interface SandboxHandle {
  /** Provider-assigned identifier. */
  id: string;
  /** Provider key — matches `SandboxProvider.name`. */
  provider: string;
  /** When the provider will auto-terminate this sandbox. */
  expiresAt: Date;
}

/**
 * Git source cloned into the sandbox at creation.
 *
 * Public repositories only, deliberately. The SDK also accepts a credentialed
 * variant, but T2 does not expose it: this repo is public, and ADR-0001 already
 * flags the PAT plumbing as a real cost of the chosen substrate. Keeping the
 * credentialed path out means the launcher never handles a git secret at all.
 * Add it when a private clone is actually needed, with the secret sourced from
 * the environment rather than a parameter.
 */
export interface GitSource {
  url: string;
  revision?: string;
  /** Shallow-clone depth; minimum 1. */
  depth?: number;
}

/** One file written into a sandbox during seeding. */
export interface SeedFile {
  /** Path relative to the sandbox working directory. */
  path: string;
  content: string;
}

export interface ProvisionOptions {
  /**
   * Milliseconds until the provider auto-terminates the sandbox.
   *
   * REQUIRED, not optional, and that is the point. R1 (#51) measured that a
   * terminating event gives an agent ZERO turns afterward — so teardown code
   * scheduled after the work can simply never run. The provider-side timeout is
   * the only teardown mechanism that survives process death, which makes it the
   * guarantee rather than the fallback. Making it non-optional means no caller
   * can create a sandbox with no expiry by omission.
   *
   * Confirmed against the real SDK: `sandbox.d.ts:56-58` — "Timeout in
   * milliseconds before the sandbox auto-terminates."
   */
  timeoutMs: number;
  /** Repository to clone at creation. */
  source?: GitSource;
  /** Provider runtime key, e.g. `node24`. */
  runtime?: string;
  /** vCPUs to allocate. The provider grants 2048 MB of memory per vCPU. */
  vcpus?: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * The swappable substrate contract.
 *
 * Implementations live in `./providers/`. `fake` backs the entire test suite;
 * `vercel` is the ADR-recommended pilot substrate. AgentCore would be a third
 * implementation of this same interface, not a rewrite.
 */
export interface SandboxProvider {
  /** Stable provider key recorded in the registry. */
  readonly name: string;

  /** Create a sandbox. Must honour `opts.timeoutMs` as a hard expiry. */
  provision(opts: ProvisionOptions): Promise<SandboxHandle>;

  /** Write files into a running sandbox. */
  seed(handle: SandboxHandle, files: SeedFile[]): Promise<void>;

  /** Run a command to completion inside the sandbox. */
  exec(handle: SandboxHandle, command: string, args?: string[]): Promise<ExecResult>;

  /** Halt the sandbox. Idempotent. */
  stop(handle: SandboxHandle): Promise<void>;

  /** Remove the sandbox and its snapshot storage. Idempotent. */
  destroy(handle: SandboxHandle): Promise<void>;
}
