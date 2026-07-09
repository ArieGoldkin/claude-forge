---
name: check-maintenance
description: Check continuity system health and file integrity. Use for periodic maintenance checks.
effort: low
---

# /check-maintenance

Check the health of the continuity system and identify maintenance needs.

## When to Use
- Weekly maintenance (every Friday or end of week)
- When experiencing slow context loading
- Before long breaks (end of month, vacation)
- When Claude suggests maintenance

## What It Does
- Checks ledger size, handoff file count, shared-context size, and archive recency against the canonical health thresholds (defined once in the /check-maintenance command, Notes → Health thresholds)
- Estimates context token consumption across all subsystems
- Displays health dashboard with status indicators and specific recommendations
- Suggests priority-ordered maintenance commands to run

## Related
- See `/continuity-management` for full system documentation
