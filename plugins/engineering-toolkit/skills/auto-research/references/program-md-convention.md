# program.md Convention

Persistent record of human intent and execution plan, following Karpathy's three-file pattern:
**program.md** (intent) + **target files** (agent-modified) + **metric** (evaluation).

## When to Create

Create `program.md` when:
- The experiment will run for more than 5 iterations
- The goal is complex enough to benefit from a written record
- The user wants to resume or re-run the experiment later

Skip `program.md` when:
- Quick one-shot operations (verify, review)
- The goal is fully captured in the command invocation

## File Location

Place in the project root or `.auto-research/` directory:
```
.auto-research/
├── program.md              # Current intent
├── results/                # Experiment results (TSV, reports)
└── history/                # Previous program.md files
```

## Format

```markdown
# Auto-Research Program

## Goal
{User's original goal in their own words}

## Strategy
- **Intent**: {classified category}
- **Skill**: {target skill with parameters}
- **Metric**: {what we measure} ({direction})
- **Budget**: {iterations} iterations / {minutes} minutes

## Target
- **Files**: {list of files the agent may modify}
- **Readonly**: {files the agent must not touch}
- **Scope**: {directory or module boundary}

## Constraints
- {Any user-specified constraints}
- {Safety boundaries}

## Context
{Optional: relevant background, prior attempts, related tickets}

## Status
- **Started**: {timestamp}
- **Current iteration**: {N}
- **Best result**: {metric value}
- **Last updated**: {timestamp}
```

## Example

```markdown
# Auto-Research Program

## Goal
Reduce the p95 API response time for /api/users endpoint below 200ms.

## Strategy
- **Intent**: optimize
- **Skill**: /experiment src/api/users/ --metric "npm run bench:users -- --json | jq '.p95'" --minimize --goal 200 --unit ms
- **Metric**: p95 latency (minimize)
- **Budget**: 15 iterations / 60 minutes

## Target
- **Files**: src/api/users/handler.ts, src/api/users/queries.ts
- **Readonly**: src/api/users/types.ts, tests/
- **Scope**: src/api/users/

## Constraints
- Do not change the public API contract
- Do not add new dependencies
- All existing tests must continue to pass

## Context
Current p95 is ~450ms. Suspected N+1 query in queries.ts.
Related ticket: PROJ-287

## Status
- **Started**: 2026-03-29T14:00:00Z
- **Current iteration**: 0 (baseline)
- **Best result**: 450ms
- **Last updated**: 2026-03-29T14:00:00Z
```

## Updating During Execution

The Status section is updated after each iteration. The rest of the file remains immutable
once execution begins — it is the contract between human intent and agent execution.

## Resuming

To resume an interrupted auto-research session:
1. Read the existing `program.md`
2. Check the Status section for last iteration and best result
3. Continue from where execution stopped
4. The program.md serves as both the plan and the checkpoint
