/**
 * Provider interface for sandboxed ADW dispatch (T2 / issue #45).
 *
 * ADR-0001 records vendor coupling as a Negative consequence and prescribes the
 * mitigation: keep the provider behind a thin interface so AgentCore stays a
 * swappable implementation rather than a rewrite. This module is that interface.
 *
 * ## What bounds cost — read this before changing anything here
 *
 * An earlier draft of this file claimed the creation timeout was "the guarantee
 * that a sandbox stops costing money" and "auto-terminates the sandbox". That was
 * wrong, and it was wrong in the expensive direction. Ground truth from
 * `@vercel/sandbox@2.9.0`:
 *
 * - `sandbox.d.ts:361` — `timeout` is "The **default** timeout of this sandbox";
 *   `sandbox.d.ts:365` — `expiresAt` is "When the **currently running session**
 *   will time out." The timeout bounds a SESSION, i.e. compute.
 * - `README.md:103` — "**Sandboxes are persistent by default.**" The sandbox
 *   object and its snapshot outlive the session that created them.
 * - `sandbox.d.ts:98` — `persistent` toggles "automatic restore of the filesystem
 *   between sessions"; `:104` — `snapshotExpiration` sets when snapshots expire.
 *
 * So there is no single mechanism that makes a sandbox disappear on its own. Two
 * creation-time settings bound the two cost axes independently:
 *
 * | Axis    | Bounded by            | If omitted             |
 * |---------|-----------------------|------------------------|
 * | Compute | `timeoutMs`           | 5-minute default       |
 * | Storage | `snapshotExpirationMs`| never expires          |
 *
 * Explicit `destroy()` is still the only thing that removes a sandbox. The two
 * settings bound what an un-destroyed one can cost — which is the property worth
 * claiming, and all that should ever be claimed.
 *
 * @module provider
 */

/**
 * The provider has no such sandbox.
 *
 * Distinguished from every other failure because for teardown it is a SUCCESS:
 * the goal is "this sandbox no longer exists", and one that was never there
 * satisfies it. Folding this into generic failure makes the reaper retry corpses
 * forever, and folding generic failure into *this* silently drops live sandboxes.
 *
 * Implementations MUST map their provider's not-found error onto this class.
 * `@vercel/sandbox` signals it as `APIError` with `response.status === 404`.
 */
export class SandboxNotFoundError extends Error {
  constructor(id: string) {
    super(`sandbox not found: ${id}`);
    this.name = 'SandboxNotFoundError';
  }
}

/** A live sandbox, as seen by the launcher. */
export interface SandboxHandle {
  /** Provider-assigned identifier. For Vercel this is the sandbox `name`. */
  id: string;
  /** Provider key — matches `SandboxProvider.name`. */
  provider: string;
  /**
   * When the current session times out, as reported BY THE PROVIDER.
   *
   * Never computed locally from `timeoutMs`: the plan clamps it (Hobby caps at
   * 45 minutes), resuming starts a fresh window, and `extendTimeout` moves it.
   * A locally-guessed value drives the reaper's expiry branch, so a wrong guess
   * there drops the record of a live sandbox.
   */
  expiresAt: Date;
}

/**
 * Git source cloned into the sandbox at creation.
 *
 * Public repositories only, deliberately. The SDK also accepts a credentialed
 * variant; T2 does not expose it, so the launcher never handles a git secret.
 * Add it when a private clone is genuinely needed, sourced from the environment.
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
   * Sandbox name, supplied by the CALLER rather than generated here.
   *
   * Two reasons, both load-bearing. The SDK's `name` is optional on create and
   * "a random name will be generated" if omitted — a name known only to a
   * process that then dies is an unreapable orphan. And the launcher must be
   * able to record the name BEFORE calling create, which is only possible if it
   * chose the name itself.
   */
  name: string;
  /**
   * Milliseconds before the running session times out. Bounds COMPUTE only.
   * Required so no caller can silently inherit the 5-minute default.
   */
  timeoutMs: number;
  /**
   * Milliseconds before snapshots of this sandbox expire. Bounds STORAGE.
   * Required for the same reason: omitting it means snapshots never expire.
   */
  snapshotExpirationMs: number;
  /** Repository to clone at creation. */
  source?: GitSource;
  /** Provider runtime key, e.g. `node24`. */
  runtime?: string;
  /** vCPUs to allocate. The provider grants 2048 MB of memory per vCPU. */
  vcpus?: number;
  /** Abort creation. */
  signal?: AbortSignal;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Per-call options for operations that reach the provider over the network. */
export interface CallOptions {
  signal?: AbortSignal;
}

/**
 * The swappable substrate contract.
 *
 * Implementations live in `./providers/`. `fake` backs the unit tests; `vercel`
 * is the ADR-recommended pilot substrate. AgentCore would be a third
 * implementation of this interface, not a rewrite.
 */
export interface SandboxProvider {
  /** Stable provider key recorded in the registry. */
  readonly name: string;

  /** Create a sandbox under the caller-supplied name. */
  provision(opts: ProvisionOptions): Promise<SandboxHandle>;

  /** Write files into a sandbox. */
  seed(handle: SandboxHandle, files: SeedFile[], opts?: CallOptions): Promise<void>;

  /** Run a command to completion inside the sandbox. */
  exec(
    handle: SandboxHandle,
    command: string,
    args?: string[],
    opts?: CallOptions
  ): Promise<ExecResult>;

  /**
   * Halt the sandbox without resuming it first.
   *
   * MUST NOT resurrect a stopped sandbox: `Sandbox.get()` defaults to
   * `resume: true`, so a naive attach-then-stop boots the VM it is about to
   * halt, and an attach during reaping restarts one the timeout already stopped.
   *
   * Throws {@link SandboxNotFoundError} when the sandbox does not exist.
   */
  stop(handle: SandboxHandle, opts?: CallOptions): Promise<void>;

  /**
   * Remove the sandbox and its snapshot storage. Must not resume it first.
   *
   * Throws {@link SandboxNotFoundError} when the sandbox does not exist.
   */
  destroy(handle: SandboxHandle, opts?: CallOptions): Promise<void>;

  /**
   * Whether the sandbox still exists at the provider.
   *
   * The reaper needs this to distinguish "already gone" from "unreachable"
   * before it drops a registry row — dropping the row for a sandbox that is
   * merely unreachable loses the only record of something still billing.
   */
  exists(handle: SandboxHandle, opts?: CallOptions): Promise<boolean>;
}
