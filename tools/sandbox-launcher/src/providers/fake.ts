/**
 * In-memory provider backing the unit tests.
 *
 * T2 defers the live run to T4/Gate 1, so this fake is what the launcher's
 * sequencing is proven against. **Behaviour parity with the real SDK is
 * UNPROVEN** — the fake implements `SandboxProvider`, so the compiler catches
 * signature drift, but nothing here shows Vercel behaves this way at runtime.
 *
 * ## Fidelity rules this fake exists to honour
 *
 * A review found that an earlier version made two whole branches untestable by
 * being too lenient, so these are now deliberate:
 *
 * 1. **`destroy()` does NOT imply `stopped`.** It used to, which meant the test
 *    asserting "both stops and destroys" passed with the entire `stop()` call
 *    deleted — the snapshot-storage cost regression it named was the one thing
 *    it could not catch. Callers assert on {@link FakeSandbox.calls} instead.
 * 2. **Unknown ids raise `SandboxNotFoundError`,** like a real provider, rather
 *    than succeeding silently and hiding the reaper's not-found path.
 *
 * @module providers/fake
 */

import {
  type CallOptions,
  type ExecResult,
  type ProvisionOptions,
  type SandboxHandle,
  SandboxNotFoundError,
  type SandboxProvider,
  type SeedFile,
} from '../provider.js';

/** Operations a test can force to fail. */
export type FaultPoint = 'provision' | 'seed' | 'exec' | 'stop' | 'destroy' | 'exists';

export interface FakeSandbox {
  handle: SandboxHandle;
  files: Map<string, string>;
  commands: string[];
  /** Ordered log of lifecycle calls — `['stop','destroy']` on a clean teardown. */
  calls: string[];
  stopped: boolean;
  destroyed: boolean;
}

/** Deterministic, dependency-free `SandboxProvider`. */
export class FakeProvider implements SandboxProvider {
  readonly name = 'fake';

  /** Every sandbox ever provisioned, including destroyed ones, for assertions. */
  readonly sandboxes = new Map<string, FakeSandbox>();

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

  /** Sandboxes provisioned and never destroyed — i.e. leaks. */
  liveIds(): string[] {
    return [...this.sandboxes.values()].filter((s) => !s.destroyed).map((s) => s.handle.id);
  }

  /** Ordered lifecycle calls recorded for a sandbox. */
  callsFor(id: string): string[] {
    return this.sandboxes.get(id)?.calls ?? [];
  }

  async provision(opts: ProvisionOptions): Promise<SandboxHandle> {
    this.check('provision');
    const handle: SandboxHandle = {
      id: opts.name,
      provider: this.name,
      // Stands in for the provider-reported value; the real provider may clamp.
      expiresAt: new Date(Date.now() + opts.timeoutMs),
    };
    this.sandboxes.set(handle.id, {
      handle,
      files: new Map(),
      commands: [],
      calls: ['provision'],
      stopped: false,
      destroyed: false,
    });
    return handle;
  }

  async seed(handle: SandboxHandle, files: SeedFile[], _opts?: CallOptions): Promise<void> {
    this.check('seed');
    const sbx = this.get(handle);
    sbx.calls.push('seed');
    for (const file of files) {
      sbx.files.set(file.path, file.content);
    }
  }

  async exec(
    handle: SandboxHandle,
    command: string,
    args: string[] = [],
    _opts?: CallOptions
  ): Promise<ExecResult> {
    this.check('exec');
    const sbx = this.get(handle);
    const line = [command, ...args].join(' ');
    sbx.calls.push('exec');
    sbx.commands.push(line);
    return { exitCode: 0, stdout: `ran: ${line}`, stderr: '' };
  }

  async stop(handle: SandboxHandle, _opts?: CallOptions): Promise<void> {
    this.check('stop');
    const sbx = this.get(handle);
    sbx.calls.push('stop');
    sbx.stopped = true;
  }

  async destroy(handle: SandboxHandle, _opts?: CallOptions): Promise<void> {
    this.check('destroy');
    const sbx = this.get(handle);
    sbx.calls.push('destroy');
    // Deliberately does NOT set `stopped` -- see the fidelity note above.
    sbx.destroyed = true;
  }

  async exists(handle: SandboxHandle, _opts?: CallOptions): Promise<boolean> {
    this.check('exists');
    const sbx = this.sandboxes.get(handle.id);
    return sbx !== undefined && !sbx.destroyed;
  }
}
