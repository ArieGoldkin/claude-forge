---
name: experiment
description: "Autonomous metric-driven iteration loop. Modify code, measure a metric, keep improvements, discard regressions via git rollback. Works with any numeric metric and any direction (minimize/maximize). Use when: optimizing performance, reducing latency, minimizing bundle size, improving Lighthouse scores, or tuning any measurable metric. Triggers on: experiment, optimize, reduce latency, improve performance, minimize, maximize, benchmark, iterate, metric-driven, autoresearch"
effort: xhigh
context: fork
keep-coding-instructions: true
---

# Experiment

Autonomous metric-driven iteration loop inspired by Karpathy's autoresearch pattern.
The core cycle: modify code, measure a metric, keep improvements, discard regressions, repeat.
Works with any file, any numeric metric, and any direction (minimize or maximize).
Git-based safety guarantees: commit before evaluate, reset on regression -- regressions are
never persisted. Produces a structured report of what worked, what failed, and cumulative gains.

## When to Use /experiment vs Other Skills

| Goal | Use |
|------|-----|
| Improve test coverage toward a target | `/cover --target=N%` (specialized coverage loop) |
| Fix a specific bug | `/fix-bug` (observation-driven debugging) |
| Build a feature end-to-end | `/develop` (gated pipeline) |
| Optimize ANY measurable metric | `/experiment` (this skill) |
| Understand agentic loop theory | `agent-loops` (pattern reference) |

Use `/experiment` when the task has a single numeric metric, a clear direction (minimize or
maximize), and benefits from autonomous iteration rather than manual tuning.

## Quick Start

```
# Reduce API latency below 100ms
/experiment src/api/handler.ts --metric "npm run bench -- --json | jq '.results[0].mean'" --minimize --goal 100 --unit ms

# Increase Lighthouse performance score to 95
/experiment src/pages/ --metric "npx lighthouse http://localhost:3000 --output json | jq '.categories.performance.score * 100'" --maximize --goal 95

# Minimize bundle size over 15 iterations
/experiment src/ --metric "npm run build && stat -f%z dist/bundle.js" --minimize --iterations 15 --unit bytes
```

## The 8-Phase Loop

```
  SETUP ──> BASELINE ──> HYPOTHESIZE ──> MODIFY ──> EVALUATE ──> DECIDE ──> LOG ──> ITERATE?
                              ^                                                      │
                              └──────────────────────────────────────────────────────┘
                                              (if budget remains)
```

### Phase 1: Setup

Validate inputs and prepare the experiment environment.

1. Parse inline arguments or read `.experiment/config.yaml` (inline args take precedence)
2. Validate target path exists and is inside a git repository
3. Dry-run the metric command -- abort if it does not produce a parseable numeric value
4. Verify clean git working tree; stash uncommitted changes if needed
5. Create `.experiment/results/` directory if absent
6. Read prior experiment results for the same name (if any) to inform strategy
7. Create or open the results TSV file with header row

Abort if: target does not exist, metric command fails validation, or not in a git repo.

### Phase 2: Baseline

Establish the starting metric value.

1. Run the metric command against the unmodified codebase
2. Parse and record the baseline value
3. Log baseline row to TSV (iteration 0, status `baseline`)
4. Report: `"Baseline: {value} {unit}"` and if goal is set: `"Goal: {goal} {unit} (gap: {delta})"`

Abort if the metric command fails or returns non-numeric output.

### Phase 3: Hypothesize

Analyze the target code and propose a specific, focused change.

1. Read the target file(s) and all prior experiment results
2. Consider what has been tried before -- what worked, what failed, what remains unexplored
3. Formulate a hypothesis: "If I {change}, then {metric} should {improve} because {reasoning}"
4. State the hypothesis before making any modifications
5. Prefer simple changes -- when two approaches produce similar metric values, fewer lines changed wins

One change per iteration. Atomic modifications enable clear attribution.

### Phase 4: Modify

Apply the hypothesized change to the target.

1. Make the code modification within the target scope
2. Verify no readonly files were touched (`git diff --name-only` against readonly list)
3. Commit with message: `experiment: {name} iteration {N} - {one-line description}`

If a readonly or out-of-scope file was modified, immediately revert and log as `constraint_violation`.

### Phase 5: Evaluate

Run the metric command and compare to the current best.

1. Execute the metric command
2. Parse the numeric result using the extraction expression (if configured)
3. Compare to current best value, respecting direction (minimize or maximize)
4. Calculate delta (signed) and delta_pct from baseline

If the metric command crashes (non-zero exit, no numeric output), log as `crash` and revert.
If `iteration_timeout_minutes` is set and exceeded, kill the command, log as `timeout`, and revert.

### Phase 6: Decide

Keep or discard the change based on the metric comparison.

| Condition | Action | Status |
|-----------|--------|--------|
| Metric improved | Keep commit, update best value | `keep` |
| Metric unchanged or regressed | `git reset --hard HEAD~1` | `discard` |
| Metric command crashed | `git reset --hard HEAD~1` | `crash` |
| Metric command timed out | `git reset --hard HEAD~1` | `timeout` |
| Readonly/scope violation | `git reset --hard HEAD~1` | `constraint_violation` |

**Simplicity tiebreaker**: If improvement is less than 0.1% and the diff exceeds 20 lines,
treat as unchanged and discard. Prefer simplicity over marginal gains.

### Phase 7: Log

Record the iteration result.

1. Append a row to `.experiment/results/{name}.tsv`
2. Print iteration summary: `"Iteration {N}: {value} {unit} ({sign}{delta} | {status}) - {description}"`

### Phase 8: Iterate or Report

Check stopping conditions. If any triggers, generate the final report. Otherwise return to Phase 3.

**Stop conditions** (first triggered wins):
- Goal reached (metric meets or exceeds goal value in configured direction)
- Iteration budget exhausted (`max_iterations` reached)
- Time budget exhausted (`max_minutes` elapsed since Phase 1)
- User says "stop" at a human checkpoint
- Stuck: N consecutive discards with no improvement (default 5) triggers a strategy reset;
  if the next iteration also fails (N+1 consecutive), stop as STUCK

**Human checkpoint**: If `checkpoint_every` is configured and the current iteration is a
multiple of that value, pause and present a progress summary with continue/adjust/stop options.

## Configuration

### Inline Invocation

```
/experiment {target} --metric "{command}" --minimize|--maximize [options]

Options:
  --extract "{extraction command}"    # Post-process metric output (default: last stdout line)
  --goal {value}                      # Stop when metric reaches this value
  --unit {label}                      # Human-readable unit (ms, KB, %, bpb)
  --iterations {N}                    # Max iterations (default: 20)
  --minutes {N}                       # Max wall-clock minutes (default: 60)
  --checkpoint {N}                    # Pause for review every N iterations
  --readonly {path,...}               # Files/dirs the agent must not modify
  --name {experiment-name}            # Name for results tracking
  --hint "{guidance text}"            # Guide the agent's approach
```

### File-Based Configuration (.experiment/config.yaml)

```yaml
name: reduce-api-latency
description: Optimize the API handler to reduce mean response time
target: src/api/handler.ts
readonly:
  - src/api/types.ts
  - tests/

metric:
  command: "npm run bench -- --json"
  extract: "jq '.results[0].mean'"
  direction: minimize
  unit: ms
  goal: 100

budget:
  max_iterations: 15
  max_minutes: 60
  iteration_timeout_minutes: 5
  checkpoint_every: 5

hints:
  - "Consider connection pooling optimizations"
  - "The database query in lines 45-60 may be N+1"
  - "Do not change the public API signature"
```

Inline arguments override config file values. Config file overrides defaults.

Full schema: `${CLAUDE_SKILL_DIR}/references/config-schema.md`

## Safety Guardrails

| Guardrail | Behavior |
|-----------|----------|
| **Clean git state** | Stash uncommitted changes before starting; restore on completion |
| **Commit-before-evaluate** | Every modification is committed before the metric runs, ensuring clean revert |
| **Git rollback** | `git reset --hard HEAD~1` on any regression, crash, timeout, or violation |
| **Readonly enforcement** | Check `git diff --name-only` against readonly list at commit time; violations revert immediately |
| **Scope containment** | Only modify files within the target scope; out-of-scope edits are constraint violations |
| **Budget limits** | `max_iterations` (default 20, max 100), `max_minutes` (default 60, max 480) |
| **Stuck detection** | 5 consecutive discards triggers strategy reset; 6 consecutive stops the experiment |
| **Human checkpoint** | Pause every `checkpoint_every` iterations for review |
| **Destructive change prevention** | Do not delete the target, empty it, or remove all definitions |
| **Correctness gate** | If the metric command crashes after a modification, revert and log as `crash` |

Full details: `${CLAUDE_SKILL_DIR}/references/safety-guardrails.md`

## Results Tracking

Each iteration is logged to `.experiment/results/{name}.tsv`:

```
iteration	commit	metric_value	delta	delta_pct	status	description	duration_s	timestamp
0	a1b2c3d	187.3	-	-	baseline	initial measurement	2.1	2026-03-28T10:00:00Z
1	b2c3d4e	142.1	-45.2	-24.1%	keep	memoized expensive computation	45.3	2026-03-28T10:05:00Z
2	c3d4e5f	155.8	+13.7	+9.7%	discard	tried async but added overhead	62.1	2026-03-28T10:10:00Z
3	d4e5f6g	138.9	-3.2	-2.3%	keep	batched database queries	38.7	2026-03-28T10:14:00Z
4	-	-	-	-	crash	syntax error in template literal	5.2	2026-03-28T10:15:00Z
5	e5f6g7h	135.1	-3.8	-2.7%	keep	connection pooling	51.4	2026-03-28T10:20:00Z
```

Prior results are read at the start of each experiment to inform strategy and avoid repeating
failed approaches.

Full details: `${CLAUDE_SKILL_DIR}/references/results-tracking.md`

## Report Format

Generated at experiment completion and written to `.experiment/results/{name}-report.md`:

```
## Experiment Report: {name}
Started: {start_timestamp}
Completed: {end_timestamp}
Duration: {total_minutes}m {total_seconds}s
Result: {GOAL_REACHED | BUDGET_EXHAUSTED | TIME_EXHAUSTED | USER_STOPPED | STUCK}

| Metric | Baseline | Best | Final | Delta | Goal |
|--------|----------|------|-------|-------|------|
| {name} | {value}  | {value} | {value} | {sign}{delta} ({pct}%) | {goal or "none"} |

Iterations: {total} ({kept} kept, {discarded} discarded, {crashed} crashed)
Budget: {used}/{max} iterations, {minutes_used}m/{max_minutes}m

### Iteration Log
| # | Commit | Metric | Delta | Status | Description | Time |
|---|--------|--------|-------|--------|-------------|------|
| 1 | a1b2c3d | 142ms | -45ms | keep | Memoized computation | 45s |
| ... |

### Winning Changes (Cumulative Diff)
{git diff from baseline commit to final kept commit}

### Analysis
**Approaches that improved the metric:**
- {description} ({delta}, iteration {N})

**Approaches that were discarded:**
- {description} ({reason})

**Recommendations for further optimization:**
- {analysis of remaining bottlenecks}
```

## Status Protocol

When `--status-protocol` is passed, emit machine-parseable `[EXPERIMENT_*]` events:

```
[EXPERIMENT_START] name={name} target={target} direction={min|max} budget_iterations={N}
[EXPERIMENT_BASELINE] metric={value} unit={unit} goal={value|none}
[EXPERIMENT_ITERATION_DONE] iteration={N} metric={value} delta={delta} status={status} description={desc}
[EXPERIMENT_CHECKPOINT] iteration={N} kept={N} discarded={N} best={value}
[EXPERIMENT_STOP] reason={goal_reached|budget_exhausted|time_exhausted|user_stopped|stuck}
[EXPERIMENT_SUMMARY] result={result} iterations={N} kept={N} discarded={N} baseline={value} best={value} delta={delta}
```

Full details: `${CLAUDE_SKILL_DIR}/references/status-protocol.md`

## Reference Files

- `${CLAUDE_SKILL_DIR}/references/config-schema.md` -- full config.yaml schema with all fields and defaults
- `${CLAUDE_SKILL_DIR}/references/results-tracking.md` -- TSV format, trend analysis, prior-result learning
- `${CLAUDE_SKILL_DIR}/references/safety-guardrails.md` -- detailed guardrail documentation and edge cases
- `${CLAUDE_SKILL_DIR}/references/status-protocol.md` -- EXPERIMENT_* event format for CI integration

## CC Tool Notes

- **Monitor tool** (CC 2.1.98+): For long-running measurement commands, use `Bash(run_in_background: true)` then `Monitor` to stream stdout events instead of sleeping/polling. Ideal for benchmark suites or test runs that take >30s.

## Related Skills

- `/cover --target` -- specialized autonomous coverage improvement loop
- `/verify` -- constraint checking (tests, lint, typecheck) usable as a metric source
- `/fix-bug` -- observation-driven debugging (different pattern: diagnose then fix)
- `agent-loops` -- Karpathy Loop as a named agentic pattern (theory reference)
- `/develop` -- full feature pipeline (use when building, not optimizing)

## Compliance

### Iron Laws

Violating the letter of these rules is violating the spirit of the rules.

**IRON LAW: NEVER KEEP A CHANGE THAT REGRESSES THE METRIC**

**IRON LAW: NEVER MODIFY THE METRIC COMMAND TO MAKE RESULTS LOOK BETTER**

### Red Flags

| If You're Thinking... | Required Action |
|---|---|
| "The metric regressed but the code is better" | STOP. This skill is metric-driven. If the metric regressed, revert. Subjective 'better' is not evidence. |
| "Let me adjust the measurement to account for..." | STOP. Adjusting the measurement is gaming the experiment. Use the metric as defined. |
| "I'll commit this regression and fix it in the next iteration" | STOP. Regressions are NEVER persisted. Revert immediately. |
| "I've done enough iterations" | STOP. Check: did you reach the goal? If not, continue or report why the goal may be unreachable. |

### Common Rationalizations

| Rationalization | Why It's Wrong |
|---|---|
| "The metric improved by 0.1%, that's basically noise" | Small improvements compound. Commit them — reverting costs nothing, but discarding gains adds up over iterations. |
| "This metric doesn't capture the full picture" | Correct — but that's a reason to choose a better metric upfront, not to ignore the one you committed to mid-experiment. |
| "The goal is unreachable" | Report this finding with evidence (plateau pattern, diminishing returns). Don't silently give up. |
