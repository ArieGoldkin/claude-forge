# Fleet test: re-dispatching a partially-failed fleet (etk 2.28.0 live)

> **Provenance — ported record, not re-measured here.** A verbatim measurement record from the
> upstream work fork where cmux/conduct were developed. Its `etk` versions belong to **that**
> fork's version line, not claude-forge's (this repo shipped cmux/conduct at etk 2.17.0). Ported
> unedited alongside the skills because `skills/cmux/references/agent-fleets.md` § Give-up bound
> cites it as the evidence for the retry bound and the per-lane cost figures. Nothing below has
> been re-run in this repo.

**Date**: 2026-07-30 (just past midnight; continuation of the 07-29 session) · **cmux** 0.64.20 · **etk 2.28.0** serving from cache
**Purpose**: first drive of the stage after a correct fan-in refusal — "do not silently drop it, *retry* it". The 2.27.0 prediction said the next defect lives here.

## Result in one line

**The prediction was refuted — first time in four stages.** The re-dispatch path worked on first
drive: census refused at 2/3, named the dropped lane, the retry landed in the same pane with a
corrected path, and round-2 census published 260 = ground truth 260, per-lane 98/73/89 all exact.

## Design

3 📊 Auditors (2.28.0 roster labels, banners via `ident()`, fleet pill + census-driven progress on
the one workspace), counting `*/references/*.md` per slice — computed, undocumented ground truths
measured before dispatch: **etk=98 · dtk+atk=73 · ftk+rest=89 · total=260**. Lane 3 **deliberately
sabotaged** with the documented relative-path mistake (`team-rel/…` instead of `$TEAM/…`).

## What the sabotage proved

The lane finished and wrote a **flawless** result — `COUNT: 89` (exact), proper sentinel, correct
`find -L` methodology — into `$REPO/team-rel/` where the census never looks. The census dropped it
as `auditor-ftk-rest(no-verdict)` and refused to publish. **A lane can be 100% correct in content
and still rightly refused for breaking the path contract** — hunting for misplaced files would be a
new fail-open, so the refusal is the correct behavior, not a false negative.

## What the re-dispatch drive proved

- **Retry into the same pane works** — a fresh `claude` session in the dropped lane's pane, dispatch
  corrected to the absolute path; landed in ~80s.
- **The census is double-count-safe by construction** — round 2 recomputes from files over ALL
  slices rather than adding a delta, so the earlier partial sum cannot leak into the final total.
- **Immediate-refusal A/B reproduced again** (third live reproduction): census at T+0 read 0/3
  all-no-verdict — correct refusal — while the old screen recipe would have said DONE.

## Incidental but important: the classifier outage as a cost multiplier

The session-long `claude-*[1m]` auto-mode classifier flapping (blocked Bash in waves on the
orchestrator side) also hit the **etk lane inside its own session** — its result file records ~19
blocked retries before a background-Bash workaround. Cost consequence, footers read directly:

| Lane | Cost | Input |
|---|---|---|
| auditor-etk (fought the outage) | **$8.43** | **158.4k** |
| auditor-dtk-atk | $1.02 | 63.6k |
| auditor-ftk-rest (retry session) | $1.28 | 64.9k |

A lane that retries through an outage re-bills its context repeatedly: **~8× the cost of its
peers for the same work**. Fleet economics planning should treat platform outages as a cost
multiplier, not just a latency source. (Also note baseline crept: ~$1.0–1.3/lane here vs $0.54–0.60
on 07-29's fleet — task length differs; the documented "~$0.57+" floor phrasing still holds.)

## Caveats — what this test did NOT cover

- Only the **no-verdict/no-file** drop shape was retried. `BLOCKED` (escalate — deliberately NOT
  auto-retried per `collect_lane`'s contract) and the payload shapes (`COUNT x0` / non-numeric /
  `COUNT x2`) were not driven through a retry round.
- One retry round; no retry-of-a-retry, no give-up bound. Nothing documents **when to stop
  retrying** — that is now the sharpest remaining gap, and the honest successor prediction.
- The stray `team-rel/` file was removed at teardown; a real orchestrator should probably *report*
  a found stray as diagnostic context even though it must never *collect* from it.

## Ops record

Stage A→E staged script (`redispatch-fleet.sh`, session scratchpad), each stage evidence-printing.
Teardown tree-verified: workspace back to baseline, pills/progress cleared, stray dir removed,
held pile 14 throughout, no untracked residue (`.develop/` gitignored).

STATUS: DONE
