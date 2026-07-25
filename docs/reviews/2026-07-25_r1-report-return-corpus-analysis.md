# R1 (#43) — Report-return path: corpus analysis

> **Phase**: `/etk:develop` Gate + Hypothesize for issue #43 (milestone #1).
> **Date**: 2026-07-25 · **Method**: static analysis of every subagent transcript on this machine for this project.
> **Corpus**: 68 `agent-*.jsonl` transcripts across all sessions in `~/.claude/projects/-Users-ariegoldkin-Arie-projects-claude-plugins-main/*/subagents/`.
> **Status**: measurement complete; controlled experiment NOT yet run. Findings below are *observational and confounded* — see Limits.

## Headline

**12 of 68 transcripts (18%) end without the agent ever writing a trailing report.** Of those 12, **7 end exactly on a `BLOCKED: Command references protected resource` tool_result** — a denial from *our own* `security-blocker` hook. That is the single largest identified cause of lost subagent reports in this repo.

## Metric definitions (so these numbers are auditable)

- **"No trailing report"** = the transcript's last assistant *text* block occurs at an index earlier than its last `tool_use`. I.e. the agent's final act was a tool call, never a written conclusion. This is a proxy for "the caller got no report," not a direct measure of delivery.
- **"Dangling tool call"** = a `tool_use` id with no matching `tool_result`. This would indicate the agent was killed *mid-call*.
- **"Terminal denial"** = the final (or penultimate) record is a `tool_result` containing `BLOCKED: Command references protected resource`.

## Results

| Measure | Count | Notes |
|---|---|---|
| Transcripts analyzed | 68 | all sessions, this project |
| No trailing report | 12 (18%) | |
| ...ending on a BLOCKED denial | **7** | the terminal-denial class |
| ...other / unexplained | 5 | includes 1 forked-skill, 1 with 0 denials |
| **Dangling tool calls** | **0 / 68** | **no agent was killed mid-call** |
| Transcripts hitting ≥1 denial anywhere | 23 | |
| ...survived it and still reported | 13 (57%) | a denial is *not* automatically fatal |
| ...did not report | 10 (43%) | |

### By task kind

| Kind | n | No trailing report |
|---|---|---|
| `plain` (unnamed subagent) | 49 | **11 (22%)** |
| `in_process_teammate` (named) | 19 | **1 (5%)** |

### Denial patterns observed (all occurrences)

| Pattern | Hits | Status |
|---|---|---|
| `\/private\/tmp\/` | 12 | **Already fixed** — current source carves out the scratchpad |
| `\.env\b` family (incl. `.envrc`) | 7 | live |
| `${match.pattern.regex.source}` | 7 | template-literal leak in a denial message (cosmetic bug) |
| `\/usr\/`, `\/etc\/`, `\/var\/` | 5 | live |

## Finding 1 — our own security hook is the dominant known cause of lost reports

7 of 12 lost reports end on a `BLOCKED` denial. The mechanism is *not* a kill: zero transcripts have a dangling tool call, so every denial returned a normal (error) `tool_result`. The agent **receives** the denial and then stops without writing a conclusion.

Reproduced live on 2026-07-25: a Bash call from the *main thread* carrying a protected literal was denied. The main thread received the error and continued normally. That asymmetry — main thread survives a denial, subagent tends not to — is the mechanism worth targeting.

## Finding 2 — the scratchpad collision was real, and is already fixed

`\/private\/tmp\/` is the most frequent denial pattern (12 hits). Claude Code assigns each session a scratchpad under `/private/tmp/claude-<pid>/…` and instructs agents to use it — so agents following the harness's own instruction were tripping our blocker.

Current source (`shared/hooks-infra/src/hooks/pretool/security-blocker.ts:215`) reads:
```
/\/private\/tmp\/(?!claude-\d+\/)/
```
The negative lookahead exempts the scratchpad; `:219` adds a traversal guard for `..` inside it. **The 12 observed hits predate this carve-out.** No action needed — recorded so the historical counts are not mistaken for current risk.

## Finding 3 — the standing "don't name agents" mitigation is not supported by this corpus

The ledger's mitigation is *stop naming agents*, on the theory that named agents become `in_process_teammate` and lose reports. In this corpus the association runs the **other way**: unnamed agents fail to leave a report **4× more often** (22% vs 5%).

**Do not act on this yet.** It is severely confounded:
- Named agents were used for long structured tasks (retheme, genericizer, reviewers) that naturally end in a written summary.
- Unnamed agents include many short search/scan dispatches with different ending conventions.
- The corpus is contaminated by post-hoc `SendMessage` resumes (at least one transcript gained its trailing report only after being resumed).
- "No trailing report" is a proxy, not a measure of what the caller received.

The honest conclusion: **the corpus does not support "unnamed is safe."** It does not establish the reverse either. Naming may simply be the wrong variable — *denial exposure* explains more of the variance.

## Hypotheses to test (Build phase)

- **H1 — Terminal denial.** A PreToolUse deny returned to a subagent frequently prevents it from writing its report (~43% fatality among agents that hit one). *Test:* dispatch a subagent that deliberately trips a denial mid-task; observe whether it still concludes.
- **H2 — File-based return is immune.** A result written to disk (or returned as a process exit code) does not traverse the agent-return path and therefore survives both the denial-termination and premature-return modes. *Test:* same probe as H1, but the agent writes findings to a file *before* concluding; check whether the file survives when the return value does not.
- **H3 — Naming is not the primary factor.** Denial exposure predicts report loss better than `taskKind`. *Test:* 2×2 — {named, unnamed} × {denial, no denial}.

**H2 is the one that matters for the milestone.** If it holds, T3's dispatcher should collect results from **files + exit codes**, never from the agent's return value — which would make the sandboxed ADW structurally immune to the defect rather than merely lucky.

---

# Controlled experiment (2×2) — run 2026-07-25

Approved design: `{named, unnamed} × {trips a denial, clean}`. Each probe writes a proof-of-work file **before** step 2, runs step 2, writes a second proof-of-work file **after**, then emits a fixed completion line. Denial trigger = a read-only `cat` of a protected system path (harmless; blocked by our own hook). Probe instructions were placed in files so no protected literal appeared in the dispatch prompts.

## Results

| Probe | named | denial | Last transcript event | Returned to caller | `pre` file | `post` file |
|---|---|---|---|---|---|---|
| **A** | no | no | text `PROBE A COMPLETE` | ✅ `PROBE A COMPLETE` | ✅ | ✅ |
| **B** | no | **yes** | **`BLOCKED` tool_result** | ❌ **preamble only** (`"I'll read the probe file first."`) | ✅ | ❌ |
| **C** | yes | no | text `PROBE C COMPLETE` | n/a — mailbox (by design) | ✅ | ✅ |
| **D** | yes | **yes** | **`BLOCKED` tool_result** | n/a — mailbox | ✅ | ❌ |

**Turns after the denial: 0 of 0.** In both B and D the `BLOCKED` tool_result is the *final record* in the transcript (B: record 12 of 12; D: record 14 of 14). There is no assistant message after it.

## Finding 4 — a denial is terminal for *execution*, not merely for the report

Both denial probes stopped dead at the denial. They never ran STEP 3, despite instructions stating three times — in the dispatch prompt and twice in the instruction file — that the block was expected, was a success condition, and that they must continue.

Because there are **zero assistant turns after the `BLOCKED` result**, this is not the model deciding to give up. The agent is never handed a turn in which to react. This is harness-level termination of the subagent.

This reframes the whole issue: it is not primarily a *delivery* defect. Work scheduled after a denial **never happens at all**.

## Finding 5 — H2 is REFUTED as stated; the real principle is incremental checkpointing

The hypothesis was "a result written to disk is immune, because it does not traverse the agent-return path." **False in the general case.** What survives is anything written *before* the terminating event:

- `pre` files: **4/4 present** (all written before step 2)
- `post` files: **0/2 present** in the denial cells (scheduled after step 2)

A file is not magically durable — it simply persists if it already exists. **A dispatcher that writes its results at the end loses everything when a denial lands mid-run.** The correct design rule for T3 is therefore *incremental checkpointing*: persist partial results continuously as work proceeds, never as a final step.

## Finding 6 — H3 confirmed: naming is irrelevant to this failure mode

B (unnamed) and D (named) failed **identically**. `taskKind` had no effect on termination. The corpus's apparent named-vs-unnamed gap (22% vs 5%) is therefore a confound, not a cause — the real variable is *denial exposure*.

**Consequence: the ledger's standing mitigation ("stop naming agents") does not address this failure mode at all.** It should not be relied on as protection against lost reports. Note separately that named agents legitimately return via mailbox rather than through the tool result (probe C behaved correctly), which is by design and not a defect.

## Finding 7 — the blocker's text matching produces agent-killing false positives

`security-blocker` matches **command text**, not resolved paths. During this session alone, two of *my own* completely harmless commands were denied:

1. a `sed` expression written to *redact* a protected path for safe display — the redaction pattern itself contained the literal;
2. a `grep` pattern searching for the protected-path patterns in the hook's own source.

Neither command would have read anything sensitive. Each such false positive **terminates a subagent outright**. This is the mechanism behind 7 of the 12 historical lost reports, and it is self-inflicted: our own security control is the largest known cause of lost agent work in this repo.

## Experiment limits

- **n = 1 per cell.** The effect is binary and unambiguous (execution stops dead, 0 turns after), and it is corroborated by 7 independent historical cases — but this is not a rate estimate.
- Only one denial pattern was exercised (`/etc/`). Other protected patterns are assumed to behave the same; unverified.
- The experiment shows termination *given* a denial. It does not measure how often a real dispatched ADW would trip one.
- Whether a denial is terminal is CC harness behavior, not something the hook's output shape controls. Not independently verified against CC source.

## Limits (stated so nothing here is over-read)

- Observational, single-machine, single-project corpus. No control group.
- "No trailing report" is a proxy for delivery failure; it does not prove the caller received nothing, nor that the agent's work was lost (it demonstrably was not — full findings were recovered from disk in the 2026-07-25 verifier incident).
- Transcripts are live-updated by resumes, so counts drift.
- The 5 non-denial no-report cases are unexplained and may be a distinct failure mode.
