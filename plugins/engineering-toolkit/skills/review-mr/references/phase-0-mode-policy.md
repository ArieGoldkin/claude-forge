# Phase 0: Mode Detection & Policy Loading

The first phase of `/etk:review-mr`. Detect the VCS, parse mode flags, load review policy, configure tool commands. If `--dry-run` is set, print the plan and exit.

## VCS Provider Detection

Detect the available VCS CLI tool and map commands accordingly:

```bash
# Detect VCS provider
if command -v glab &>/dev/null; then
  VCS_CLI="glab"
  VCS_MR_VIEW="glab mr view"
  VCS_MR_DIFF="glab mr diff"
  VCS_MR_CI="glab mr ci"
  VCS_MR_APPROVE="glab mr approve"
  VCS_MR_NOTE="glab mr note"
  VCS_MR_NOTE_LIST="glab mr note list"
  VCS_MR_UNAPPROVE="glab mr unapprove"
  VCS_ENTITY="MR"
  VCS_PREFIX="!"
elif command -v gh &>/dev/null; then
  VCS_CLI="gh"
  VCS_MR_VIEW="gh pr view"
  VCS_MR_DIFF="gh pr diff"
  VCS_MR_CI="gh pr checks"
  VCS_MR_APPROVE="gh pr review --approve"
  VCS_MR_NOTE="gh pr comment"
  VCS_MR_NOTE_LIST="gh pr view --comments"
  VCS_MR_UNAPPROVE="gh pr review --request-changes"
  VCS_ENTITY="PR"
  VCS_PREFIX="#"
else
  echo "ERROR: No VCS CLI found. Install glab (GitLab) or gh (GitHub)."
  exit 1
fi
```

## Mode Parsing

Parse `$ARGUMENTS` to extract:
- MR number/URL (required)
- Mode flag: `--standard` or `--deep` (optional, default = quick)
- `--incremental` flag (optional, combines with any mode)
- `--dry-run` flag (optional, display plan only)
- `--spec` flag (optional, used with `--standard` or `--deep`): Run spec compliance review BEFORE code quality review
- `--ci` flag (optional): non-interactive, **review-only** CI mode (G1, CC-alignment audit 2026-06-01)

Example: `review-mr 123 --deep` or `review-mr 123 --standard --incremental` or `review-mr 123 --deep --spec` or `review-mr 123 --standard --ci`

```bash
# --ci flag: non-interactive review-only mode for CI gating (G1)
if [[ "$ARGUMENTS" == *"--ci"* ]]; then
  CI_MODE=true
else
  CI_MODE=false
fi
```

When `CI_MODE=true`:
- The review **never posts** to the MR — `--ci` is review-only. It emits the `.yaml`/`.md`
  artifacts plus a machine-readable JSON summary to stdout for CI gating, and exits nonzero
  when there are blocking findings. Any actual posting remains a separate, explicitly-invoked
  `/etk:post-mr-comments` job.
- Interactive prompts are suppressed (no `y/n/r` stale gate, no pipeline-acknowledgment loop,
  no `[y/n]` post confirm). Each phase that normally prompts defaults to its non-interactive
  gating behavior. These per-phase behavior changes are documented in `references/ci-integration.md`.

## Policy Loading

```bash
# Load configurable thresholds (uses defaults if file missing)
POLICY=$(cat .claude/policies/review-policy.json 2>/dev/null || echo '{}')

# Confidence filtering
CONFIDENCE_THRESHOLD=$(echo "$POLICY" | jq -r '.confidence_threshold // 70')

# Risk-to-mode escalation thresholds
RISK_STANDARD_THRESHOLD=$(echo "$POLICY" | jq -r '.risk_to_mode_escalation.standard_threshold // 4')
RISK_DEEP_THRESHOLD=$(echo "$POLICY" | jq -r '.risk_to_mode_escalation.deep_threshold // 7')

# Evidence gate behavior
GATE_SECRETS=$(echo "$POLICY" | jq -r '.evidence_gate.secrets_scan // "block"')
GATE_TESTS=$(echo "$POLICY" | jq -r '.evidence_gate.tests // "warn"')
GATE_LINT=$(echo "$POLICY" | jq -r '.evidence_gate.lint // "warn"')
GATE_TYPECHECK=$(echo "$POLICY" | jq -r '.evidence_gate.typecheck // "warn"')

# Output preferences
MAX_FINDINGS_PER_AGENT=$(echo "$POLICY" | jq -r '.output_preferences.max_findings_per_agent // 20')
SORT_BY_CONFIDENCE=$(echo "$POLICY" | jq -r '.output_preferences.sort_by_confidence // true')
SHOW_FILTERED_COUNT=$(echo "$POLICY" | jq -r '.output_preferences.show_filtered_count // true')

# Skip paths + nit cap (G2, CC-alignment audit 2026-06-01)
# skip_paths: array of globs; findings whose path matches are dropped before reporting
#   (security-labeled findings are NEVER skipped — see Phase 3 honoring logic). Default [].
# nit_cap: max nitpick-severity findings to surface. Default 5 (key absent → 5);
#   set explicitly to null for unlimited. The has()-guard distinguishes "key absent"
#   (→ 5) from "key present and null" (→ unlimited), since jq's // would coerce null to 5.
SKIP_PATHS=$(echo "$POLICY" | jq -c '.skip_paths // []')
NIT_CAP=$(echo "$POLICY" | jq -r 'if has("nit_cap") then (.nit_cap // "null") else 5 end')

# Composite score weights
WEIGHT_QUALITY=$(echo "$POLICY" | jq -r '.composite_score_weights.quality_checks // 0.30')
WEIGHT_CODE=$(echo "$POLICY" | jq -r '.composite_score_weights.code_quality // 0.20')
WEIGHT_SECURITY=$(echo "$POLICY" | jq -r '.composite_score_weights.security // 0.25')
WEIGHT_TESTING=$(echo "$POLICY" | jq -r '.composite_score_weights.testing // 0.15')
WEIGHT_ARCH=$(echo "$POLICY" | jq -r '.composite_score_weights.architecture // 0.10')

# Grade thresholds
GRADE_A=$(echo "$POLICY" | jq -r '.grade_thresholds.A // 90')
GRADE_B=$(echo "$POLICY" | jq -r '.grade_thresholds.B // 75')
GRADE_C=$(echo "$POLICY" | jq -r '.grade_thresholds.C // 60')
GRADE_D=$(echo "$POLICY" | jq -r '.grade_thresholds.D // 40')
```

### Policy keys reference

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `confidence_threshold` | integer | 70 | Drop findings below this confidence. |
| `skip_paths` | array of globs | `[]` | Drop findings whose `path` matches any glob, **before reporting** — except security-labeled findings, which are never skipped (G2). Honored in Phase 3. |
| `nit_cap` | integer or null | `5` | Cap on nitpick-severity findings surfaced; set to `null` for unlimited (G2). |

The numeric/threshold keys (`risk_to_mode_escalation`, `evidence_gate`, `output_preferences`, `composite_score_weights`, `grade_thresholds`, `commands`) are loaded above and documented inline.

## Tool Command Configuration

```bash
# Load configurable tool commands (defaults to mise for backward compatibility)
FMT_FRONTEND=$(echo "$POLICY" | jq -r '.commands.format_frontend // "mise run biome-fix"')
FMT_BACKEND=$(echo "$POLICY" | jq -r '.commands.format_backend // "mise run ruff-fix"')
LINT_FRONTEND=$(echo "$POLICY" | jq -r '.commands.lint_frontend // "mise run biome-check"')
LINT_BACKEND=$(echo "$POLICY" | jq -r '.commands.lint_backend // "mise run ruff-check"')
TEST_FRONTEND=$(echo "$POLICY" | jq -r '.commands.test_frontend // "mise run test-frontend"')
SECRET_SCAN=$(echo "$POLICY" | jq -r '.commands.secret_scan // "mise run secret-detection"')
TYPECHECK_WEB=$(echo "$POLICY" | jq -r '.commands.typecheck_web // "cd frontend/web && npm run build"')
TYPECHECK_ADMIN=$(echo "$POLICY" | jq -r '.commands.typecheck_admin // "cd frontend/admin && npm run build"')
```

## Dry Run Mode

If `--dry-run` is specified, display the review plan without executing:

```bash
if [[ "$ARGUMENTS" == *"--dry-run"* ]]; then
  echo "=== DRY RUN ==="
  echo "VCS Provider: $VCS_CLI ($VCS_ENTITY)"
  echo "MR/PR Number: $MR_NUMBER"
  echo "Review Mode: [Quick/Standard/Deep]"
  echo ""
  echo "Quality checks to run:"
  echo "  - Secret scan: $SECRET_SCAN"
  echo "  - Backend lint: $LINT_BACKEND"
  echo "  - Frontend lint: $LINT_FRONTEND"
  echo "  - Type check: $TYPECHECK_WEB / $TYPECHECK_ADMIN"
  echo "  - Frontend tests: $TEST_FRONTEND"
  echo ""
  echo "VCS commands:"
  echo "  - View: $VCS_MR_VIEW $MR_NUMBER"
  echo "  - Diff: $VCS_MR_DIFF $MR_NUMBER"
  echo "  - CI: $VCS_MR_CI $MR_NUMBER"
  echo ""
  if [[ standard or deep mode ]]; then
    echo "Agents to launch: [list based on domain detection]"
  fi
  echo "=== END DRY RUN ==="
  exit 0
fi
```
