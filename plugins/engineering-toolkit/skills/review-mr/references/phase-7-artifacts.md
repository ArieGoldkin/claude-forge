# Phase 7: Generate Findings Artifacts (do NOT post)

After Phase 6 synthesis, write two paired artifacts to `.claude/reviews/` **when there are findings**, then emit the Phase-6 report as your **final message** (§ 7c) — the report, not the artifact write, is the fork's return value; never end on the artifact write or a bare "completed". With **zero findings**, skip artifact-writing and return the report directly. **Do NOT post anything to the MR from this skill.** Posting is the job of the companion skill `/etk:post-mr-comments`, which is always invoked as a deliberate second action by the user after they have reviewed and edited the artifacts.

Why two skills, not one: posting 12 inline comments is a careful CLI operation (see the glab gotchas in `skills/code-review-playbook/references/glab-inline-comments-recipe.md`). Bundling synthesis + post in one skill means the reviewer never gets to inspect the findings before they hit the MR. Splitting them makes review evidence first-class — the YAML is the source of truth, the Markdown is what humans read, posting is opt-in.

## 7a. Build the YAML (canonical source of truth)

Path: `.claude/reviews/mr-${MR_NUMBER}-findings.yaml`

For each finding in the Phase 6a aggregation (post-bundling, post-FP-filter, post-confidence-threshold), emit a YAML entry. Schema (full schema documented in `skills/code-review-playbook/references/inline-comment-yaml-schema.md`):

```yaml
mr_number: ${MR_NUMBER}
mr_url: <URL from $VCS_MR_VIEW>
project_path: <e.g., acme/backend/api-service>
generated_at: <ISO8601 with timezone>
generated_from_sha: <head_sha at review time — used for stale-check by post skill>
review_mode: <quick | standard | deep>
agents_launched:
  - <agent name with role, e.g., "etk:quality-reviewer (code quality)">

findings:
  - id: 1
    severity: <blocking | issue | suggestion | nitpick>
    confidence: <0-100 from agent>
    path: <repo-relative file path>
    line: <line number in NEW (post-diff) tree>
    body: |
      **<conventional-comments label>:** <one-line subject>

      <2-4 line body — one or two sentences of context, then concrete fix>

      _Reviewed with Claude Code._
    anchored: true
    posted: false
    discussion_id: null
    note_id: null
    posted_at: null
```

> `anchored` (boolean, default `true`) records whether the finding is inline-anchored.
> `false` means it was posted as a top-level-note fallback (set by the posting path, not here).
> review-mr always writes `anchored: true`; the field is part of the schema for downstream use.

**Filter & bundling rules** (already applied in Phase 6a; restated here for clarity):
- Drop findings below `$CONFIDENCE_THRESHOLD` (from policy).
- If `$NIT_CAP` is set (not null), keep only the top `$NIT_CAP` `nitpick`-severity findings by confidence (G2); other severities are unaffected.
- Bundle same-root-cause findings into ONE entry with a file:line list in the body.
- Sort by severity (blocking → issue → suggestion → nitpick), then by confidence descending within each severity.

**Severity mapping from agent labels:**

| Agent label | YAML severity |
|---|---|
| `security` (always blocking) | `blocking` |
| `bug`, `breaking`, `issue [blocking]` | `blocking` |
| `issue [non-blocking]` | `issue` |
| `suggestion` | `suggestion` |
| `nitpick`, `praise` | `nitpick` (or omit `praise`-only entries) |

## 7b. Render the Markdown (human-readable)

Path: `.claude/reviews/mr-${MR_NUMBER}-findings.md`

Generated from the YAML. Structure:

```markdown
# MR ${VCS_PREFIX}${MR_NUMBER} — Findings

**Generated**: <date>
**Mode**: <mode> | **Agents**: <count> | **Total findings**: <N> (<X blocking>, <Y issue>, <Z suggestion>, <W nitpick>)

## Table of contents

- [🔴 1. <path>:<line> — <one-line subject>](#1)
- [🟡 2. <path>:<line> — <one-line subject>](#2)
- ...

---

### 1. `<path>:<line>` 🔴 blocking
**Confidence**: <N> | **Posted**: ❌ pending

<body content from YAML, verbatim>

---

### 2. `<path>:<line>` 🟡 issue
**Confidence**: <N> | **Posted**: ❌ pending

<body content from YAML, verbatim>

---
```

Severity emoji map: 🔴 blocking, 🟡 issue, 🟢 suggestion, ⚪ nitpick.

The `Posted: ❌ pending` / `Posted: ✅ disc_id={short}` field is updated in-place by `/etk:post-mr-comments` after each successful POST.

## 7c-CI. CI_MODE summary + gate (G1, CC-alignment audit 2026-06-01)

When `CI_MODE=true` (the `--ci` flag, see Phase 0), the skill is still **review-only** — it has
already written the `.yaml` + `.md` artifacts above and **must not post**. Instead of the
interactive hand-off below, emit a single-line machine-readable JSON summary to **stdout** so a
CI job can gate on it, then exit with a status that reflects the gate:

```bash
if [ "$CI_MODE" = "true" ]; then
  # BLOCKING_COUNT = number of severity=="blocking" findings in the YAML
  # FINDINGS_COUNT = total findings in the YAML
  # COMPOSITE_GRADE / COMPOSITE_SCORE come from Phase 6 synthesis
  # gate = "fail" iff BLOCKING_COUNT > 0, else "pass"
  if [ "$BLOCKING_COUNT" -gt 0 ]; then GATE="fail"; else GATE="pass"; fi

  jq -cn \
    --argjson mr "$MR_NUMBER" \
    --arg mode "$REVIEW_MODE" \
    --arg grade "$COMPOSITE_GRADE" \
    --argjson score "$COMPOSITE_SCORE" \
    --argjson blocking "$BLOCKING_COUNT" \
    --argjson findings "$FINDINGS_COUNT" \
    --arg gate "$GATE" \
    '{mr:$mr, mode:$mode, composite_grade:$grade, composite_score:$score,
      blocking_count:$blocking, findings_count:$findings, gate:$gate}'
  # Example line:
  # {"mr":123,"mode":"standard","composite_grade":"B","composite_score":82,"blocking_count":0,"findings_count":5,"gate":"pass"}

  # Exit NONZERO when there are blocking findings so CI fails closed and can gate the pipeline.
  [ "$BLOCKING_COUNT" -gt 0 ] && exit 1
  exit 0
fi
```

Notes:
- `--ci` **never posts** to the MR. The JSON summary + exit code are the only CI integration
  surface; actual posting remains the separate, explicitly-invoked `/etk:post-mr-comments` job.
- See `references/ci-integration.md` for the `.gitlab-ci.yml` wiring (jq-gating the `gate`
  field, secret/OIDC setup, and how the artifacts are uploaded).
- Non-CI behavior is **unchanged** — fall through to 7c below (hard exit + interactive hand-off
  to `/etk:post-mr-comments`).

## 7c. Hand off (do NOT post)

**Only when Phase 7 wrote artifacts** (i.e. there were findings). Print this hand-off, **then emit the
Phase-6 synthesized report as your final message** — under `context: fork` the caller sees only your
last message, so the report, not this hand-off, must be last (SKILL.md § Output → Return contract).
With **zero findings** there are no artifacts and nothing to hand off: skip this block entirely and
return the Phase-6 report directly. (Interactive / non-CI path only — when `CI_MODE=true`, 7c-CI has
already emitted the JSON summary and exited.)

```
✓ Wrote findings to .claude/reviews/mr-${MR_NUMBER}-findings.yaml + .md

Review the markdown:
  cat .claude/reviews/mr-${MR_NUMBER}-findings.md

Edit the YAML to drop / rephrase / re-rank findings:
  $EDITOR .claude/reviews/mr-${MR_NUMBER}-findings.yaml

When ready, post inline-anchored comments via:
  /etk:post-mr-comments ${MR_NUMBER}                   # post all
  /etk:post-mr-comments ${MR_NUMBER} --only 1,2,3     # cherry-pick
  /etk:post-mr-comments ${MR_NUMBER} --severity blocking,issue
  /etk:post-mr-comments ${MR_NUMBER} --dry-run         # preview only

Do not post anything from /review-mr — posting is always a deliberate second action.
```

(Then emit the Phase-6 synthesized report as your final message — see § 7c intro.)

**Hard exit** — do not call `$VCS_MR_APPROVE`, `$VCS_MR_NOTE`, or any other VCS write command from this phase. The synthesized Phase-6 report is emitted as your **final message** after this hand-off (SKILL.md § Output → Return contract): the caller sees only your last message, so it must be the report — not this hand-off, and never a bare "completed". The YAML+MD pair on disk is the canonical *persisted* artifact; the report is the *returned* output.

## 7d. `.claude/reviews/` setup

If the directory does not exist:
- Create it: `mkdir -p .claude/reviews`
- Ensure it's gitignored: check root `.gitignore` for `.claude/reviews/`. If missing, append the line and warn the user that they should commit the gitignore update separately ("findings docs should not be committed to the project repo").

## 7e. Companion skill (`/etk:post-mr-comments`, available in etk 2.2.0+)

`/etk:post-mr-comments` consumes the YAML, validates the environment (glab auth, schema), fetches fresh `diff_refs`, runs a stale-check against `generated_from_sha`, posts findings sequentially with per-comment anchor verification, and updates the YAML in place with `posted: true` + `discussion_id`. See `commands/post-mr-comments.md` for the full flow and `skills/code-review-playbook/references/glab-inline-comments-recipe.md` for the underlying glab patterns.

Typical workflow:
```bash
/review-mr ${N} --deep              # generates YAML + MD, exits without posting
$EDITOR .claude/reviews/mr-${N}-findings.yaml   # human review / edit / drop
/etk:post-mr-comments ${N} --dry-run            # preview the post plan
/etk:post-mr-comments ${N} --severity blocking,issue   # post filtered subset
```
