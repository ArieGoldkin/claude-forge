---
name: create-handoff
description: End session properly by creating a handoff document. Use when finishing work or before long breaks.
effort: low
---

# /create-handoff

Create a YAML session handoff document for clean resumption later, and clean the ledger for the next session.

## When to Use
- Ending work session for the day
- Switching to a different project
- Before a long break
- When context is getting full
- When `/save-state` warns about ledger >500 lines
- When dirty tracking hits the auto-suggest threshold (25 file edits; warning fires at 15 — canonical values in the `dirty-state-tracker` hook)

## What It Does
- Summarizes session accomplishments and pending work
- Archives Session Activity Log from ledger into YAML handoff file
- Archives Key Decisions older than 30 days to quarterly archive
- Resets ledger to clean snapshot for next session (<300 lines target)
- Extracts learnings and patterns to `learnings/extracted-patterns.md`
- Writes timestamped YAML handoff to `.claude/continuity/handoffs/`
- Resets dirty tracking counter and marks session as cleanly ended
- Updates `last_handoff` in `shared-context.json`

## Related
- See `/continuity-management` for full system documentation
