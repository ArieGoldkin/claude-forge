/**
 * Vercel Sandbox provider — the substrate ADR-0001 recommends for the T4 pilot.
 *
 * **Runtime-unproven.** Every line typechecks against the real `@vercel/sandbox`
 * type definitions and none of it has ever executed. T2 defers the live run to
 * T4/Gate 1 because the SDK needs a Vercel *project*, not merely a token. Treat
 * this as a compile-verified sketch and do not describe it as an integration.
 *
 * ## SDK behaviours that dictate the code below
 *
 * Each was read out of the installed `.d.ts`, and the first two were originally
 * got wrong in a way that would have cost money:
 *
 * 1. **`Sandbox.get()` resumes by default** (`sandbox.d.ts:197` — `resume` "Defaults
 *    to true"). Attaching to stop something therefore BOOTS it first, and the
 *    reaper attaching to an already-timed-out sandbox restarts it. Every attach
 *    here passes `resume: false`.
 * 2. **`timeout` bounds a session, not the sandbox** (`:361`, `:365`), and
 *    sandboxes are persistent by default (`README.md:103`). Compute is bounded by
 *    `timeout`; storage needs `snapshotExpiration`. Both are set on create.
 * 3. **Not-found is `APIError` with `response.status === 404`** — the SDK's own
 *    `isNotFoundError` does exactly this check. It never throws our
 *    `SandboxNotFoundError`, so this module maps it. Without the mapping,
 *    teardown treats "already gone" as "may still be alive" and the registry row
 *    never clears.
 * 4. **`name` is optional on create** ("a random name will be generated"), so the
 *    caller supplies it — a generated name known only to a dead process is an
 *    unreapable orphan.
 *
 * @module providers/vercel
 */

import { APIError, Sandbox } from '@vercel/sandbox';
import {
  type CallOptions,
  type ExecResult,
  type GitSource,
  type ProvisionOptions,
  type SandboxHandle,
  SandboxNotFoundError,
  type SandboxProvider,
  type SeedFile,
} from '../provider.js';

/** Map our flat `GitSource` onto the SDK's discriminated union. */
function toSdkSource(source: GitSource) {
  return {
    type: 'git' as const,
    url: source.url,
    ...(source.revision === undefined ? {} : { revision: source.revision }),
    ...(source.depth === undefined ? {} : { depth: source.depth }),
  };
}

/** True when the SDK is telling us the sandbox does not exist. */
function isNotFound(err: unknown): boolean {
  return err instanceof APIError && err.response?.status === 404;
}

export class VercelProvider implements SandboxProvider {
  readonly name = 'vercel';

  async provision(opts: ProvisionOptions): Promise<SandboxHandle> {
    const sandbox = await Sandbox.create({
      name: opts.name,
      // Bounds compute. Without it the session inherits a 5-minute default.
      timeout: opts.timeoutMs,
      // Bounds storage. Without it snapshots never expire and bill indefinitely.
      snapshotExpiration: opts.snapshotExpirationMs,
      // No filesystem restore between sessions -- an ADW sandbox is disposable,
      // and persistence is purely cost with no benefit here.
      persistent: false,
      ...(opts.source === undefined ? {} : { source: toSdkSource(opts.source) }),
      ...(opts.runtime === undefined ? {} : { runtime: opts.runtime as never }),
      ...(opts.vcpus === undefined ? {} : { resources: { vcpus: opts.vcpus } }),
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    });

    return {
      id: sandbox.name,
      // The provider's own value. A locally computed `Date.now() + timeoutMs` is
      // wrong whenever the plan clamps the timeout, and the reaper makes an
      // irreversible decision on this field.
      expiresAt: sandbox.expiresAt ?? new Date(Date.now() + opts.timeoutMs),
      provider: this.name,
    };
  }

  /**
   * Reattach by the name recorded in the registry, WITHOUT resuming.
   *
   * @throws {SandboxNotFoundError} when the provider reports 404
   */
  private async attach(handle: SandboxHandle, opts?: CallOptions): Promise<Sandbox> {
    try {
      return await Sandbox.get({
        name: handle.id,
        resume: false,
        ...(opts?.signal === undefined ? {} : { signal: opts.signal }),
      });
    } catch (err) {
      if (isNotFound(err)) {
        throw new SandboxNotFoundError(handle.id);
      }
      throw err;
    }
  }

  async seed(handle: SandboxHandle, files: SeedFile[], opts?: CallOptions): Promise<void> {
    const sandbox = await this.attach(handle, opts);
    await sandbox.writeFiles(files.map((f) => ({ path: f.path, content: f.content })));
  }

  async exec(
    handle: SandboxHandle,
    command: string,
    args: string[] = [],
    opts?: CallOptions
  ): Promise<ExecResult> {
    const sandbox = await this.attach(handle, opts);
    const finished = await sandbox.runCommand(command, args);
    const [stdout, stderr] = await Promise.all([finished.stdout(), finished.stderr()]);
    return { exitCode: finished.exitCode, stdout, stderr };
  }

  async stop(handle: SandboxHandle, opts?: CallOptions): Promise<void> {
    const sandbox = await this.attach(handle, opts);
    try {
      await sandbox.stop();
    } catch (err) {
      if (isNotFound(err)) {
        throw new SandboxNotFoundError(handle.id);
      }
      throw err;
    }
  }

  async destroy(handle: SandboxHandle, opts?: CallOptions): Promise<void> {
    const sandbox = await this.attach(handle, opts);
    try {
      await sandbox.delete();
    } catch (err) {
      if (isNotFound(err)) {
        throw new SandboxNotFoundError(handle.id);
      }
      throw err;
    }
  }

  async exists(handle: SandboxHandle, opts?: CallOptions): Promise<boolean> {
    try {
      await this.attach(handle, opts);
      return true;
    } catch (err) {
      if (err instanceof SandboxNotFoundError) {
        return false;
      }
      // Unreachable is NOT the same as absent. Propagate, so the reaper keeps
      // the registry row rather than dropping the record of a live sandbox.
      throw err;
    }
  }
}
