# Fleet test: shard fan-in against the live 2.26.0 file-based collect contract

> **Provenance — ported record, not re-measured here.** A verbatim measurement record from the
> upstream work fork where cmux/conduct were developed. Its `etk` versions and commit refs belong
> to **that** fork's version line, not claude-forge's (this repo shipped cmux/conduct at etk
> 2.17.0); the plugin set it shards over (`cotk`/`ttk`/`wtk`) exists only there. Ported unedited
> alongside the skills because `skills/cmux/references/agent-fleets.md` § Fan-in and
> `skills/conduct/references/routing-map.md` §5 cite it as the evidence for the three-gate
> reconcile. Nothing below has been re-run in this repo.

**Date**: 2026-07-29 (late evening) · **cmux** 0.64.20 · **etk** 2.26.0 (live in cache, `main @ 721dc26`)
**Purpose**: first end-to-end exercise of `collect_lane` driving a real multi-lane fan-out, and a
deliberate test of the handoff's prediction that **the next defect would be in synthesis / fan-in**.

## Result in one line

`collect_lane` **passed** its first real fan-out (3/3 lanes correct). The **fan-in reconcile fails
OPEN** — the predicted defect, at the predicted stage, one link later than 2.26.0's.

## Test design — checkable ground truths, established BEFORE dispatch

Metric: count of `SKILL.md` files exceeding 150 lines (the soft size flag from CLAUDE.md's skill
hygiene rules). Chosen because it is **computed, not documented** — no doc states these counts, so a
lane must actually do the work rather than read the answer out of a table.

A first candidate (`effort: xhigh` counts) was **rejected**: 5 of 8 plugins were `0`, so a lane that
did nothing and returned `0` would have looked correct by accident. Ground truths must be values a
non-working lane cannot produce.

| Shard | Scope | Ground truth |
|---|---|---|
| 🔵 shard-1 | etk | **19** |
| 🟢 shard-2 | dtk + atk | **20** |
| 🟡 shard-3 | ftk + ctk + cotk + ttk + wtk | **11** |
| **fan-in** | reconciled total | **50** |

All three non-zero and distinct, so neither a stalled lane nor a guess lands on the right answer.

## What passed

- **Per-lane correctness 3/3**: 19 / 20 / 11, all exact. shard-1 independently reproduced the exact
  top-5 file list and correctly identified the smallest over-threshold file (`hipaa-compliance-checker`
  at 159 lines).
- **`collect_lane` end-to-end, first time**: all 3 lanes collected `DONE` from their result files.
- **The 2.26.0 A/B reproduced live at N=3.** 18s after dispatch, when nothing could possibly be
  finished:

  | Channel | shard-1 | shard-2 | shard-3 |
  |---|---|---|---|
  | New file contract | NOT DONE (`no result file`) | NOT DONE | NOT DONE |
  | Old screen grep | **DONE** ← false green | **DONE** ← false green | not done |

  Note the old recipe is not even *consistently* wrong — shard-3 read "not done" because its dispatch
  had not yet rendered. Nondeterministic false greens are harder to debug than reliable ones.
- **Placement, labeling, teardown**: 3 visible splits in the calling workspace, targeted `rename-tab`,
  `--focus false` held, scoped close, `workspace:3` verified back to baseline (`surface:7` only) and
  all other workspaces untouched. Held pile 14 before and after; `.develop/` invisible to git.

## The finding — fan-in reconcile fails OPEN (blocker)

No executable reconcile is shipped. `routing-map.md` §5 gives **prose only**:

> "Collect from the FILES into one map (a slice with no file, or no final STATUS: line, did NOT
> finish — do not silently drop it); flag any agent that left its lane."

`conduct/SKILL.md` Phase 5 adds "the reconciliation IS the deliverable". Neither supplies a
mechanism. Measured against the reconcile an orchestrator naturally writes:

```bash
total=0
for s in shard-1 shard-2 shard-3; do
  n=$(grep '^COUNT:' "$TEAM/$s.md" | awk '{print $2}')
  total=$((total + n))
done
```

| Injected lane failure (truth = 50) | Reconciled total | Direction |
|---|---|---|
| all three intact | 50 | correct |
| shard-2 file **absent** (never ran) | **30** | **fails OPEN** |
| shard-2 `DONE` but **no `COUNT:` line** | **30** | **fails OPEN** |
| shard-2 `COUNT: twenty` (non-numeric) | **30** | **fails OPEN** |
| shard-2 `STATUS: BLOCKED` | **30** | **fails OPEN** |
| shard-2 **empty file** | **30** | **fails OPEN** |
| shard-2 states `COUNT:` **twice** | *(empty)* | fails closed, garbage output |

Five distinct failures all yield **30** — silently, with no warning, and **indistinguishable from
each other and from a legitimate 30**. Root cause: `$((total + n))` treats an empty or non-numeric
`n` as `0` in both shells. **Shell-independent** (bash and zsh both → 30); unlike 2.26.0's
`|| continue`, no shell accidentally saves you.

### The non-obvious part: gating on `collect_lane` is NOT sufficient

The obvious fix — "run `collect_lane` before summing" — closes only half the cases:

| Shape | `collect_lane` | Reconcile |
|---|---|---|
| file absent | `1` NOT-DONE ✓ caught | 30 |
| empty file | `1` NOT-DONE ✓ caught | 30 |
| `STATUS: BLOCKED` | `2` ESCALATE ✓ caught | 30 |
| `DONE`, no `COUNT:` line | **`0` DONE** ✗ passes | **30** |
| `DONE`, `COUNT: twenty` | **`0` DONE** ✗ passes | **30** |
| `DONE`, `COUNT:` twice | **`0` DONE** ✗ passes | *(empty)* |

`collect_lane` validates the **sentinel**; the reconcile reads a **different field** (`COUNT:`) with
no validation. Three shapes pass the sentinel gate and still corrupt the total. So the fix needs
*both* a `collect_lane` gate **and** payload validation + a shard-count assertion.

### Why the defect landed exactly here

`agent-fleets.md` has a **full, hardened executable recipe for race winner selection** (lines 95–133 —
the 2.26.0 event-loop fix) and **no fan-in section at all**. Its headings: tiers, layout, identity,
dispatch contract, race, develop, claude-teams. Meanwhile `routing-map.md` §2 cites *"agent-fleets.md
conventions"* for "Broadcast fan-out + reconcile" — **a citation to content that does not exist**.

2.26.0 hardened the race gate because that is where the review looked. The shard/broadcast reconcile —
the *other* fan-in path — was never given a mechanism. This is the 2026-07-29 durable lesson firing
again one level up: **a contract expressed in prose needs a prose-shaped completeness check**, and a
code-shaped grep over the race recipe would report the fan-in as covered.

## Second finding (minor, self-inflicted but a real gap)

`rename-tab --surface "" --workspace <ws> <title>` **silently retitles the caller's tab** — an
empty-string ref is treated as *absent*, degrading to the documented "never emit a bare `rename-tab`"
failure. My own tab was renamed to "🔵 shard-1 etk" and had to be restored. The docs warn against a
*bare* call; they do not warn that **a targeted call with an unset/empty variable is equivalent to a
bare one**. Cause on my side: sourcing a `lanes.env` containing `shard-1=surface:71` fails under zsh
(dashes are invalid in variable names), leaving the ref empty. Two cheap mitigations: refuse to
dispatch/label on an empty ref (`[ -n "$SURF" ] || exit 1` — I added this before dispatch and it would
have caught it), and never use dash-containing names as shell variables.

## Economics — firmer than last session

All three footers read directly (last session's third lane was truncated, making its total an estimate).

| Lane | Cost | Input | Output |
|---|---|---|---|
| shard-1 | $0.54 | 65.1k | 173 |
| shard-2 | $0.60 | 64.8k | 148 |
| shard-3 | $0.57 | 64.9k | 319 |
| **total** | **$1.71** | ~195k | 640 |

**~$0.57/lane, against the ~$0.45 currently documented** — the shipped figure is ~27% low. It appears
in `read-and-notify.md` §1 (the re-dispatch cost argument), `conduct/SKILL.md` Phase 3, and the 2.26.0
CHANGELOG. Input holding at ~65k for ~200 output tokens re-confirms ctk's SessionStart injection as
the dominant term, and strengthens the pending "scope SessionStart off for lane sessions" item.

## Fix — SHIPPED as etk 2.27.0

1. **`agent-fleets.md` § Fan-in** — a new executable three-gate reconcile (`collect_lane` +
   payload validation + slice-count assertion that withholds the aggregate). Repairs
   `routing-map` §2's and §5's citations, which now both resolve to it.
2. **Cost corrected ~$0.45 → ~$0.57** in `read-and-notify.md` §1 and `conduct/SKILL.md` Phase 3.
   **Deliberately NOT corrected in the 2.26.0 CHANGELOG entry** — it was an honest estimate at the
   time, and rewriting it would hide that the number moved. The 2.27.0 entry records the
   supersession instead. (So: two sites changed, not the three this doc first recommended.)
3. **Two gotchas added** — the empty-`--surface` ref, and `conduct` Phase 5 must report the slice
   census (`got/expected` + dropped slices by name) before any aggregate.

**A blocker was found inside the fix itself.** The first draft used `SLICES="a b c"; for s in
$SLICES`; zsh does not word-split an unquoted expansion, so the loop ran **once** with
`s="shard-1 shard-2 shard-3"`, `expected=1`, and the assertion rejected *every valid fleet*.
Fail-closed, so safe — but the recipe never worked. `bash -n` and `zsh -n` both passed: valid
syntax, different semantics. Caught only by **executing the extracted block**. Replaced with POSIX
`set --` + `"$@"`. Final verification: the recipe extracted verbatim from the shipped markdown, run
against all 7 shapes in **both** bash and zsh with the executed count asserted — 7/7 correct in
each, and every drop now names a distinct reason instead of collapsing to one plausible number.

## Prediction for the next run

The defect has moved one stage later every release: 2.24.0 *where* a lane lands → 2.25.0 whether it
*starts* → 2.26.0 whether it *collects* → 2.27.0 whether the collected results are *honestly
aggregated*. The next unexercised stage is what happens **after** a correct aggregate: hand-off /
re-dispatch of a partially-failed fleet (the "do not silently drop it, re-dispatch it" path), which
nothing has yet driven.

STATUS: DONE_WITH_CONCERNS
