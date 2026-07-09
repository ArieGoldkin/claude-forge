# Proactive Triggering (Auto-Awareness)

Claude monitors session state and suggests commands at critical moments.

## Trigger Conditions

> Numeric thresholds below mirror the canonical set in the /check-maintenance command (Notes → Health thresholds) — when changing a value, update the canonical block first, then this file.

**`/save-state` triggers:**
- 5+ tasks completed since last save (requires TodoWrite tracking)
- Architectural decision recorded in shared-context.json
- Complex operations: 3+ agents spawned OR 10+ files edited
- Multiple major tasks completed in succession
- Multi-agent coordination completed

**`/create-handoff` triggers:**
- User signals session end: "done", "that's it", "good stopping point", "ending session"
- User explicitly says "switching projects" or "done for today"
- After extended work session with multiple milestones

**`/resume-session` triggers:**
- New session started (auto-loaded via SessionStart hook)
- User says "where were we" or "what was I working on"

**`/check-maintenance` triggers:**
- Weekly routine (recommended Friday EOD)
- Before starting major new feature work
- After completing large feature (5+ days work)
- When context loading feels slow

**`/archive-ledger` triggers:**
- Ledger exceeds 500 lines (warning threshold)
- Ledger exceeds 800 lines (urgent threshold)
- `/check-maintenance` recommends archiving
- Before quarterly breaks or project milestones

**`/archive-handoffs` triggers:**
- Handoff directory has >20 files (warning threshold)
- Handoff directory has >40 files (urgent threshold)
- `/check-maintenance` recommends archiving
- Monthly maintenance routine

## Suggestion Format

All suggestions follow this template:
```
Continuity Suggestion: [Command] recommended
Reason: [Why this moment]
Action: [Specific command]
Impact: [What gets preserved/improved]

Skip if not at a good stopping point.
```

## Rate Limiting

- Maximum 1 suggestion per 30 minutes
- Never interrupt active coding/thinking
- Wait for natural breakpoints (task completion, user pause)
- Suppress suggestions during agent execution

**Implementation:**
1. Before suggesting, read `shared-context.json` -> check `continuity.last_suggestion.timestamp`
2. Calculate time since last suggestion
3. If < 30 minutes, suppress current suggestion
4. After suggesting, update `shared-context.json` with new timestamp

**Note on Detectable Triggers:**
- Task counting requires TodoWrite usage
- Time-based triggers replaced with activity-based proxies (file edits, agent spawns)
- Context monitoring replaced with observable complexity metrics
