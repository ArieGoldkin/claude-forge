# PR #55 (T2 / #45) adversarial review — DO NOT MERGE

**Date**: 2026-07-25 · **Branch**: `feat/t2-sandbox-launcher` · **PR**: [#55](https://github.com/ArieGoldkin/claude-forge/pull/55) (converted to draft)
**Method**: 4 independent reviewers, perspective-diverse lenses, each briefed to REFUTE rather than confirm, each checkpointing to `.claude/reviews/r{1..4}-*.md`.
**Reviewer return behaviour**: all four returned only their preamble — the premature-return mode R1 (#51) documented. All four findings files survived intact. The checkpoint mandate is what saved this review; without it, everything below would have been lost, twice over.

**Verdict: 11 BLOCKING, 9 MAJOR. The isolation half of the PR is sound. The teardown/reaper half rests on a false premise and must be redesigned, not patched.**

---

## The headline: the central architectural claim is false

The PR's teardown design has one load-bearing assumption, restated in **six** places (`launcher.ts:11-12`, `provider.ts:72-81`, `reap.ts:11-12`, `types.ts:18-22`, `sandbox-reaper.ts:35-38`, CHANGELOG):

> "The actual guarantee that a sandbox stops costing money is the provider-side creation timeout — the only mechanism that survives process death."

**This is not what the SDK does.** Verified directly against `@vercel/sandbox@2.9.0`:

| Evidence | Says |
|---|---|
| `sandbox.d.ts:361-363` | `get timeout()` — "The **default** timeout of this sandbox" |
| `sandbox.d.ts:365-367` | `get expiresAt()` — "When the **currently running session** will time out" |
| `README.md:103` | "**Sandboxes are persistent by default.**" |
| `README.md:195-196` | 24 h Pro / 45 min Hobby max, **default 5 minutes** |

The creation `timeout` bounds a **session** (compute). The sandbox object and its snapshot **persist** — and by the PR's own stated rationale (`provider.ts:9-14`), a stopped-but-undeleted sandbox with snapshot storage is exactly what keeps billing. `Sandbox.create` is called with no `persistent: false`, no `snapshotExpiration`, no `keepLastSnapshots`.

### How the Phase-2 verification got this wrong

Phase 2 explicitly set out to test this assumption before building on it, and reported **CONFIRMED** on the strength of `sandbox.d.ts:56-58` — "Timeout in milliseconds before the sandbox auto-terminates." That line exists and says that. The read simply stopped there. Lines 361-367, three hundred lines later, and the README's first page, contradict the interpretation built on it.

This is a partial read that confirmed the desired answer. The repo's standing rule is "capture beats inference" — the correction is that a *single* captured line is still inference when a contradicting line sits elsewhere in the same file. The `resume: true` default (below) was likewise read aloud during Phase 1 fact-finding and its significance not registered.

---

## BLOCKING

### B1 · The reaper hook executes an arbitrary, project-supplied executable (VERIFIED by execution)
`plugins/continuity-toolkit/hooks/src/lifecycle/sandbox-reaper.ts:79-93`

Both inertness gates test only `existsSync` on paths **inside the project directory** — paths a cloned repo can carry. A repository containing:

- `.claude/continuity/sandboxes.json` (one well-formed record)
- `tools/sandbox-launcher/src/reap.ts` (any text)
- `tools/sandbox-launcher/node_modules/.bin/tsx` → **a symlink to `/bin/sh`** (git mode 120000)

causes the shipped hook, on SessionEnd, to execute attacker-controlled commands as the user — detached, `stdio: 'ignore'`, full inherited environment (89 vars), cwd inside the repo. Verified by constructing it and running the real hook via `run-hook-wrapper.sh`. No executable bit and no committed binary required; two ordinary text objects in a git tree.

**This directly falsifies** "the worst a bug in this file can do is fail to clean something up. It cannot bill anyone." Provisioning is structurally absent only from *the code the maintainer wrote* — not from what the hook actually executes.

### B2 · `Sandbox.get()` resumes by default — the reaper starts compute
`providers/vercel.ts:94` calls `Sandbox.get({ name })` with no `resume: false`. `GetSandboxParams.resume` — "Defaults to **true**" (`sandbox.d.ts:197`, `:217`).

Consequences: teardown attaches **twice** (stop attaches+stops; destroy attaches again, **resuming the VM just stopped**, then deletes). Worse, the reaper attaching to an already-auto-terminated sandbox **boots it again** — and if the subsequent delete fails, leaves a freshly resumed, billing sandbox. A hook documented as unable to bill anyone initiates compute.

### B3 · The real provider never throws `SandboxNotFoundError`, so teardown's success-on-missing branch is dead in production
`launcher.ts:89` treats only `SandboxNotFoundError` as success. That class is thrown **only by `FakeProvider`** (`fake.ts:71`). The SDK's error classes are `APIError` and `StreamError`; its own not-found check is `err instanceof APIError && err.response.status === 404`. `VercelProvider` never catches or translates.

So in production a 404 → `teardown` returns false → the row is never removed → `reap` reports `failed` → **`hasRecords()` stays true forever** → ctk's SessionEnd hook spawns a detached subprocess on **every future session end, indefinitely**. One stuck row permanently defeats inertness gate 1. No backoff, no max-age, no cap. Every test covering this branch tests behaviour the shipped provider cannot produce.

### B4 · The expiry path drops the record of a sandbox that is still alive (VERIFIED by execution)
`reap.ts:79-83`. Harness result: expired row + transient destroy failure → `{"expired":["fake_1"]}`, rows after reap = 0, `liveIds() = ['fake_1']`. Alive, undeleted, and now **untracked anywhere**. The PR's own test constructs exactly this state and asserts only `hasRecords === false` — never that the sandbox is gone — so the suite green-lights the leak. Compounded by B2: the reaper may have just restarted that sandbox before dropping its row.

### B5 · A held registry lock yields a live sandbox with zero rows (VERIFIED by execution)
`launcher.ts:58` discards `addRecord`'s boolean. `mutate()` returns **false** (never throws) on mkdir failure, lock timeout (2 s), or write error. Harness: with the lock held, `launch()` resolved after 2025 ms with a live handle and **0 rows**. Silent, no retry, no compensating teardown. Same defect at `launcher.ts:94` — `teardown` returns `true`, documented as "destroyed **and deregistered**", while the row survives.

### B6 · The provisioning window is unprotected
`launcher.ts:55-58` writes the row after `provision()` **resolves**, not before the create request. A crash during VM boot + git clone — tens of seconds, the longest window in the flow — leaves a live billing sandbox whose name is known only to the dead process. Note `SandboxStatus` already declares `'provisioning'` (`types.ts:13`) and **nothing ever writes it**: the vocabulary anticipates the pre-create row the launcher never writes. `Sandbox.list({ namePrefix })` exists for recovery and is unused.

### B7 · Test integrity — "both stops and destroys" cannot detect a missing `stop()`
`launcher.test.ts:148-156`. Mutation: deleted the entire `stop()` block from `launcher.ts:77-81` → **21/21 still pass**. `FakeProvider.destroy()` sets `stopped = true` as well, so the assertion is satisfied by `destroy()` alone. The test's stated rationale — the snapshot-storage cost regression — is precisely what it cannot catch. **`stop()` has no test anywhere that fails when the call is removed.**

---

## MAJOR

- **M1 · A FIFO at the registry path wedges the hook** (VERIFIED). `registry.ts:50` `readFileSync` blocks forever on an unopened pipe; `existsSync` returns true for a FIFO. Hook still running after 10 s, required SIGKILL. hooks.json allows 5 s → stalled SessionEnd + hook timeout. "Every read degrades to `[]`" covers throws, not blocking reads. Same class: huge file, stalled NFS mount.
- **M2 · `spawn` error handling is inert** (VERIFIED) — the exact defect class this PR's CHANGELOG cites. Node emits ENOENT/EACCES as an async `'error'` event, not a synchronous throw, and no `child.on('error')` listener is attached. The documented failure path never logs; it survives only by `process.exit()` winning a race. **Reachable**: `projectDir` defaults to `'.'` (line 69) making `runner` relative, while `cwd` is the launcher dir — the child resolves `tools/sandbox-launcher/tools/sandbox-launcher/...` and fails, though the gates passed.
- **M3 · `reap()` ignores `session_id`, destroying another live session's sandbox** (VERIFIED). Two rows, one still running → single `reap()` destroyed both. Fires on `/clear` and `logout` too; the hook takes `source` and discards it (`_input`).
- **M4 · `expires_at` is a client-side guess** — `vercel.ts:88` computes `Date.now() + timeoutMs`, ignoring `sandbox.expiresAt` and `sandbox.timeout`. Wrong whenever the plan clamps (Hobby 45 min), whenever a session resumes, whenever `extendTimeout` is used. `reap.ts:79` makes an irreversible record-dropping decision on that guess. `timeoutMs` is also unbounded and unvalidated.
- **M5 · Registry tests do not pin the lock, atomicity, or shape validation.** Deleting `acquireLock` → 19/19 pass (the read-modify-write is synchronous, so same-thread `Promise.all` can never interleave; real cross-process contention is untested). Replacing temp+rename with a direct write → passes. Removing the `status` enum check, the `sandbox_id` length check, and the `expires_at` typeof check → all pass. Only `sandbox_id`'s typeof is actually pinned.
- **M6 · `removeRecord` failures are swallowed** — `reap` reported `{"reaped":["fake_1"]}` while the row survived. Combined with B3 the row becomes unremovable.
- **M7 · The "one existsSync" cost claim understates the installed cost.** The hook is a *separate* SessionEnd command: an extra `sh` + `node` loading a 197 KB bundle on every session end for every installer. Measured median **47 ms**. The repo already has the combining pattern (`bash-combined`, `write-combined`); folding this into `session-end` would make the claim true.
- **M8 · Name generation has zero entropy** — `${prefix}-${Date.now().toString(36)}-${counter}`, counter per-instance. Same-millisecond collision → `addRecord` upserts by id and **silently deletes the other sandbox's only record**.
- **M9 · No `signal`/timeout on any SDK call**; the detached reaper can hang forever, `stdio: 'ignore'`, exit code discarded — a leak is never surfaced to anyone.

---

## What survived: dependency isolation (all 9 attack routes refuted)

The one claim that held up completely. Independently verified, not taken from the PR's own test:

- No root `package.json` → no workspace hoisting route.
- A bundled SDK **would** be detectable: tsup with `minify:false` emits a `// <module path>` comment per module (`dist/src/index.js:2024` is literally `// src/lib/sandbox/registry.ts`), so the literal-string dist scan is not evadable that way.
- `registry.ts`'s transitive import closure is node builtins only (`continuity.ts`, `lock.ts`, `types.ts` all import nothing else).
- The four non-ctk `dist` bundles are byte-identical to main; the source appears in all five typecheck graphs but tsup is entry-driven and treeshakes it out.
- **Strongest evidence**: inspected the real CC plugin cache at `~/.claude/plugins/cache/claude-forge/`. Packaging dereferences symlinks, ships **no `node_modules`** and **no `tools/`**; `grep -rl "@vercel/sandbox"` over the entire cache → zero files. At the actual install surface the SDK is absent.

The A/B split by dependency weight is the right architecture and should be kept.

---

## Recommended disposition

**Do not merge.** The isolation architecture survives; the teardown/reaper design does not, because it was built on a misreading of what the provider guarantees.

1. **Retract the six restatements of the timeout guarantee** before anything else — shipping the claim is worse than shipping no reaper. This is the 2.9.0 overclaim pattern repeating, in a PR whose CHANGELOG cites 2.9.0's overclaim.
2. **Redesign teardown around what the SDK actually offers**: `persistent: false` and/or `snapshotExpiration` at create; `resume: false` on every attach; map `APIError` 404 → not-found; write a `'provisioning'` row *before* `create()` and reconcile via `Sandbox.list({ namePrefix })`.
3. **Reconsider whether the ctk hook should exist at all in Phase 1.** It is the source of B1, M1, M2, M7, and half of B3's blast radius, and its entire benefit is best-effort cleanup that the launcher's own `finally` already attempts. Deferring it to T4 — when there is a real ADW to clean up after — would shrink this PR to the registry + launcher, which is the half that survived review.
4. If the hook is kept: resolve `runner` to an absolute realpath and verify it is a regular file, not a symlink into the project; attach `child.on('error')`; guard `readFileSync` against non-regular files; filter reaping by `session_id`; fold the gate into `session-end`.
5. **Test fixes**: make the fake record ordered calls so a missing `stop()` fails; give `VercelProvider` its first test; pin the lock, atomicity, shape validation, and the injected clock.

## Process note

Both prior adversarial reviews this milestone found something larger than the PR under review. This is the third, and it did it again. The pattern is now strong enough to treat as a rule rather than a habit: **no ctk change merges without an independent adversarial pass, and the reviewer's brief must name the claim to refute.** A 5813-test green suite, 15/15 CI, and a mutation-tested inertness gate did not surface any of the eleven blocking findings above.
