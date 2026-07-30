# Conduct fleet: first execution in claude-forge (2026-07-30)

**Under test**: etk 2.17.1 (installed, `gitCommitSha 351bad3`), cmux 0.64.20, from inside
`workspace:2` ("Claude-plugins"). **Purpose**: close the "installed and loaded but never RUN"
gap — conduct had been verified as present and loadable, never as *working*, in this repo.

## Verdict

**The fleet path works end-to-end.** 3 lanes spawned, labeled, dispatched, did real work,
wrote result files, and the three-gate fan-in published a total that is **correct**.

**The only thing that failed was my ground-truth control.** The fleet disagreed with it, and
the fleet was right.

## Design

Metric: `SKILL.md` files exceeding 150 lines (the repo's own soft size flag) — chosen because
it is *computed*, so a lane that does nothing cannot produce it. Three file-disjoint slices.
Ground truth was established BEFORE dispatch and required to be all-non-zero and all-distinct,
so neither a stalled lane returning 0 nor a guess could land on it.

| Lane | Slice | My control | Lane reported | True |
|---|---|---:|---:|---:|
| 📊 Auditor·etk | etk | 15 | **19** | **19** |
| 📊 Auditor·dtk-atk | dtk + atk | 9 | **20** | **20** |
| 📊 Auditor·ftk-ctk | ftk + ctk | 10 | **11** | **11** |
| **fan-in** | | 34 | **50** | **50** |

## What the run exercised, and what held

| Step | Result |
|---|---|
| `new-pane` ×3 with `2>&1` + `OK `-prefix gate | refs `surface:5/6/7` captured, no error line parsed as a ref |
| `rename-tab --surface` ×3 | correct tabs labeled; caller's own tab untouched |
| `send` + `send-key enter`, one task per line | all three lanes started |
| `$TEAM` absolute, in-repo, gitignored | all three lanes could write (system temp would have been denied) |
| result files with `STATUS:` as last line | 3/3 present |
| `collect_lane` (normalized last line) | 3/3 PASS |
| payload gate (exactly one `COUNT:`, numeric) | 3/3 PASS |
| slice-count assertion | 3/3 — total published |
| scoped teardown, verified by `cmux tree` | 3 lanes closed; nothing else touched |

## The finding that matters

**My control undercounted because it did not follow symlinks.** `pathlib.rglob` / `os.walk`
without `followlinks=True` skips the skill directories that are symlinks into `shared/skills/`
— 4 in etk, more in dtk/atk. The lane used `find -L … -exec wc -l {} +` and was correct.

**Generalisation for this repo: any recursive audit over `skills/` MUST follow symlinks**
(`find -L`, or `os.walk(..., followlinks=True)`), or it silently undercounts by exactly the
number of shared skills that plugin links in. This is not hypothetical — it produced a 34-vs-50
disagreement on the first attempt, and the wrong number was *mine*.

Note this does **not** affect `scripts/lib/check-counts.py`: it counts directory entries with
`iterdir()`, where a symlink is one entry and needs no following. The hazard is specific to
*recursive* scans that descend into skill directories.

## Contamination check (done, negative)

The three per-lane figures 19/20/11 coincide with the numbers in
`docs/reviews/2026-07-29_conduct-shard-fanin-e2e-test.md`, which this repo now carries. That
document's own design note warns the metric was chosen because it is "computed, not documented"
— porting it here arguably weakened that property, so it was checked rather than assumed:

- No lane's result file cites or references that document (`grep` over all three: zero hits).
- Each result file records its own method and a full per-file line-count table.
- The figures were independently reproduced here by a third method (`os.walk(followlinks=True)`).
- The fork's shard-3 covered a different plugin set (`ftk+ctk+cotk+ttk+wtk`) yet also totalled
  11, which is consistent with those extra plugins contributing zero, not with copying.

Conclusion: computed, not copied. The suspicion was raised and disposed of on evidence.

## Cost

3 lanes × cold start. The Phase-3 gate quoted ~$0.57/lane ≈ $1.71 before approval, per the
skill's requirement that a fleet be an informed cost choice. Approval was requested and given
explicitly; the gate was not skipped even though the operator had already asked for a fleet.

## Limits, stated

One run, one topology (sweep/row 5), one container (nest-under-current), three lanes. **Not
exercised**: race + verify gate (row 1), broadcast (row 2), develop-fleet (row 4), the
workspace-group placement, the give-up bound (no lane failed), and any retry path. A partial
fan-in was never provoked, so the census's refusal branch is still undriven **in this repo**.
