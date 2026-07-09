# Phase 1: Gather MR Information

Fetch MR metadata + diff, run risk scoring, evaluate description completeness, classify domains, sanity-check scope. Optional: incremental scoping (`--incremental`), spec compliance (`--spec`).

## Fetch MR data + pipeline-acknowledgment

```bash
# Get MR/PR details
$VCS_MR_VIEW $MR_NUMBER

# Capture the diff content (used by all agents)
DIFF_CONTENT=$($VCS_MR_DIFF $MR_NUMBER)

# Capture changed file list
CHANGED_FILES=$($VCS_MR_DIFF $MR_NUMBER --name-only)

# Check CI/CD pipeline status
PIPELINE_OUTPUT=$($VCS_MR_CI $MR_NUMBER)
echo "$PIPELINE_OUTPUT"

# Pipeline-acknowledgment loop: if the pipeline is failing, do not silently
# treat the failure as a review blocker. Confirm with the author whether the
# failure is expected (e.g., known-flaky job, parallel infra fix in flight,
# pre-existing main-branch breakage). Set PIPELINE_ACK accordingly.
#
# CI_MODE (G1, CC-alignment audit 2026-06-01): when CI_MODE=true the loop must NOT
# prompt — there is no human to answer. A failing pipeline defaults to gating
# (PIPELINE_ACK=gating) so the review fails closed and CI can block on it.
if echo "$PIPELINE_OUTPUT" | grep -qiE 'failed|failure'; then
  if [ "$CI_MODE" = "true" ]; then
    PIPELINE_ACK=gating   # non-interactive: failing pipeline always gates
    echo "⚠ Pipeline shows failures (CI_MODE) — recorded as 'gating' (no prompt)."
  else
    echo ""
    echo "⚠ Pipeline shows failures. Before this gates the review, confirm with the author:"
    echo "   Is this failure expected (flaky / known / pre-existing)? [yes/no]"
    echo "   If yes, the failure is recorded as 'acknowledged-expected' and excluded from gating."
    echo "   If no, the failure gates merge and is included in Phase 6 blockers."
    # Capture the answer (interactive) into PIPELINE_ACK ∈ {expected, gating}.
    # Default when running unattended: gating.
  fi
fi
```

Identify:
- Total files changed
- Lines added/removed (+X / -Y)
- Affected domains (see 1c below)
- Labels (if applicable: security, database-migration, breaking-change)

## 1a. MR Risk Assessment

Score the MR on 5 dimensions (each 0-2 points, total 0-10):

| Dimension | 0 (Low) | 1 (Medium) | 2 (High) |
|-----------|---------|------------|----------|
| **Scope** | 1-3 files, <200 lines | 4-10 files, 200-500 lines | 10+ files, 500+ lines |
| **Cross-cutting** | Single domain | 2 domains (e.g., frontend + backend) | 3+ domains or infra changes |
| **Risk sensitivity** | No sensitive data, no auth, no billing | Touches auth or tenant queries | Sensitive data handling, schema migration, or billing |
| **Unknowns** | Clear purpose, good description | Partial description, some ambiguity | Missing context, unclear intent |
| **Blast radius** | Isolated feature, no shared code | Shared utilities or components | Core infrastructure, DB schema, auth flow |

**Risk Level from total score** (thresholds from policy: standard=$RISK_STANDARD_THRESHOLD, deep=$RISK_DEEP_THRESHOLD):
- **0 to $RISK_STANDARD_THRESHOLD-1 Low**: Quick mode sufficient. Straightforward change.
- **$RISK_STANDARD_THRESHOLD to $RISK_DEEP_THRESHOLD-1 Moderate**: Standard mode recommended. Verify approach and edge cases.
- **$RISK_DEEP_THRESHOLD to 8 High**: Deep mode recommended. Multiple risk vectors need specialist review.
- **9-10 Critical**: Deep mode required. Flag for senior engineer co-review.

If the calculated risk level suggests a deeper mode than selected, recommend upgrading:
> "Risk score is 7/10 (High) — recommend `--deep` mode for this $VCS_ENTITY. Proceed with current mode?"

## 1b. PR Description Completeness

Evaluate the MR description against the **team standard** — the three-section contract authored by `/etk:prepare-pr` (`skills/prepare-pr/references/description-template.md`). Mark each present/missing; for MRs not using the standard, map the equivalent content rather than penalizing the heading names.

**Background:**
- [ ] What is the need / purpose stated (why this change?)
- [ ] Before → after contrast (how it worked before, how it should work now)
- [ ] Related flows identified

**High-Level Design:**
- [ ] Changes described by area (API / Infra / Schema / UI / Data, as applicable)
- [ ] A sequence / flow diagram for non-trivial changes

**Pitfalls & Potential Regressions:**
- [ ] Edge cases enumerated
- [ ] Regression risks / blast radius noted
- [ ] Rollout / migration ordering (if a schema or infra change)

**Completeness verdict:**
- All present: proceed normally
- 1-2 missing: note as suggestion in final report ("PR description could be improved")
- 3+ missing: flag as warning ("PR description is incomplete — review may miss intended behavior")

Conditional items that don't apply to this change (a sequence diagram for a trivial change; rollout/migration ordering when there's no schema or infra change) do **not** count as missing.

> The standard deliberately keeps the **test list** in CI/code, not the description — Pitfalls covers *regressions*, not a test enumeration. Do **not** ding a description for lacking a "testing approach" prose section; testing is gated by `/etk:verify` upstream.

## 1c. Domain Classification

Classify affected domains from `$CHANGED_FILES`:

```
HAS_FRONTEND = any file matching frontend/**
HAS_BACKEND  = any file matching lambdas/**
HAS_INFRA    = any file matching terraform/** or *.tf
HAS_DATABASE = any file matching alembic/** or **/models.py or **/schema.py
HAS_SENSITIVE_DATA = labels contain "security" or auth/cognito files changed or HAS_DATABASE
```

Domain summary: `[frontend/backend/infra/database/full-stack]`

The `HAS_FRONTEND` / `HAS_BACKEND` / `HAS_DATABASE` classification drives generic agent
selection (Phase 4/5) and the always-on quality checks (Phase 3a–3e). The path globs above
(`frontend/**`, `lambdas/**`, `alembic/**`, `**/models.py`) are project-convention examples —
adapt them in your fork to match your repo's layout.

## 1d. Incremental Scoping (if --incremental)

```bash
# Find last Claude Code review comment
LAST_REVIEW=$($VCS_MR_NOTE_LIST $MR_NUMBER | grep "Reviewed with Claude Code" | head -1)
LAST_REVIEW_DATE=$(echo "$LAST_REVIEW" | grep -oP '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}')

# Scope diff to commits since last review
if [ -n "$LAST_REVIEW_DATE" ]; then
  DIFF_CONTENT=$(git log --since="$LAST_REVIEW_DATE" --format="" -p)
  CHANGED_FILES=$(git log --since="$LAST_REVIEW_DATE" --name-only --format="")
  echo "Incremental review: changes since $LAST_REVIEW_DATE"
else
  echo "No previous Claude Code review found — performing full review"
fi
```

## 1e. Scope-Leak Check

Before any deeper review, sanity-check that the MR is actually the change it claims to be. Two cheap signals catch most scope leaks:

```bash
# 1. Does the title match the diff's largest movements?
$VCS_MR_VIEW $MR_NUMBER --output json | jq -r '.title'
# Inspect $CHANGED_FILES — do the file paths and the title agree?

# 2. Bundled unrelated changes? (different ticket, different feature)
# Heuristics:
#   - Multiple ticket IDs in the commit log
#   - dist/ committed without source changes that explain it
#   - admin/* additions in a feature MR
#   - Pydantic / schema edits in a UI-only MR
git log --format="%s" main..HEAD | grep -oE '[A-Z]+-[0-9]+' | sort -u
```

**Verdict:**
- Title matches diff, single coherent intent → proceed.
- Title is broad enough to absorb extras ("misc improvements") but extras are clearly distinct → flag in final report as `scope-leak [non-blocking]`. The author may not have noticed they snuck in.
- Title doesn't match diff at all → **stop and ask the author to retitle or split** before continuing review. A misleading title sends the wrong reviewer signal.

This check is cheap (one `jq` + one `git log`) and catches the class of "I added a fix while I was here" drift that derails reviews.

## Phase 1a (sub-phase): Spec Compliance Review (--spec flag only)

When `--spec` is present, run a two-stage review: spec compliance FIRST, then code quality.

**Step 1**: Find the associated spec/plan document:
- Check MR description for links to spec docs
- Search for files matching: `docs/specs/*.md`, `docs/plans/*.md`, `.develop/plan*.md`
- If no spec found: warn and fall back to standard review

**Step 2**: Dispatch a spec-reviewer subagent with this directive:
> "Compare the implementation diff against the spec document. The implementer may have finished quickly — their report may be incomplete or optimistic. Verify EVERY spec requirement independently against actual code changes. Report: which spec items are implemented, which are missing, and which diverge from spec."

**Step 3**: Only after spec compliance passes (or is explicitly waived), proceed to standard code quality review in Phase 2+.

This ordering is deliberate: validate correctness before style. A beautifully written function that doesn't match the spec is wrong.
