---
description: Guided development pipeline with gating, design, planning, TDD build, and verification phases
---

# Develop: $ARGUMENTS

Activating the development pipeline to guide structured implementation.

## Parsing Arguments

From `$ARGUMENTS`, extract:

1. **Mode flag** (optional, first word if it matches): `greenfield`, `brownfield`, `bugfix`, `refactor`
2. **`--resume` flag**: Resume an interrupted pipeline from `.develop/pipeline-state.md`
3. **`--skip-design` flag**: Skip Phase 1 (Design) and go directly to Phase 2 (Plan)
4. **Task description**: Everything remaining after flags are removed

## Resume Check

If `--resume` is present:
- Read `.develop/pipeline-state.md`
- If file exists: resume from the current phase (follow resume protocol in skill)
- If file doesn't exist: report error — "No active pipeline found. Start a new one with `/develop [task]`"

## Execute Development Pipeline Skill

Follow the instructions in the `development-pipeline` skill exactly as written.

The skill will:
1. Detect or use the specified mode (greenfield/brownfield/bugfix/refactor)
2. Run Phase 0 (Gate) — identify critical unknowns, block if too many
3. Run Phase 1 (Design) — brainstorm approach (skipped for bugfix or `--skip-design`)
4. Run Phase 2 (Hypothesize) — assumptions, risks, success criteria (skipped for bugfix)
5. Run Phase 3 (Plan) — quality gates, task breakdown, test strategy
6. Run Phase 4 (Build) — TDD implementation per task
7. Run Phase 5 (Verify) — evidence collection, quality checks
8. Present summary and offer to open the MR/PR via `/etk:prepare-pr`

Each phase has a human checkpoint. Respond with: **yes**, **adjust**, **skip**, or **stop**.

**Platform Context:**
- React 19 + Python Lambda microservices
- PostgreSQL database
- Multi-tenant with user isolation
- Testing: pytest (Python), Vitest (TypeScript)

## Usage Examples

**New feature:**
```
/develop greenfield "Add user analytics aggregation API"
```

**Modify existing code:**
```
/develop brownfield "Add caching to user profile endpoint"
```

**Fix a bug:**
```
/develop bugfix "Fix null pointer in score calculation"
```

**Refactor:**
```
/develop refactor "Extract shared validation logic from Lambda handlers"
```

**Auto-detect mode:**
```
/develop "Add retry logic to external API calls"
```

**Resume interrupted pipeline:**
```
/develop --resume
```

**Skip design phase:**
```
/develop --skip-design "Quick utility function for date formatting"
```

---

Use and follow the development-pipeline skill exactly as written.
