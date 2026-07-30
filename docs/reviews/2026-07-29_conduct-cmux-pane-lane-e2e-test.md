# Conduct + cmux: pane-lane end-to-end test (2026-07-29 evening)

> **Provenance — ported record, not re-measured here.** A verbatim measurement record from the
> upstream work fork where cmux/conduct were developed. Its `etk` versions belong to **that**
> fork's version line, not claude-forge's (this repo shipped cmux/conduct at etk 2.17.0). Ported
> unedited alongside the skills because `skills/cmux/references/read-and-notify.md` §1 cites its
> §4 as the evidence that screen-scraped collection returns false verdicts. Nothing below has
> been re-run in this repo.

**Under test**: etk 2.25.0 (live in cache), cmux 0.64.20, from inside `workspace:3` ("Claude-plugins").
**Purpose**: close the HIGH ledger item — *"the pane-lane path is documented but STILL NOT JOINED
end-to-end"*. Primitives had each been proven; a real `claude` launched **into** a pane, doing work,
returning a collected sentinel, had never been run.

## Verdict

**The pane-lane path works end-to-end.** Three lanes spawned, labeled, dispatched, did real work,
and returned correct answers. **The collect step, however, is broken in a way that would report
success for work that never happened** — a blocker, found only because the test used ground truths
it could check.

---

## 1. PASS — spawn / placement / labeling

`cmux identify` → `caller.workspace_ref = workspace:3`. Under no divergence
`current-workspace` agreed (both `workspace:3`), so the 2.24.0 container fix could not be
stress-tested this run; that remains verified only from the prior session's divergent case.

Three lanes created with the documented template:

| Lane | Surface | Pane | Label |
|---|---|---|---|
| version-scout | surface:62 | pane:13 | 🔍 version-scout |
| skill-census | surface:63 | pane:14 | 📊 skill-census |
| guard-audit | surface:64 | pane:15 | 🧪 guard-audit |

Verified after spawn:
- all three landed in the **calling** workspace (`workspace:3`), as visible splits, not siblings
- caller's own surface (`surface:7`) **still titled `claude`** — the 2.24.0 bare-`rename-tab`
  defect did not recur
- focus never left `pane:3` (`--focus false` honored)
- `workspace:1/2/4` untouched

## 2. PASS — the 2.25.0 guard, both branches

Failure branch (`--placement dock`):

```
raw OUT = [Error: invalid_params: Dock placement is disabled]   # 49 bytes — captured only because of 2>&1
guard  -> failed closed, real cause printed
ungated awk '{print $2}' would have yielded: invalid_params:
```

Both halves of the fix are load-bearing exactly as the CHANGELOG claims: without `2>&1` the
error is lost to stderr and `$OUT` is empty; with `2>&1` but no `OK surface:` gate, the parse
hands `invalid_params:` to `send` as a surface ref.

## 3. PASS — real agents, real work, correct answers

Each lane ran `cd <repo> && claude "<one-line task>"` via `send` + `send-key enter`.
Ground truths established independently *before* dispatch:

| Lane | Question | Ground truth | Lane answered | |
|---|---|---|---|---|
| 🔍 | etk version in plugin.json | `2.25.0` | `2.25.0` | ✅ |
| 📊 | dirs in etk `skills/` | `27` | `27` | ✅ |
| 🧪 | occurrences of `2>&1` in routing-map.md | `5` | `5` | ✅ |

Each performed genuine tool calls (Read / List / Search visible in-pane) and ended with
`STATUS: DONE`. Single-line dispatch held — no prompt fragment leaked as a second submission.

## 4. BLOCKER — the sentinel collect is contaminated by the echo

`read-screen` cannot distinguish **the dispatched text** from **the program's output**. The
dispatch is echoed on screen, and the dispatch *contains the sentinel literal*. Both documented
collect recipes in `cmux/references/read-and-notify.md` §1 are therefore unsound:

**(a) `STATUS:` — fails OPEN (dangerous).** Measured while `surface:64` was still retrying an
API error and had produced no answer at all:

```
$ cmux read-screen --surface surface:64 --scrollback --lines 40 | grep -oE 'STATUS: (DONE|...)' | tail -1
STATUS: DONE
```

The match came from the echoed instruction *"Then print a final line that is exactly:
STATUS: DONE"*. **Every lane reports DONE the instant it is dispatched** — before doing any
work, and even if it crashes or never runs. An orchestrator that trusts this collects three
green lanes from three dead ones.

**(b) `VERDICT=` — fails CLOSED (misleading, safer).** The §1 example
`pytest -q && echo VERDICT=GREEN || echo VERDICT=RED` echoes **both** tokens, so `tail -1`
returns the last one in the *command string*. Measured with the command still sleeping and
nothing printed:

```
screen:   sleep 45 && echo VERDICT=GREEN || echo VERDICT=RED
collected: VERDICT=RED     # false RED — the command had not finished
```

It happens to fail closed only because `RED` is the second operand. Reorder the `||` and it
fails open too. The safety is accidental, not designed.

**Recommended fix** — converge with the already-adopted *"read-only verifiers must write an
artifact"* item: **the lane writes its result to a file; the screen sentinel is liveness only.**
A file cannot be contaminated by an echo, survives TUI scroll, and is collectible after the
process exits. If a screen sentinel must be kept, the dispatch must not contain the literal
(e.g. instruct the token indirectly), and the collect must scope to content *after* the last
prompt block — both strictly worse than a file.

## 5. Economics — a fleet lane is a full cold-start session

Per-lane footers after answering a one-line question:

| Lane | Cost | Input tokens | Output tokens |
|---|---|---|---|
| surface:62 | $0.45 | 62.4k | 16 |
| surface:63 | $0.44 | 61.1k | 12 |
| surface:64 | ~$0.4 | 61.3k | 12 |

**≈$1.3 and ~185k input tokens to answer three questions answerable by three `grep`s** — two
lane costs read directly at $0.45/$0.44, the third's cost footer was truncated in the terminal
(all three *token* counts are measured), so treat the total as an estimate. Each lane pays full
context rent on cold start (system prompt + ctk's SessionStart continuity injection — the
ledger text is visible in every lane's scrollback) to emit ~12 output tokens.

This is a measured number for conduct's existing *"lowest rung that does the job"* discipline,
and it lands squarely on the token-spend trap named in the maturity assessment. A fleet lane is
not a cheap worker; it is a ~$0.45 minimum-charge session before it does anything.

## 6. Method notes (things that misled me, recorded)

- **A 25-line `read-screen` without `--scrollback` showed a blank viewport for `surface:64`,
  and I initially read that as "the lane never received the prompt."** It had. Same
  *partial-view-is-not-proof* failure the ledger records six times — now seven. Diagnosis needs
  `--scrollback`; the skill's "keep `--lines` small" advice is about cheap *polling*, and should
  say so explicitly.
- **My idle-poll regex included `…`, which matches truncated TUI footer text**, so it reported
  `3/3 busy` for 30 straight attempts and never converged. Self-inflicted — but it is a live
  instance of §1's own warning that TUI-glyph heuristics are unreliable, and the STATUS sentinel
  it recommends instead is the one broken in finding 4.
- **`surface:65` disappearing was the operator closing it**, not a defect. I had begun building a
  "lane panes vanish when their command exits" theory; the user corrected it before it was
  written up. Recorded because the near-miss is the point: an unexplained observation is not
  yet a finding.
- **`cmux --help` does not list `workspace-group`**, though the verb exists
  (`workspace-group requires a subcommand. Try: list, create, ungroup, …`). The join-group
  placement branch is fine. Same incomplete-help trap that previously produced a false
  "the verbs don't exist."
- **Bash was briefly blocked mid-test** because the auto-mode classifier model (Sonnet 5) was
  unavailable — a real availability cost of the `classifyAllShell` posture worth knowing about.
- **`close-surface` echoes a ref that is NOT the one it closed**: closing `surface:62` replied
  `OK surface:66`, closing `surface:63` replied `OK surface:67` (presumably the newly-selected
  surface). A teardown step that parses that ref as confirmation is reading the wrong object —
  verify teardown with `cmux tree`, not with `close-surface`'s own output.

## Teardown

Closed only the three self-created surfaces; cleared the three status pills. `cmux tree` confirms
`workspace:3` back to baseline (`pane:3` / `surface:7` "claude") and all four workspaces present.

## Follow-ups

1. **(BLOCKER)** Fix the collect protocol — `read-and-notify.md` §1 + conduct's emit templates.
   File-based result collection; screen sentinel demoted to liveness.
2. **(MEDIUM)** Document `--scrollback` as mandatory for diagnosis vs polling in §1.
3. **(MEDIUM)** Note the per-lane cold-start cost in conduct's Phase-3 confirm box, so the
   "Sessions: N (cost note)" line carries a real number (~$0.45/lane floor).
4. Container-axis divergence was **not** re-exercised this run (focused == caller). Unchanged
   from prior verification.
