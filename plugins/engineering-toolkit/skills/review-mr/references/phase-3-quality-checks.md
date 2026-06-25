# Phase 3: Run Quality Checks (All Modes)

Quality checks run in every mode (Quick / Standard / Deep). Collect exit codes into an evidence summary; the gate determines whether agent review proceeds.

## 3a. Secrets Detection

```bash
# Run gitleaks via pre-commit
$SECRET_SCAN
# Capture: SECRETS_EXIT_CODE=$?
```

If secrets found: **BLOCK MERGE** immediately.

## 3b. Python Quality Checks (if backend files changed)

```bash
# Ruff linting (after auto-fix)
$LINT_BACKEND
# Capture: RUFF_EXIT_CODE=$?
```

## 3c. Frontend Quality Checks (if frontend files changed)

```bash
# Biome linting (after auto-fix)
$LINT_FRONTEND
# Capture: BIOME_EXIT_CODE=$?

# TypeScript type checking (web app)
$TYPECHECK_WEB
# Capture: TSC_WEB_EXIT_CODE=$?

# TypeScript type checking (admin app)
$TYPECHECK_ADMIN
# Capture: TSC_ADMIN_EXIT_CODE=$?
```

## 3d. Test Execution

**Frontend tests:**
```bash
$TEST_FRONTEND
# Capture: FRONTEND_TEST_EXIT_CODE=$?
```

**Backend tests:**
```bash
# If specific lambda changed, test it
cd lambdas/{domain}/{service} && uv run pytest tests/ -v
# Capture: BACKEND_TEST_EXIT_CODE=$?
```

## 3e. Security Quick Checks

Run inline checks (no agents needed). This inline step is a generic migration sanity check;
deeper PII-in-logs, authz, and multi-tenant query-scoping concerns are covered by the Deep-mode
Security Auditor agent (#7) and CC's built-in `/security-review`, not by inline greps here.

**Migration Check** (generic — always runs):
```bash
if [ -f "alembic/versions/*.py" ]; then
  echo "Database migration detected"
else
  if git diff --name-only | grep -q "models.py\|schema.py"; then
    echo "Database model changed but no migration found"
  fi
fi
```

## 3h. Evidence Summary Collection

Collect exit codes from all Phase 3 checks into an evidence summary:

```
EVIDENCE = {
  secrets_scan:    $SECRETS_EXIT_CODE     (0=pass, else=fail)
  ruff_lint:       $RUFF_EXIT_CODE        (0=pass, else=fail)
  biome_lint:      $BIOME_EXIT_CODE       (0=pass, else=fail)
  typecheck:       $TSC_EXIT_CODE         (0=pass, else=fail)
  frontend_tests:  $FRONTEND_TEST_EXIT_CODE
  backend_tests:   $BACKEND_TEST_EXIT_CODE
}
```

**Evidence Gate Rules** (behavior from policy: secrets=$GATE_SECRETS, tests=$GATE_TESTS, lint=$GATE_LINT, typecheck=$GATE_TYPECHECK):
- Secrets scan fails (exit != 0) and `$GATE_SECRETS == "block"` → **BLOCK**: halt agent review, force REQUEST CHANGES.
- Tests fail and `$GATE_TESTS == "warn"` → **WARN**: continue but note in Phase 6.
- Lint/typecheck fail and `$GATE_LINT/$GATE_TYPECHECK == "warn"` → **WARN**: continue but note in Phase 6.

If evidence gate is BLOCKED, skip to Phase 6 with forced REQUEST CHANGES recommendation.

## 3i. Honor `skip_paths` (G2, CC-alignment audit 2026-06-01)

When collecting findings (from these inline checks and, later, from the agents), drop any
finding whose `path` matches a glob in `$SKIP_PATHS` **before reporting** — e.g. generated
code (`src/gen/**`), vendored bundles (`dist/**`). This filter is applied in addition to the
existing confidence threshold and FP filters; it runs before Phase 6 synthesis so skipped-path
findings never reach the YAML.

**Security exemption (do not weaken):** security-labeled findings are **NEVER** dropped by
`skip_paths`, consistent with the existing FP-filter security exemption — a secret committed to
`src/gen/**` is still a secret. Match the existing rule that security findings bypass the
pre-existing/intentional filters.

```bash
# $SKIP_PATHS is a JSON array of globs loaded in Phase 0 (default []).
# Conceptually, for each candidate finding:
#   if finding.path matches any glob in $SKIP_PATHS AND finding.label != "security":
#       drop the finding (record in the filtered count if $SHOW_FILTERED_COUNT)
#   else:
#       keep
# Security-labeled findings are kept unconditionally regardless of skip_paths.
```

The `nit_cap` (`$NIT_CAP`, default 5; set `null` for unlimited) is applied during Phase 6/7
aggregation, not here — it caps the number of nitpick-severity findings surfaced after sorting.
