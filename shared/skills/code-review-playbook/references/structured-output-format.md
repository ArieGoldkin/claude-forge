# Structured Review Output Format

Standard format for all agent review findings. Ensures consistency, enables filtering, and supports composite scoring.

## Finding Format

Each finding reported by a review agent MUST use this structure:

```
- **Type**: <conventional-comment-label>
- **Confidence**: <0-100>
- **Blocking**: <yes/no>
- **File:Line**: <path:line>
- **Evidence**: <what verification was done>

<discussion>
```

## Confidence Tiers

| Range | Tier | Meaning | Example |
|-------|------|---------|---------|
| 90-100 | Verified | Confirmed by tool output (test failure, lint error, grep match) | ruff reports unused import at models.py:12 |
| 70-89 | Pattern match | Clear code pattern violation with high certainty | `engine = create_engine()` inside handler body |
| 50-69 | Suspicious | Looks wrong but may have context not visible to reviewer | Complex query without apparent pagination |
| <50 | Speculative | Gut feeling, might be intentional | Function seems too long but is a single workflow |

## Filtering Rules

### Threshold Filtering

Findings with confidence below the threshold are excluded from the final report.

- **Default threshold**: 70 (configurable via `.claude/policies/review-policy.json`)
- Filtered findings are NOT shown in the report body
- The **filtered count** is shown at the end: `X findings filtered (confidence < 70)`

### Deduplication

When multiple agents report the same `File:Line`:
1. Keep the finding with the **highest confidence**
2. If tied, keep the one with the more specific label (e.g., `security` over `issue`)
3. Merge evidence from both findings

## Examples

### Confidence 95 — Verified by Tool

```
- **Type**: issue [blocking]
- **Confidence**: 95
- **Blocking**: yes
- **File:Line**: lambdas/users/activity/handler.py:47
- **Evidence**: `grep -n "    engine = get_db_engine"` confirms engine creation inside handler body

Engine creation inside lambda_handler causes ~200ms cold-start penalty per invocation.
Move `engine = get_db_engine()` to module level.
```

### Confidence 80 — Clear Pattern Match

```
- **Type**: security [blocking]
- **Confidence**: 80
- **Blocking**: yes
- **File:Line**: lambdas/users/profile/handler.py:23
- **Evidence**: Code reads `event["requestContext"]["authorizer"]["claims"]["sub"]` directly

Must use `get_username_from_event()` instead of raw claims access.
Direct claims access bypasses username validation and normalization.
```

### Confidence 60 — Suspicious (Filtered at Default Threshold)

```
- **Type**: suggestion
- **Confidence**: 60
- **Blocking**: no
- **File:Line**: frontend/web/src/features/dashboard/ActivityList.tsx:89
- **Evidence**: Visual inspection — list renders without visible pagination

Consider adding pagination if the activity list can grow beyond ~50 items.
No tool verification performed.
```

### Confidence 35 — Speculative (Always Filtered)

```
- **Type**: nitpick [non-blocking]
- **Confidence**: 35
- **Blocking**: no
- **File:Line**: lambdas/core/utils/dates.py:15
- **Evidence**: None — subjective observation

Function name `calc_date_range` could be more descriptive.
```

## Phase 6 Integration

When synthesizing agent findings in Phase 6:

1. Collect all findings from all agents
2. Apply deduplication (same File:Line → keep highest confidence)
3. Apply threshold filter (exclude < configured threshold)
4. Group by section (Code Quality, Security, Testing, Architecture)
5. Sort within section by confidence (highest first)
6. Report filtered count at the bottom
