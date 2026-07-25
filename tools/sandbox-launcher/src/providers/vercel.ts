/**
 * Vercel Sandbox provider — the substrate ADR-0001 recommends for the T4 pilot.
 *
 * **Runtime-unproven.** Every line here typechecks against the real
 * `@vercel/sandbox` type definitions, and nothing here has ever run against
 * Vercel. T2 defers the live run to T4/Gate 1 because the SDK needs a Vercel
 * *project*, not merely a token. Treat this as a compile-verified sketch, not a
 * proven integration, and do not describe it as one.
 *
 * Four facts below were read out of the SDK's `.d.ts`, not assumed:
 *
 * 1. **Sandboxes are identified by `name`, and `name` is optional on create**
 *    ("If omitted, a random name will be generated"). `Sandbox.get()` takes a
 *    name. So the launcher MUST pass an explicit name, or the reaper can never
 *    reattach — a generated name known only to a process that has since died is
 *    an unreapable orphan.
 * 2. **Teardown is two calls** — `stop()` then `delete()`.
 * 3. **`timeout` is a create-time parameter** that auto-terminates the sandbox.
 * 4. **Credentials resolve from the environment.** This class never accepts,
 *    stores, or forwards a secret; the SDK's own resolution path handles it.
 *    Maintainer tooling that never touches a credential cannot leak one.
 *
 * @module providers/vercel
 */

import { Sandbox } from '@vercel/sandbox';
import type {
  ExecResult,
  GitSource,
  ProvisionOptions,
  SandboxHandle,
  SandboxProvider,
  SeedFile,
} from '../provider.js';

export interface VercelProviderOptions {
  /** Prefix for generated sandbox names. */
  namePrefix?: string;
}

/** Map our flat `GitSource` onto the SDK's discriminated union. */
function toSdkSource(source: GitSource) {
  return {
    type: 'git' as const,
    url: source.url,
    ...(source.revision === undefined ? {} : { revision: source.revision }),
    ...(source.depth === undefined ? {} : { depth: source.depth }),
  };
}

export class VercelProvider implements SandboxProvider {
  readonly name = 'vercel';

  private readonly namePrefix: string;
  private counter = 0;

  constructor(options: VercelProviderOptions = {}) {
    this.namePrefix = options.namePrefix ?? 'adw';
  }

  /**
   * Collision-resistant sandbox name.
   *
   * Recorded in the registry as `sandbox_id`. It is the only handle the reaper
   * ever gets, which is why it is supplied at creation rather than left to the
   * SDK to generate.
   */
  private nextName(): string {
    this.counter += 1;
    return `${this.namePrefix}-${Date.now().toString(36)}-${this.counter}`;
  }

  async provision(opts: ProvisionOptions): Promise<SandboxHandle> {
    const name = this.nextName();

    const sandbox = await Sandbox.create({
      name,
      // Non-negotiable: the one teardown mechanism that survives process death.
      timeout: opts.timeoutMs,
      ...(opts.source === undefined ? {} : { source: toSdkSource(opts.source) }),
      ...(opts.runtime === undefined ? {} : { runtime: opts.runtime as never }),
      ...(opts.vcpus === undefined ? {} : { resources: { vcpus: opts.vcpus } }),
    });

    return {
      id: sandbox.name,
      provider: this.name,
      expiresAt: new Date(Date.now() + opts.timeoutMs),
    };
  }

  /** Reattach to a sandbox by the name recorded in the registry. */
  private attach(handle: SandboxHandle): Promise<Sandbox> {
    return Sandbox.get({ name: handle.id });
  }

  async seed(handle: SandboxHandle, files: SeedFile[]): Promise<void> {
    const sandbox = await this.attach(handle);
    await sandbox.writeFiles(files.map((f) => ({ path: f.path, content: f.content })));
  }

  async exec(handle: SandboxHandle, command: string, args: string[] = []): Promise<ExecResult> {
    const sandbox = await this.attach(handle);
    const finished = await sandbox.runCommand(command, args);
    const [stdout, stderr] = await Promise.all([finished.stdout(), finished.stderr()]);
    return { exitCode: finished.exitCode, stdout, stderr };
  }

  async stop(handle: SandboxHandle): Promise<void> {
    const sandbox = await this.attach(handle);
    await sandbox.stop();
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    const sandbox = await this.attach(handle);
    await sandbox.delete();
  }
}
