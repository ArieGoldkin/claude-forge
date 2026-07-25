/**
 * In-memory provider used by the entire T2 test suite.
 *
 * T2 ships with the live run deliberately deferred to T4/Gate 1 (see the Phase-0
 * decision in `.develop/pipeline-state.md`): `@vercel/sandbox` needs
 * `{ token, projectId, teamId }` — a Vercel *project*, not merely a token — so
 * "provision → seed → teardown proven against the provider" is not satisfiable
 * here. This fake proves the *interface* and the launcher's sequencing.
 *
 * KNOWN LIMIT, stated plainly: behaviour parity with the real SDK is UNPROVEN.
 * The fake implements `SandboxProvider`, so the compiler catches signature
 * drift, but nothing here demonstrates that Vercel behaves this way at runtime.
 * That is T4's job and must not be claimed before then.
 *
 * @module providers/fake
 */

import {
  type ExecResult,
  type ProvisionOptions,
  type SandboxHandle,
  type SandboxProvider,
  SandboxNotFoundError,
  type SeedFile,
} from '../provider.js';

/** Operations a test can force to fail. */
export type FaultPoint = 'provision' | 'seed' | 'exec' | 'stop' | 'destroy';

interface FakeSandbox {
  handle: SandboxHandle;
  files: Map<string, string>;
  commands: string[];
  stopped: boolean;
  destroyed: boolean;
}

/**
 * Deterministic, dependency-free `SandboxProvider`.
 *
 * Ids are sequential rather than random so assertions can name them directly.
 */
export class FakeProvider implements SandboxProvider {
  readonly name = 'fake';

  /** Every sandbox ever provisioned, including destroyed ones, for assertions. */
  readonly sandboxes = new Map<string, FakeSandbox>();

  private counter = 0;
  private readonly faults = new Set<FaultPoint>();

  /** Force `point` to reject on its next and all subsequent calls. */
  failAt(point: FaultPoint): void {
    this.faults.add(point);
  }

  /** Stop forcing `point` to fail. */
  clearFault(point: FaultPoint): void {
    this.faults.delete(point);
  }

  private check(point: FaultPoint): void {
    if (this.faults.has(point)) {
      throw new Error(`fake provider: injected failure at ${point}`);
    }
  }

  private get(handle: SandboxHandle): FakeSandbox {
    const sbx = this.sandboxes.get(handle.id);
    if (!sbx) {
      throw new SandboxNotFoundError(handle.id);
    }
    return sbx;
  }

  /** Sandboxes that were provisioned and never destroyed — i.e. leaks. */
  liveIds(): string[] {
    return [...this.sandboxes.values()].filter((s) => !s.destroyed).map((s) => s.handle.id);
  }

  async provision(opts: ProvisionOptions): Promise<SandboxHandle> {
    this.check('provision');
    this.counter += 1;
    const handle: SandboxHandle = {
      id: `fake_${this.counter}`,
      provider: this.name,
      expiresAt: new Date(Date.now() + opts.timeoutMs),
    };
    this.sandboxes.set(handle.id, {
      handle,
      files: new Map(),
      commands: [],
      stopped: false,
      destroyed: false,
    });
    return handle;
  }

  async seed(handle: SandboxHandle, files: SeedFile[]): Promise<void> {
    this.check('seed');
    const sbx = this.get(handle);
    for (const file of files) {
      sbx.files.set(file.path, file.content);
    }
  }

  async exec(handle: SandboxHandle, command: string, args: string[] = []): Promise<ExecResult> {
    this.check('exec');
    const sbx = this.get(handle);
    const line = [command, ...args].join(' ');
    sbx.commands.push(line);
    return { exitCode: 0, stdout: `ran: ${line}`, stderr: '' };
  }

  async stop(handle: SandboxHandle): Promise<void> {
    this.check('stop');
    // Unknown ids raise, matching a real provider's not-found rather than
    // silently succeeding — a lenient fake would hide whole branches from the
    // suite. Re-stopping a known sandbox stays idempotent.
    const sbx = this.get(handle);
    sbx.stopped = true;
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    this.check('destroy');
    const sbx = this.get(handle);
    sbx.stopped = true;
    sbx.destroyed = true;
  }
}
