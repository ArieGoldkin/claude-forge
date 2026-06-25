# Worked Examples

End-to-end examples showing the full 5-phase flow for each route. Read these to understand
how classify → plan → confirm → execute → report works in practice.

## Table of Contents

- [Example 1: optimize → /experiment](#example-1-optimize--experiment)
- [Example 2: fix → /fix-bug](#example-2-fix--fix-bug)
- [Example 3: cover → /cover --target](#example-3-cover--cover---target)
- [Example 4: design → /brainstorming](#example-4-design--brainstorming)
- [Example 5: build → /develop](#example-5-build--develop)
- [Example 6: review → /review-mr](#example-6-review--review-mr)
- [Example 7: verify → /verify](#example-7-verify--verify)

---

## Example 1: optimize → /experiment

**User input:**
```
/auto-research reduce p95 API latency for /api/users below 200ms
```

**Phase 1 — Classify:**
- Signal words: "reduce", "latency", "below 200ms" → `optimize`
- Metric: p95 latency
- Direction: minimize
- Goal: 200ms
- Target: `/api/users` endpoint

**Phase 2 — Plan:**
Scan codebase for the endpoint handler. Find `src/api/users/handler.ts` and
`src/api/users/queries.ts`. Infer metric command from project's benchmark setup.

**Phase 3 — Confirm:**
```
┌─────────────────────────────────────────────────────┐
│  Auto-Research Plan                                 │
├─────────────────────────────────────────────────────┤
│  Goal:     Reduce p95 API latency below 200ms       │
│  Strategy: optimize                                 │
│  Skill:    /experiment src/api/users/               │
│            --metric "npm run bench:api -- --json     │
│            | jq '.endpoints[\"users\"].p95'"        │
│            --minimize --goal 200 --unit ms          │
│  Target:   src/api/users/handler.ts                 │
│            src/api/users/queries.ts                  │
│  Budget:   10 iterations / 30 minutes               │
│  Metric:   p95 latency (minimize)                   │
├─────────────────────────────────────────────────────┤
│  [Run]  [Adjust]  [Cancel]                          │
└─────────────────────────────────────────────────────┘
```

**Phase 4 — Execute:**
Invoke `/experiment` with the planned parameters. Heartbeat every 60s:
```
[auto-research] iteration 1/10 | p95: 450ms → 380ms | best: 380ms | 2m04s
[auto-research] iteration 2/10 | p95: 380ms → 340ms | best: 340ms | 4m12s
[auto-research] iteration 3/10 | p95: 340ms → 355ms | discarded  | 6m30s
[auto-research] iteration 4/10 | p95: 340ms → 290ms | best: 290ms | 8m45s
[auto-research] iteration 5/10 | p95: 290ms → 195ms | GOAL MET   | 10m58s
```

**Phase 5 — Report:**
```
## Auto-Research Report

Goal:     Reduce p95 API latency for /api/users below 200ms
Strategy: /experiment (minimize p95 latency)
Result:   GOAL_REACHED
Duration: 10m58s

### What Worked
- Added composite index on (user_id, status) → p95: 450ms → 380ms
- Batched N+1 query into single JOIN → p95: 380ms → 340ms
- Connection pooling with pg-pool → p95: 340ms → 195ms

### What Didn't Work
- Async prefetch (added complexity without improvement, discarded)

### Cumulative Improvement
p95 latency: 450ms → 195ms (-255ms, -57%)

### Next Steps
- Monitor in production for 48h to confirm improvement holds
```

---

## Example 2: fix → /fix-bug

**User input:**
```
/auto-research fix the intermittent timeout in payment handler
```

**Phase 1 — Classify:**
- Signal words: "fix", "timeout" → `fix`
- Bug description: "intermittent timeout in payment handler"
- Target: payment handler (scan for `payment` in filenames)

**Phase 2 — Plan:**
```
Goal:     Fix intermittent timeout in payment handler
Strategy: fix
Skill:    /fix-bug intermittent timeout in payment handler
Target:   src/api/payments/handler.ts (inferred)
Budget:   30 minutes
Metric:   Bug resolved (tests pass, timeout eliminated)
```

**Phase 3 — Confirm:** Present plan, get approval.

**Phase 4 — Execute:**
Invoke `/fix-bug`. Heartbeat at observation loop boundaries:
```
[auto-research] phase: observe   | reading handler.ts, scanning logs
[auto-research] phase: hypothesize | suspect: connection not released on error path
[auto-research] phase: act       | adding try/finally around db connection
[auto-research] phase: observe   | running tests... 47/47 pass, no timeout in 5 runs
[auto-research] result: fix applied
```

**Phase 5 — Report:**
```
## Auto-Research Report

Goal:     Fix intermittent timeout in payment handler
Strategy: /fix-bug (observation-driven debugging)
Result:   GOAL_REACHED
Duration: 8m32s

### What Worked
- Root cause: DB connection not released on error path in processPayment()
- Fix: wrapped connection usage in try/finally block

### Next Steps
- Add regression test for connection leak scenario
```

---

## Example 3: cover → /cover --target

**User input:**
```
/auto-research bring test coverage above 85%
```

**Phase 1 — Classify:**
- Signal words: "coverage", "above 85%" → `cover`
- Target: 85%

**Phase 2 — Plan:**
```
Goal:     Bring test coverage above 85%
Strategy: cover
Skill:    /cover --target 85
Target:   Full project
Budget:   10 iterations / 30 minutes
Metric:   Line coverage % (maximize, goal: 85)
```

**Phase 3 — Confirm:** Present plan, get approval.

**Phase 4 — Execute:**
```
[auto-research] iteration 1/10 | coverage: 72% → 76% | +4.0% | 3m15s
[auto-research] iteration 2/10 | coverage: 76% → 79% | +3.0% | 6m22s
[auto-research] iteration 3/10 | coverage: 79% → 83% | +4.0% | 9m40s
[auto-research] iteration 4/10 | coverage: 83% → 86% | GOAL MET | 12m55s
```

**Phase 5 — Report:**
```
## Auto-Research Report

Goal:     Bring test coverage above 85%
Strategy: /cover --target 85
Result:   GOAL_REACHED
Duration: 12m55s

### Cumulative Improvement
Line coverage: 72% → 86% (+14%, 4 iterations)

### Tests Added
- auth.auto.test.ts (12 tests, +4% coverage)
- payments.auto.test.ts (8 tests, +3% coverage)
- notifications.auto.test.ts (6 tests, +4% coverage)
- utils.auto.test.ts (4 tests, +3% coverage)
```

---

## Example 4: design → /brainstorming

**User input:**
```
/auto-research design an event-driven notification system
```

**Phase 1 — Classify:**
- Signal words: "design" → `design`
- Topic: "event-driven notification system"
- Complexity: multi-system → suggest `--deep` mode

**Phase 2 — Plan:**
```
Goal:     Design an event-driven notification system
Strategy: design
Skill:    /brainstorming --deep event-driven notification system
Target:   N/A (design phase, no code changes)
Budget:   30 minutes (deep mode)
Metric:   N/A (design output, not measurable)
```

**Phase 3 — Confirm:** Present plan. Note: "This is a design exercise — no code will be
modified. The brainstorming skill will run 8 parallel agents for comprehensive analysis."

**Phase 4 — Execute:**
```
[auto-research] phase: context detection | scanning project stack
[auto-research] phase: interrogation    | gathering constraints
[auto-research] phase: parallel agents  | 8 agents launched
[auto-research] phase: synthesis        | integrating perspectives
[auto-research] phase: presentation     | design ready for review
```

**Phase 5 — Report:** Delegates to brainstorming's own output format (executive summary
with decision points). Auto-research adds a wrapper:
```
## Auto-Research Report

Goal:     Design an event-driven notification system
Strategy: /brainstorming --deep
Result:   DESIGN_COMPLETE
Duration: 22m15s

### Output
See brainstorming output above for full design with decision points.

### Next Steps
- Run /auto-research build the notification system to implement the design
```

---

## Example 5: build → /develop

**User input:**
```
/auto-research implement the user preferences page from PROJ-142
```

**Phase 1 — Classify:**
- Signal words: "implement", "PROJ-142" → `build`
- Feature: user preferences page
- Ticket: PROJ-142

**Phase 2 — Plan:**
```
Goal:     Implement user preferences page (PROJ-142)
Strategy: build
Skill:    /develop implement user preferences page (PROJ-142)
Target:   New feature (greenfield mode)
Budget:   Pipeline-driven (follows /develop phases)
Metric:   Feature complete with tests passing
```

**Phase 3 — Confirm:** Present plan, get approval.

**Phase 4 — Execute:** Follow /develop pipeline phases. Heartbeat at phase boundaries:
```
[auto-research] phase: design       | reading ticket, scanning existing patterns
[auto-research] phase: plan         | breaking into implementation tasks
[auto-research] phase: build        | implementing components (task 1/4)
[auto-research] phase: build        | implementing components (task 3/4)
[auto-research] phase: verify       | running tests and quality checks
[auto-research] result: feature complete
```

---

## Example 6: review → /review-mr

**User input:**
```
/auto-research review MR !65
```

**Phase 1 — Classify:**
- Signal words: "review", "MR", "!65" → `review`
- MR number: 65

**Phase 2 — Plan:**
```
Goal:     Review MR !65
Strategy: review
Skill:    /review-mr 65
Budget:   Single pass
```

**Phase 3 — Confirm:** Present plan, get approval.

**Phase 4 — Execute:** Delegate to `/review-mr`. Single pass, no iteration.

---

## Example 7: verify → /verify

**User input:**
```
/auto-research make sure everything passes before I push
```

**Phase 1 — Classify:**
- Signal words: "make sure", "passes" → `verify`

**Phase 2 — Plan:**
```
Goal:     Verify all quality checks pass
Strategy: verify
Skill:    /verify
Budget:   Single pass
```

**Phase 3 — Confirm:** Brief confirmation (verify is low-risk, quick):
"Running /verify (tests + lint + typecheck). Proceed?"

**Phase 4 — Execute:** Single pass, results inline. No heartbeat needed.
