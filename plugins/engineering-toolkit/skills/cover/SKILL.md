---
name: cover
description: "Generate, execute, and heal test suites across unit, integration, and E2E tiers. Automated failure healing, coverage comparison, fingerprint caching, and ARIA accessibility diffing. Supports --target for autonomous coverage improvement and --streak to require N consecutive green runs before a test is kept. Use when: adding tests, increasing coverage, generating test files, or validating untested code. Triggers on: cover, generate tests, test coverage, write tests, add tests, untested, increase coverage, coverage target, E2E tests, Playwright, flaky test, streak gate"
effort: xhigh
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "tests/**"
  - "__tests__/**"
context: fork
keep-coding-instructions: true
---

# Cover

Generate, execute, and heal test suites across three tiers: unit, integration, and E2E.

## Invocation

```
/cover {scope}                        # All tiers, auto-detect effort
/cover --tier=unit,integration {scope} # Specific tiers only
/cover --tier=e2e checkout-flow        # E2E only with Playwright
/cover --real-services payment-api     # Force real service detection
/cover --flow login --tier=e2e       # Replay saved flow (skip AI generation)
/cover --no-cache {scope}            # Bypass fingerprint gating
/cover --no-aria {scope}             # Skip ARIA diffing
/cover --status-protocol {scope}     # Emit machine-parseable status lines
/cover {scope} --target=85%                # Autonomous mode: iterate until 85% coverage
/cover {scope} --target=90% --max-iterations=15  # Custom iteration budget
/cover {scope} --streak=3                   # Keep a test only after it passes 3 consecutive runs (flaky defense)
```

## Phase 0: Fingerprint Check

Hash source files in scope with SHA-256 and compare against `.cover/fingerprints.json` from the previous run. Files whose hash is unchanged and whose last result was `pass` are skipped — subsequent phases only process changed, new, or previously failing files. On first run (no fingerprint file), all files proceed.

Use `--no-cache` to bypass fingerprint gating entirely and test everything in scope. `--streak=N` likewise overrides caching for the streaked tests — they are always re-run so the streak reflects fresh runs, never a cached prior `pass` (see Phase 5 → Streak gate).

Output: `"N files cached, M files changed — proceeding with reduced scope"`

Reference: `${CLAUDE_SKILL_DIR}/references/fingerprint-gating.md`

## Phase 1: Discover

Detect the project's test stack by scanning for configuration files.

| File | Framework | Tier |
|------|-----------|------|
| `vitest.config.*`, `jest.config.*` | Vitest / Jest | Unit + Integration |
| `pytest.ini`, `pyproject.toml` (pytest) | pytest | Unit + Integration |
| `playwright.config.*` | Playwright | E2E |
| `docker-compose*.yml`, testcontainers dep | Real services | Integration |
| `package.json` scripts (`test`, `test:e2e`) | npm scripts | All |

Scan the scope (file, directory, or module name) to identify:
- Source files without corresponding test files
- Exported functions/classes lacking test coverage
- UI components without E2E journey coverage

## Phase 2: Analyze

Run existing tests and collect baseline coverage:

```bash
# JavaScript/TypeScript
npx vitest run --coverage --reporter=json 2>/dev/null || npx jest --coverage --json 2>/dev/null

# Python
pytest --cov --cov-report=json 2>/dev/null

# Playwright E2E
npx playwright test --reporter=json 2>/dev/null
```

Record: total lines/branches/functions covered, pass/fail counts, existing test file paths.

If no test framework is detected, scaffold one:
- TypeScript project -> `vitest` with `@vitest/coverage-v8`
- Python project -> `pytest` with `pytest-cov`
- E2E needed -> `@playwright/test` with default config

## Phase 2b: Saved Flow Lookup

When `--flow <name>` is provided, look up `.cover/flows/<name>.yaml` in the project root. If the flow file is found, skip Phase 2 (Analyze) and Phase 3 (Generate) and proceed directly to Phase 4 (Execute) using the steps defined in the flow YAML. If the flow file is not found, error with a list of available flows in `.cover/flows/`.

Saved flows support selector fallback chains, variable substitution, conditional steps, and flow composition via the `setup` field.

Reference: `${CLAUDE_SKILL_DIR}/references/saved-flows.md`

## Phase 3: Generate

Generate test files per requested tier. **When multiple tiers are requested, dispatch tier agents in parallel**: emit Agent tool calls for unit, integration, and E2E in a single response — do not serialize tier-by-tier. Wait for all agents to return before running the Heal phase. Opus 4.7 requires explicit parallel instructions; soft phrasing like "use parallel agents" is insufficient and will serialize.

### Effort-Based Scaling

| Effort | Tiers | Parallel Agents | Heal Iterations |
|--------|-------|-----------------|-----------------|
| Low | Unit only | 1 | 1 |
| Medium | Unit + Integration | 2 | 2 |
| High (default) | Unit + Integration + E2E | 3 | 3 |

Explicit `--tier=` flags override effort defaults.

### Unit Tests

- AAA pattern (Arrange-Act-Assert) with comments
- Parametrized tests for multiple inputs (`test.each` / `@pytest.mark.parametrize`)
- MSW for HTTP mocking (TypeScript), VCR.py for recording (Python)
- Factory-based test data (faker-js / FactoryBoy), not hardcoded fixtures
- Target: each test < 100ms

### Integration Tests

- Test real component interactions (API endpoints, database queries, service calls)
- Use real services when docker-compose or testcontainers detected — see `${CLAUDE_SKILL_DIR}/references/real-service-detection.md`
- Fall back to network-level mocks (MSW / VCR.py) when no real services available
- Never mock internal functions — mock at system boundaries only

### E2E Tests (Playwright)

For E2E tier, follow this workflow:

**Step 1: Explore with agent-browser** (if app is running)
```bash
agent-browser navigate http://localhost:3000
agent-browser snapshot
# Identify interactive elements, capture selectors, record the flow
agent-browser click @e1
agent-browser snapshot
# Continue through the user journey...
```

**Step 2: Codify as Playwright test**

Generate a Playwright test file from the explored flow. Follow the patterns in `${CLAUDE_SKILL_DIR}/references/e2e-playwright.md`.

Key rules:
- Use `data-testid` selectors first, then `getByRole()`, then `getByLabel()`
- Page Object Model for reusable components
- One test file per user journey
- Add `await expect()` assertions after each significant action

**Step 3: Add to test suite**

Place generated tests in `tests/e2e/` or `e2e/` (match existing convention). Update `playwright.config.ts` if needed.

### Boundaries

- **Tests only** — never modify production source code
- **No internal mocks** — mock at network/system boundaries, never `jest.mock('./internal-module')`
- **No hardcoded data** — use factories or fixtures
- **Test file naming** — match source: `auth.ts` -> `auth.test.ts`, `auth.py` -> `test_auth.py`

## Phase 3b: ARIA Baseline Capture

Active when `--tier=e2e` is requested and `--no-aria` is **not** set. After test generation, navigate to each page under test using agent-browser, wait for network idle, and capture the ARIA accessibility tree via `agent-browser snapshot`. Store the structured baseline in `.cover/aria-baselines/` as JSON, keyed by test file name.

This baseline is used in Phase 4b to detect accessibility regressions introduced by code changes.

Reference: `${CLAUDE_SKILL_DIR}/references/aria-diffing.md`

## Phase 4: Execute

Run all generated tests:

```bash
# Unit + Integration
npx vitest run --reporter=verbose 2>&1 || pytest -v 2>&1

# E2E
npx playwright test --reporter=list 2>&1
```

Capture: exit code, pass/fail per test, error messages, stack traces.

## Phase 4b: ARIA Diff

Active when Phase 3b captured a baseline. Re-capture the ARIA tree for each page after test execution and diff it node-by-node against the stored baseline. Classify each change by severity:

- **CRITICAL**: role removed, landmark deleted, form input loses label
- **WARNING**: accessible name changed, heading level changed
- **INFO**: new element added, state toggled

ARIA diff results are appended to the Phase 6 report. See the reference doc for the full severity classification table and decision tree for distinguishing regressions from intentional changes.

Reference: `${CLAUDE_SKILL_DIR}/references/aria-diffing.md`

## Phase 5: Heal

Fix failing tests without modifying source code. Maximum iterations controlled by effort level.

Classify each failure and apply the fix strategy from `${CLAUDE_SKILL_DIR}/references/heal-loop.md`. Iteration 1: obvious fixes (imports, types, assertions). Iteration 2: interaction errors (setup, timeouts, selectors). Iteration 3: edge cases (flaky, race conditions).

**Source bug detection**: If a test failure reveals a genuine bug in source code, report it clearly but do NOT fix it. The cover skill generates tests, not patches.

After each heal iteration, re-run failed tests. Stop when all pass or iterations exhausted.

### Streak gate (`--streak=N`)

By default a generated test is considered healed once it passes a single run. With `--streak=N` (N ≥ 2), a test is marked **passing/kept** only after it passes **N consecutive runs** — a defense against newly generated tests that pass intermittently (timing, shared state, ordering). Run the streak check after the heal loop converges:

- **Each streak run must be fresh.** `--streak` re-runs each test N times this pass and **bypasses Phase 0 fingerprint gating** for streaked tests — a cached or skipped result (a prior `pass`) never counts toward a streak. A test that is not actually re-run N times cannot be marked green; reading a stale prior pass would satisfy the streak with **zero fresh runs**, the exact false-green the gate exists to prevent.
- A test that holds the streak (N/N green) is kept and counted in the coverage delta.
- A test that breaks its streak is flagged **flaky** and re-enters the heal loop, counting against the `--max-iterations` budget; if it still can't hold the streak when the budget is exhausted, report it as flaky rather than keeping it as green.
- When `--streak` is active, the Phase 6 report records the streak outcome and lists any flaky-dropped tests (see Phase 6).

Default `--streak=1` preserves current single-pass behavior. `--streak` composes with `--target`: an iteration's new tests must hold the streak before their coverage gain is counted toward the target.

## Phase 5b: Autonomous Coverage Improvement

Active when `--target=N%` is specified and current coverage is below target. Iterate: identify uncovered code paths, generate targeted tests, re-measure coverage. Keep iterations that improve coverage by >= 0.5%, discard others. Stop when target reached, budget exhausted (`--max-iterations`, default 10), or stuck (3 consecutive discards).

Each iteration is logged to `.cover/improvement-log.tsv`. Status protocol events: `[COVER_TARGET_START]`, `[COVER_TARGET_ITERATION]`, `[COVER_TARGET_DONE]`.

Full details: `${CLAUDE_SKILL_DIR}/references/autonomous-coverage.md`

## Phase 6: Report

Generate a coverage comparison report. See `${CLAUDE_SKILL_DIR}/references/coverage-report.md` for the template.

Present a summary table:

```
## Coverage Report: {scope}

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Lines | 62% | 84% | +22% |
| Branches | 45% | 71% | +26% |
| Functions | 58% | 89% | +31% |

### Tests Generated
| Tier | Files | Tests | Pass | Fail | Healed |
|------|-------|-------|------|------|--------|
| Unit | 4 | 23 | 23 | 0 | 2 |
| Integration | 2 | 8 | 8 | 0 | 1 |
| E2E | 1 | 3 | 3 | 0 | 0 |

### Source Bugs Detected
- [BUG] `processPayment()` returns undefined when amount is 0 (not fixed — tests only)

### Fingerprint Cache
- 3/7 files unchanged (cached), 4 files tested this run

### ARIA Accessibility Diff
| Severity | Count | Details |
|----------|-------|---------|
| CRITICAL | 0 | — |
| WARNING | 1 | button name changed |
| INFO | 2 | New elements added |

### Remaining Gaps
- `src/utils/crypto.ts` — complex branching, needs manual review
```

When `--target` was used, the report includes an **Autonomous Coverage Improvement Log** table showing iteration-by-iteration results (coverage delta, tests added/kept, keep/discard status).

When `--streak=N` was used, the **Tests Generated** table gains a **Streak** column (e.g. `3/3`), and any test that could not hold the streak is listed under **Remaining Gaps** as flaky rather than counted as healed.

When `--status-protocol` is enabled, a machine-parseable summary line is emitted at the end of the report. Filter lines starting with `[COVER_` to extract the structured event stream. See `${CLAUDE_SKILL_DIR}/references/status-protocol.md` for the full event format.

## CC Tool Notes

- **Monitor tool** (CC 2.1.98+): For large test suites, use `Bash(run_in_background: true)` then `Monitor` to stream test output instead of waiting for completion. Catch failures early without blocking.

## Related Skills

- `/verify` — Run existing tests + collect evidence (Phase 5 of /develop)
- `testing-strategy-builder` — Comprehensive testing framework patterns
- `quality-gates` — Complexity assessment and blocking conditions
- `evidence-verification` — Evidence collection protocol
- `/experiment` — Generalized autonomous metric optimization (extends beyond coverage)

## References

- `${CLAUDE_SKILL_DIR}/references/fingerprint-gating.md` — SHA-256 cache gating for incremental runs
- `${CLAUDE_SKILL_DIR}/references/saved-flows.md` — Reusable YAML flow definitions for E2E tests
- `${CLAUDE_SKILL_DIR}/references/aria-diffing.md` — ARIA snapshot diffing for accessibility regression detection
- `${CLAUDE_SKILL_DIR}/references/status-protocol.md` — Machine-parseable event protocol for CI integration
- `${CLAUDE_SKILL_DIR}/references/autonomous-coverage.md` — Autonomous coverage improvement with --target flag

## Compliance

### Iron Laws

Violating the letter of these rules is violating the spirit of the rules.

**IRON LAW: NEVER MARK COVERAGE AS SUFFICIENT WITHOUT RUNNING ACTUAL TESTS**

**IRON LAW: NEVER WRITE TESTS THAT ASSERT IMPLEMENTATION DETAILS INSTEAD OF BEHAVIOR**

### Red Flags

| If You're Thinking... | Required Action |
|---|---|
| "This function is too simple to test" | STOP. Simple functions with edge cases cause the worst bugs. Write the test. |
| "I'll write tests later after the implementation" | STOP. Tests come FIRST. That's the entire point of this skill. |
| "The test passes, so I'm done" | STOP. Check coverage delta. A passing test with 0% new coverage is worthless. |
| "I'll just test the happy path" | STOP. Edge cases, error paths, and boundary conditions are mandatory. |
| "Mocking this is too hard, I'll skip it" | STOP. If it's hard to mock, the code may need refactoring. Test it anyway or flag the design issue. |

### Common Rationalizations

| Rationalization | Why It's Wrong |
|---|---|
| "This is too simple to need tests" | The simplest code often has the most assumptions. A 3-line function with an off-by-one error can cascade into production failures. |
| "The types guarantee correctness" | Types check structure, not behavior. A function can have perfect types and still return wrong results. |
| "I'll increase coverage next iteration" | Coverage debt compounds. Each deferred test makes the next one harder to write because the code grows without test constraints. |
| "These are just UI components" | UI components have state, edge cases, and accessibility requirements. They need tests like any other code. |
