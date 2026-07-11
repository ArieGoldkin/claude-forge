---
name: verify
description: "Run tests, linting, and type checking with structured evidence collection. Auto-detects project stack (Node, Python, Rust). Reports quality level: all clear, warnings, failures, or blocked. Optional streak gate requires N consecutive green runs before declaring success. Use when: validating code before commit, checking CI readiness, running all project checks, or collecting evidence for a PR. Triggers on: verify, run checks, quality check, run tests, does it pass, lint, typecheck, pre-commit check, green, validate, flaky test, streak gate"
effort: medium
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "package.json"
  - "tsconfig.json"
context: fork
keep-coding-instructions: true
---

# Verify

Run a structured quality verification pass and collect evidence. Works standalone or as the final phase of `/develop`.

## `/etk:verify` vs the built-in `/verify` (different questions, same name)

Claude Code ships a built-in **`/verify`** with the same name but the **opposite method** — know which you want:

| | **`/etk:verify`** (this skill) | built-in **`/verify`** |
|---|---|---|
| Question | *"Is it green / CI-ready?"* | *"Does it actually work when run?"* |
| Method | **Static checks** — runs tests, lint, typecheck; collects pass/fail evidence | **Runtime observation** — builds + **runs the app**, drives the surface, observes behavior (explicitly *does not* run tests/typecheck) |
| Evidence | check results, streak gate | stdout / response bodies / screenshots from the running app |
| Verdict | all-clear / warnings / failures / blocked | PASS / FAIL / BLOCKED / SKIP |

They are **complementary, not redundant** — a change can be green (`/etk:verify`) yet not actually work when run (built-in `/verify`), and vice-versa. For high-stakes changes, run **both**: `/etk:verify` for the CI-readiness evidence a PR needs, then the built-in `/verify` to confirm the behavior end-to-end. `/develop` Phase 5 uses **this** skill for its evidence gate; drive the built-in `/verify` separately when behavioral confirmation matters. (We deliberately do **not** rebuild the runtime-observation capability — the built-in owns it.)

## Verification Pass

Execute these checks in order. Skip any that don't apply to the current project (e.g., skip typecheck if no TypeScript).

### Step 1: Detect Project Stack

Scan for configuration files to determine which checks apply:

| File | Check Enabled |
|------|---------------|
| `package.json` with `test` script | Tests (npm) |
| `pytest.ini`, `pyproject.toml` with pytest | Tests (pytest) |
| `tsconfig.json` | TypeScript typecheck |
| `biome.json`, `.eslintrc*` | JS/TS linting |
| `ruff.toml`, `pyproject.toml` with ruff | Python linting |
| `Cargo.toml` | Rust checks (`cargo test`, `cargo clippy`) |

### Step 2: Run Checks

Run all applicable checks. Capture exit code, output summary, and duration for each.

```bash
# Tests (pick the right runner)
npm test -- --run          # Node.js (vitest/jest)
pytest                     # Python
cargo test                 # Rust

# Type checking
npx tsc --noEmit           # TypeScript
mypy .                     # Python (if configured)

# Linting
npx biome check .          # Biome
npx eslint .               # ESLint
ruff check .               # Python
cargo clippy               # Rust
```

**Important**: Run each check independently. A failure in one should not prevent running the others — collect all evidence.

### Step 2b: Streak Verification (when `--streak=N` is set)

Single-shot pass/fail can be fooled by a flaky test that passes once by luck. When `--streak=N` is set (N ≥ 2), run the flaky-prone check (the **test** suite) **N times in a row, freshly each time** — no prior or cached result counts toward the streak — and gate success on the streak:

- Report **All clear** / **Warnings only** only if **every** one of the N runs passes.
- If **any** run fails, the result is **Failures** — record which run first broke the streak (e.g. "run 2 of 3") and surface that output. A suite that passes 2 of 3 times is a flaky failure, not a pass.
- Run typecheck and lint **once** — they are deterministic, so a streak adds nothing.
- Keep per-run evidence; the summary reports the streak, e.g. `Tests | PASS | streak 3/3`.

Default is `--streak=1` (current single-pass behavior); nothing changes unless the user opts in. Streak gating is the structured form of "run it again to rule out flakiness" — prefer it over eyeballing a re-run when a green result must be trustworthy (CI gating, pre-release).

### Step 3: Collect Evidence

For each check, record:

| Field | Value |
|-------|-------|
| Check | test / typecheck / lint |
| Command | Exact command run |
| Exit code | 0 = pass, non-zero = fail |
| Duration | Seconds |
| Summary | Pass/fail counts, error count, warning count |
| Key output | First 10 lines of errors if failed |

### Step 4: Assess Quality Level

Based on collected evidence, assign a quality level:

| Level | Criteria | Action |
|-------|----------|--------|
| **All clear** | Every check passes (exit 0) | Safe to commit/PR |
| **Warnings only** | All pass but lint warnings exist | Review warnings, commit if acceptable |
| **Failures** | One or more checks fail | Fix failures before proceeding |
| **Blocked** | Tests can't run (missing deps, build broken) | Resolve blockers first |

### Step 5: Present Results

Present a summary table:

```
## Verification Results

| Check      | Status | Duration | Details          |
|------------|--------|----------|------------------|
| Tests      | PASS   | 12.4s    | 24 passed, 0 failed |
| Typecheck  | PASS   | 3.2s     | No errors        |
| Lint       | WARN   | 1.1s     | 0 errors, 3 warnings |

**Quality Level**: Warnings only
**Recommendation**: Review 3 lint warnings, then safe to commit.
```

If any check failed, show the key error output and suggest fixes.

## Options

The user can request specific scopes:

- `/verify` — Run all applicable checks (default)
- `/verify tests` — Run only tests
- `/verify lint` — Run only linting
- `/verify typecheck` — Run only type checking
- `/verify --fix` — Run lint with auto-fix, then verify
- `/verify --streak=N` — Require N consecutive green test runs before reporting success (flaky-test defense; default 1). See Step 2b.

## Integration with /develop

When invoked as Phase 5 of `/develop`, follow the same process but also:
- Check evidence against quality-gates thresholds (see `etk:quality-gates`)
- Present the human checkpoint with continue/adjust/stop options

## CC Tool Notes

- **Monitor tool** (CC 2.1.98+): For long test/lint/typecheck runs, use `Bash(run_in_background: true)` then `Monitor` to stream stdout events. Detects failures in real-time without blocking the conversation.

## Evidence Standards

For detailed evidence templates and production-grade requirements, see `${CLAUDE_SKILL_DIR}/references/evidence-standards.md`.

## Compliance

### Iron Laws

Violating the letter of these rules is violating the spirit of the rules.

**IRON LAW: NEVER REPORT A CHECK AS PASSING WITHOUT ACTUALLY RUNNING IT**

**IRON LAW: NEVER SUPPRESS OR IGNORE FAILING CHECK OUTPUT**

### Red Flags

| If You're Thinking... | Required Action |
|---|---|
| "This check doesn't apply to this project" | STOP. Verify by looking for config files. Don't assume — detect. |
| "The test failed but it's probably flaky" | STOP. Run it again — or use `--streak=N` to require N consecutive passes. If it fails even once, treat it as a real failure. Report it. |
| "Linting warnings aren't important" | STOP. Warnings are evidence. Report them and let the user decide severity. |
| "I already know the code is correct" | STOP. Verification exists because confidence is not evidence. Run the checks. |

### Common Rationalizations

| Rationalization | Why It's Wrong |
|---|---|
| "The build succeeded so it must be correct" | Build success means no syntax errors. It says nothing about logic, behavior, or test coverage. |
| "These are just style warnings" | Style consistency prevents bugs by making code predictable. Style warnings may also mask real issues in noisy output. |
| "Type checking passed, tests are redundant" | Types verify structure; tests verify behavior. Both are required — they catch different categories of bugs. |
