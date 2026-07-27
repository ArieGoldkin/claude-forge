# Gate 1 — Sandboxed ADW dispatch, Phase 1 pilot (issue #47 / T4)

> **Date**: 2026-07-27 · **Decision**: **ADJUST** (not go, not no-go)
> **Pilot scope used**: **public repo, hand-run, NOT sandboxed** (AC5)
> **Milestone #1 status**: T1 ✅ · R1 ✅ · T2 ✅ · **T4 partially complete** · T3 (#46) not started

## What this document is

#47 says the milestone closes at Gate 1 "regardless of the decision". This records that decision and,
more importantly, records **exactly which capability was and was not exercised**, so the outcome is
never read as broader coverage than it had. That requirement is written into #47's own exit criteria.

## The decision: ADJUST

Neither "go" nor "no-go" is honest. **Go** would claim the substrate works; it was never executed.
**No-go** would claim it failed; it never ran. The pilot as scoped is blocked on prerequisites that
are not defects in the substrate, and the half that did run changed what the other half should be.

## What WAS exercised

A complete ADW, hand-run: `/etk:fix-bug 63` → investigation → fix → tests → must-fail control → PR
#72 → merged as `0c35a2c`. It produced a real, correct fix that closed a real issue.

| Metric | Value |
|---|---|
| wall clock | **476.8 s (7.9 min)** |
| human touches | **0** (single invocation; no unblocking or redirecting input) |
| assistant messages | 60 |
| input | 111 |
| cache_creation | 89,391 |
| cache_read | 19,221,652 |
| output | 73,197 |
| skill attribution | `etk:fix-bug` |

Measured by `tools/adw-metrics/measure-run.mjs` over the transcript window, not by `/usage` — which
is session-scoped and would have been contaminated by the planning that preceded the run.

**Reading the token numbers.** The three classes price differently and are deliberately not summed.
`cache_read` dominates because each of 60 turns re-reads the full cached prefix; it is not 19M fresh
tokens. Converting to currency requires a current pricing reference and is **not estimated here**
rather than guessed.

**A cost fact the pilot surfaced independently**: a forked skill killed after 3 messages still burned
**148,023 cache-creation tokens** establishing context. Every dispatched fork pays a large fixed cost
before doing any work — material to any fan-out dispatcher, and invisible to a wall-clock-only view.

### Answers to the questions Gate 1 exists to ask

| Question | Answer |
|---|---|
| Does a real ADW fit in Hobby's 45 min? | **Yes, with room** — 7.9 min for a small-to-moderate fix. Not evidence for large ones. |
| Both cost axes measured? | **Compute only.** Storage (`snapshotExpirationMs`) is unmeasurable without a sandbox. |
| Does `VercelProvider` work? | **Unknown. Still zero lines executed.** |
| Can an ADW run hands-off? | **0 touches inline** — see the caveat below. |

## What was NOT exercised — read this before citing the decision

- **No sandbox was created.** Nothing in this pilot ran in isolation.
- **`VercelProvider` has still never executed a line.** `resume: false` on attach, the `APIError`-404
  mapping, and whether `Sandbox.get` can reattach to a stopped sandbox all remain compile-checked only.
- **Private-repo dispatch was not exercised** (per the #58 decision). The go/no-go must not be read
  as covering it.
- **Storage cost was not measured.**
- **"0 human touches" is not evidence of unattended viability.** The run was inline, in a session
  under observation, on the host — where a denial is recoverable. In a sandbox, unattended, with a
  terminal-on-denial fork, the same run has a materially different risk profile.

## Why the sandboxed half did not run — three blockers, one downgraded

**U1 — No Vercel SDK credentials.** `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`,
`VERCEL_OIDC_TOKEN` all unset; no `vercel` CLI; no `~/.vercel`. A Vercel *account* exists and is
reachable via MCP (team `team_zZChAPDD8uRI9hQubXyIwsxZ`), but **MCP auth is not an SDK credential**.
ADR-0001:59 anticipated exactly this. Only a human can mint the token. **Still blocking.**

**U2 — No channel to get Claude Code or an API key into the guest.** `ProvisionOptions`
(`provider.ts:94-123`) exposes name, timeouts, source, runtime, vcpus, signal — **no env or secret
path**. The only write mechanism is `seed()`, i.e. writing the key into a file in the guest. This is
a second credential problem structurally identical to #58's, which #58 does **not** cover (#58 is
about the git clone). **Still blocking, and it is the harder of the two.**

**U3 — DOWNGRADED by adversarial review.** Originally recorded as "the provider interface has no read
path, so AC2 has no implementation." The interface half is true; the conclusion was wrong. The SDK
supplies `readFile`, `readdir` and `downloadFile` (`sandbox.d.ts:272,274,756,786`,
`filesystem.d.ts:52,56,95,99`, `session.d.ts:276,306`, `sandbox-user.d.ts:109,136`,
`execution-context.d.ts:63,90`). Returning results is **a wiring task** — one `read()` method
delegating to `sandbox.readFile()` — not a design gap. **No longer blocking.**

## Findings that change what Phase 2 should be

**1. An ADW cannot be piloted in the session that changes it.** `/etk:fix-bug` loads from
`~/.claude/plugins/cache/claude-forge/etk/<version>/`, never the working tree — verified across
every load surface (symlinks, marketplace registration, `config.json`, `installed_plugins.json`,
user/project/managed settings), and confirmed live by the session's own skill directory resolving
into the cache. Worse than one publish cycle: the marketplace clone was found **~28 commits stale**
(`49bc4c4` vs `b0144c9`) despite `autoUpdate: true`. **A dispatcher can be arbitrarily far behind the
repo it was built from, with nothing surfacing that.**

**2. The ADW cannot safely use its own MR-authoring step.** The command routes MR creation through
`/etk:prepare-pr`, which is `context: fork`. A PreToolUse denial is terminal for a fork, and this
repo has a **measured 3-in-12 denial rate** on realistic command text. PR #72's description was
written directly instead. An autonomous workflow whose shipping step is unreliable is not autonomous.

**3. `/etk:fix-bug` is a slash command, so it ran INLINE, not forked.** The fork-death risk was aimed
at the skill's `context: fork` and does not apply to the command path. Good news — and a correction
to this pilot's own Phase-1 design, which had treated fork death as the run's chief threat.

**4. This repo does not produce the ticket shape `fix-bug` is built for.** Issues here are filed
*after* diagnosis, by design. #63 had to be **rescoped by comment** into a genuine open question
before it exercised the OHAOI loop at all. That rescope paid off immediately: the investigation found
a **third** disagreeing name the ticket never mentioned, making the issue's own recommended fix
incomplete. A dispatcher fed this repo's tickets would mostly be executing, not investigating.

**5. Our own security hook denies an ordinary investigation.** 3 of 12 realistic commands for an
env-var investigation were denied on **command text**, not on any resource touched. Two of the three
denied shapes are the natural first moves. Tracked as #65.

## Recommended Phase 2 scope

1. **Resolve U1** — mint a Vercel token; the only true human prerequisite.
2. **Resolve U2** — decide how a credential reaches the guest. The largest remaining design question.
3. **Wire U3** — add `read()` to `SandboxProvider`; small, now that the SDK capability is confirmed.
4. **Re-run this exact ADW sandboxed** and compare against the 7.9 min / 0-touch / 73k-output
   baseline recorded above. That comparison is the whole point of having a baseline.
5. **Fix #65 first if the ADW is to run unattended** — a terminal denial in a sandbox is
   unrecoverable, where on the host it was merely annoying.

## Provenance and honesty notes

- Metrics from `tools/adw-metrics/measure-run.mjs`, whose window filter is verified by a crippled-copy
  control (removing the window comparison makes its self-test exit 1 with Control A failing 4/4).
- The fix's correctness rests on 6643 passing tests **plus** a must-fail control (reverting one side
  of the change kills 38 tests), not on a green suite alone — **but that control covers only the code
  half.** The documentation edit, which the fix itself argues is the more important half, has **zero**
  coverage: corrupting the documented variable name leaves atk (765), shared (1217) and
  `validate-versions.sh` all at exit 0. Tracked as #74.
- **AC2 is now met, and the pass refuted three of five claims.** PR #70's review refuted 2 of 5;
  **PR #72's refuted 3 of 5** — two MAJOR:
  - *the change is tested* — REFUTED, per the line above;
  - *"Option 3 is not needed"* — REFUTED. A **second, independent** derivation of the env var exists
    at `shared/hooks-infra/src/types.ts:1070` (`getHookEnvironment`), public API in all five plugins,
    with zero test references. The decision was taken against one of two sites (#74).
  - *no log relocation* — REFUTED **as stated**, right answer via wrong reasoning. No regression
    shipped, because `0c35a2c` touches no wrapper. The correct invariant is: **the production log
    directory is safe iff `run-hook-wrapper.sh` is unchanged**, *not* because `CLAUDE_PLUGIN_DATA`
    takes precedence. This matters — the wrong reason would have cleared the dangerous variant of
    this fix, where the wrappers change to match the tests and real users' logs move (#75).
- **Pattern worth carrying into Phase 2**: all three refutations were absence-or-coverage claims made
  from reading a single file. That failure mode has now cost four claims across two reviews. Any
  claim of the form "X does not exist" or "X is covered" needs a system-wide search before it ships.
