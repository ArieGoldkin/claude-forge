# #65 approach 7A — end-to-end validation (ctk 2.13.0)

> Date: 2026-07-30 · Session `755bc17d-129e-42f7-87c3-ca350a7ac450`
> Closes the top pending item from `handoffs/2026-07-30_denials-stop-killing-agents-and-a-premise-i-tested-during-an-outage.yaml`
> Verdict: **7A CONFIRMED on the Bash denial path.** A `security-blocker` Bash denial no longer terminates the subagent that receives it.

## The gap this closes

PR #84 (ctk 2.13.0) changed `outputDeny` to carry a denial via `permissionDecision: 'deny'` with
`continue: true`, instead of `continue: false`. The spike that motivated it proved survival for a
**`Read`** denied by `read-cache`. That `security-blocker`'s **Bash** denials are also survivable
*followed from* the shared `outputDeny` contract but **had never been observed**. This is that
observation.

## Preconditions (verified by content, not by a reload message)

| Check | Method | Result |
|---|---|---|
| 2.13.0 actually installed | `installed_plugins.json` `installPath` | `cache/claude-forge/ctk/2.13.0` — all 5 plugins match main |
| 7A present in the loaded code | grep installed `dist/bin/run-hook.js` | `outputDeny` emits `continue: true` + `permissionDecision: "deny"`; no `continue: false` |
| `isDenyDecision` widened (#83) | same bundle, line 59 | `result.continue === false \|\| result.hookSpecificOutput?.permissionDecision === "deny"` |
| No surviving terminal deny path | `grep -c 'continue: false'` | 2 hits: 1 comment + `pre-compact-saver` (a **PreCompact** block — correct by design, not a tool denial) |

### Hook liveness — established BEFORE treating any result as evidence

This is the control whose absence inverted a design recommendation on 2026-07-30 (a premise measured
inside the #82 outage, where "allowed" meant "nothing ran"). Established two independent ways:

1. `failure-logger` wrote a WARN entry stamped with **this** session id at `11:35:50.477Z`, in
   response to a deliberate benign failure (`ls` of a nonexistent path).
2. The `read-cache` delta hook **intercepted a Read live** and returned a unified diff via
   `additionalContext` instead of file content.

## Design

No *concurrent* `continue:false` control is constructible: 2.13.0 is installed session-wide and every
tool-denial path now routes through the fixed `outputDeny`. The `continue:false` control is therefore
**historical** — last session's two-cell experiment, where the control cell wrote `before`, hit a real
deny, and never wrote `after`.

What is constructible, and what guards the real risk here (a **void experiment** that looks like a
passing one), is a **harness control**:

- **Cell T (treatment)** — write `before`, trigger a real `security-blocker` Bash denial, write
  `after`, write a report. `after` existing is the measurement.
- **Cell H (harness control)** — byte-identical step shape, but three ordinary commands that are not
  denied. If T produced no files, H distinguishes "the denial killed it" from "the Write mechanism,
  working directory, or permission environment was simply broken."

Both cells: `general-purpose` (the agent type that survives; `etk:adversarial-verifier` has no
`Write`), **unnamed** (named agents become `in_process_teammate` and lose their returns), write-first
mandate, and an explicit honesty clause requiring cell T to self-label **VOID** if no denial occurred.

## Result

**Cell T: PASS, and valid rather than void.**

| Evidence | Value |
|---|---|
| `cellT-before.txt` | `cellT before 2026-07-30T11:38:24Z` |
| **Denial** (independent, from ctk's own log) | `11:38:33.349Z [PERMISSION] decision=deny tool=Bash agent_id=a15fc1d00025a5f26 agent_type=general-purpose` |
| `cellT-after.txt` | `cellT after 2026-07-30T11:38:38Z` / `attempts: 1` |
| Tool calls after the denial | 3 (`date -u`, then both Writes) |

The chain of custody is what makes this more than a self-report: the logged denial sits **between**
the two marker files in time, and its `agent_id` matches the id the Agent tool returned for cell T
exactly. Under pre-2.13.0 `continue: false`, `cellT-after.txt` could not exist.

The denial was obtained on the **first** attempt — a bare `echo` of an env-file literal, touching no
file. That is the #65 false-positive class itself: the `if`-gate is 20 destructive-verb globs, `echo`
matches none of them, and it is denied anyway. (Still unexplained; see open questions.)

**Cell H: PASS.** All three ordinary commands logged `decision=allow`; all files written. The
apparatus is sound and the environment is not denying indiscriminately.

**Denial text is authentic, not reconstructed.** Both strings cell T quoted exist verbatim in the
installed bundle: the non-fatality notice at line 2332 and `BLOCKED: Command references protected
resource` at line 2550.

**#77's redaction and its fallback both hold.** The text delivered to the agent names no literal,
while `hooks.log` still records the full pattern
(`[WARN] [pre-tool-use-security] Blocked: … Pattern: (?<![\w.-])…`). That is the "check the fallback
exists before citing it" fix working as intended — the information was relocated, not destroyed.

## What this does NOT establish

- **One denial, one attempt, one depth.** Nothing here speaks to repeated denials within a single
  agent, and nothing to denials in a nested subagent (nesting is disabled by configuration in this
  repo — every agent excludes `Agent`/`Task` from its `tools:`).
- The control is **historical, not concurrent**. Stated plainly rather than implied.
- 7A's accepted tradeoff is unchanged and untested here: the failure mode moved **fail-closed →
  fail-open**. If a future CC release stopped honouring `permissionDecision` on an event, a denial
  degrades to an *allow*, not a stop.

## Incidental findings

### 1. The #80 probe HAS propagated into the fresh install (predicted, confirmed — and now CLEANED)

The ledger warned the git-dirty marketplace clone would keep seeding new installs. It did:
`cache/claude-forge/ctk/2.13.0/hooks/bin/monitor-forward.sh` carried the probe, plus its
`.issue80-bak`. `monitor-forward.sh` is wired to ~20+ events, so the probe ran a `cat`, a `sed`, and
an append on essentially every hook event, writing into **last** session's scratchpad
(`…/1ffd512a-…/scratchpad/issue80-round2-markers.tsv`, which still exists). 464 markers at the
time of the tally in finding 3 below, still growing — 471 by the time of the restore a few minutes
later, which is the number the behavioural confirmation freezes at.

Not dangerous: the script has no `set -e`, so the append cannot change its exit status, and stdin was
correctly re-piped to `curl`, so monitor forwarding kept working.

**⚠ The cleanup was FOUR copies, not the two the ledger implied.** A `find` census over the whole of
`~/.claude` turned up armed copies in the marketplace clone **and in `cache/ctk/2.11.0`, `2.12.0`, and
`2.13.0`** — each seeded while it was the live install. Fixing only the pair named in the handoff
would have left two armed copies behind, and 2.12.0 in particular is one rollback away from being
live again. This is the standing lesson: run the system-wide census before believing a cleanup is
complete.

**Cleanup performed and verified (2026-07-30):**
- All four `.issue80-bak` files verified to contain no probe marker, and verified byte-identical to
  the repo's clean file (so `monitor-forward.sh` did not change across 2.11.0→2.13.0).
- Three cached installs restored from **their own** backups; the marketplace clone restored with
  `git checkout --` (git is authoritative there, and the probe was its only uncommitted change).
- Verified after: zero files under `~/.claude/plugins` contain `ISSUE-80`, zero `.issue80-bak` remain,
  the clone's working tree is **clean**, and the restored files are byte-identical to the repo's.
- **Behavioral confirmation:** the marker file froze at 471 lines. Command hooks are re-read from disk
  per invocation, and several `PostToolUse`-generating tool calls followed the restore with no new
  appends. Stimulus present, response absent — a valid null, unlike finding 3's `CwdChanged` entry.

### 2. The probe's tag can no longer discriminate the load path

All 464 markers read `A-marketplace-clone` — but the cache copy inherited that same `PROBE_TAG` when
it was seeded from the clone. **Both copies now report the same tag**, so this says nothing about
which copy is loading. Recorded because the naive reading ("the clone is the load path") is exactly
the kind of inference this repo keeps paying for.

### 3. Observed event tally (464 plugin-hook invocations)

`PostToolUse` 319 · `SubagentStop` 50 · `Stop` 33 · `Notification` 28 · `SubagentStart` 9 ·
`PostToolUseFailure` 9 · `SessionStart` 7 · `SessionEnd` 5 · `StopFailure` 3 · `ConfigChange` 1.

- **`FileChanged`: zero firings** across a session with many Write/Edit operations — consistent with
  last session's six-mutation-shape null result.
- **`CwdChanged`: zero — but with no stimulus.** No directory change was performed this session, so
  this is an absence without a test and is **not** evidence about `CwdChanged`. Last session measured
  it firing twice from a plugin hook.
- `SubagentStart`, `StopFailure`, and `ConfigChange` are live and were observed directly.

## Open questions (unchanged or newly sharpened)

- **Why does the 20-glob `if` gate not confine `security-blocker`?** A bare `echo` with zero file
  access reaches it and is denied. Re-confirmed here as the first attempt of cell T. Still
  unexplained — do not design against the gate's semantics.
- Does `permissionDecision: 'ask'` resolve as *ask* inside a subagent, or degrade to deny? Untested;
  gates the stronger form of 7A.
- Does an agent survive **repeated** denials in one run? Untested.
