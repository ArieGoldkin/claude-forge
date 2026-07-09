---
name: continuity-management
description: "Multi-session state preservation and context management. Covers save-state, create-handoff, resume-session, check-maintenance, archive, metrics, and setup. Append-until-handoff model with dirty tracking and session heartbeat. Use when: saving progress, ending a session, resuming work, or managing continuity health. Triggers on: continuity, save state, handoff, resume session, session management, context preservation, maintenance check, ledger, archive, continuity setup"
effort: low
---

# Session Continuity Management

## Overview

This skill provides comprehensive guidance for managing context across Claude sessions, ensuring continuity while maintaining system performance through proactive archiving and maintenance.

**Model**: Append-Until-Handoff (v3.0)
- Session Activity Log and Key Decisions **accumulate** during session
- Cleanup happens only on `/create-handoff` (session boundary)
- Provides audit trail of work within session while keeping inter-session state lean
- **NEW**: Automatic dirty tracking (file edits trigger handoff suggestions)
- **NEW**: Session heartbeat (stale session detection)
- **NEW**: YAML handoff format (~30% token reduction)

## Automation Features (v3.0)

### Dirty Tracking

Automatically tracks file edits and suggests handoffs:

- **Threshold Warning**: 15 edits -> "Approaching handoff threshold"
- **Auto-Suggest**: 25 edits -> "Consider /create-handoff"
- Canonical values live in the `dirty-state-tracker` hook (`shared/hooks-infra/src/hooks/posttool/dirty-state-tracker.ts`)
- Stored in `shared-context.json` -> `dirty_tracking`

### Session Heartbeat

Detects sessions that ended without proper handoff:

- On session start, checks `was_cleanly_ended` flag
- If `false`, warns: "Previous session ended without /create-handoff"
- `/create-handoff` sets `was_cleanly_ended: true`
- Session start sets `was_cleanly_ended: false`

### Hook Automation

| Hook | Trigger | Action |
|------|---------|--------|
| `SessionStart` | New session | Load context + stale detection |
| `PreCompact` | Before /compact | Save timestamp to ledger |
| `PostToolUse` | Write/Edit tools | Increment dirty counter |

**Configuration**: `hooks/hooks.json`

---

## Quick Reference

| Command | When | Action |
|---------|------|--------|
| `/save-state` | After 3-5 tasks, at milestones | **APPEND** to Session Activity Log + Key Decisions; **REPLACE** Current State |
| `/create-handoff` | End of session, before breaks, >=25 edits | Create YAML handoff + **CLEAN** ledger + reset dirty tracking |
| `/resume-session` | Starting fresh session | Load previous context (auto or manual) |
| `/check-maintenance` | Weekly, before major work | Check system health (ledger, handoffs) |
| `/archive-ledger` | When ledger >500 lines | Archive old sections to quarterly files |
| `/archive-handoffs` | When handoffs >20 files | Archive old handoffs (>30 days) to monthly folders |
| `/continuity-metrics` | Check system status | View metrics dashboard with recommendations |
| `/setup-continuity` | First-time setup | Initialize continuity system with wizard |
| `/setup-context-monitor` | First-time setup | Configure StatusLine context monitoring |

## Append-Until-Handoff Model

The continuity system uses an **append-until-handoff** model for optimal balance between history preservation and performance:

### Section Behaviors

| Section | `/save-state` | `/create-handoff` |
|---------|---------------|-------------------|
| **Session Activity Log** | APPEND (new entry at top) | Archive to handoff + CLEAR |
| **Key Decisions** | APPEND (preserve history) | Archive >30 days + KEEP recent |
| Current State (Now/Done/Next) | REPLACE (snapshot) | Reset to clean snapshot |
| Open Questions | REPLACE (snapshot) | Keep current |

### Benefits of This Model

1. **Information preservation**: Mid-session work is never lost
2. **Debugging breadcrumbs**: Can trace "I tried X, it failed, so I did Y"
3. **Threshold-based cleanup**: Automatic when ledger >500 lines
4. **Clean session boundaries**: Each session starts fresh via handoff
5. **Decision audit trail**: Key Decisions accumulate with timestamps

### When Cleanup Happens

- **During session**: Content accumulates (Session Activity Log grows)
- **At session end**: `/create-handoff` archives and cleans
- **Emergency**: If ledger >500 lines, `/save-state` warns to run `/create-handoff`

---

## Proactive Triggering (Auto-Awareness)

Claude monitors session state and suggests commands at critical moments. This includes trigger conditions for each command, the suggestion format template, and rate limiting rules (max 1 suggestion per 30 minutes).

**Full reference:** `${CLAUDE_SKILL_DIR}/references/trigger-conditions.md`

---

## System Architecture

```
shared-context.json     Ledger.md          Handoffs/         Archives/
---------------------   ---------          ----------        ----------
Machine-readable        Human-readable     Session-end       Historical
Updated: continuously   Updated: on-demand Created: manual   Archived: quarterly/monthly
```

**Separation of concerns**: Each system has ONE job. No overlap.

| Question | System |
|----------|--------|
| "What decisions were made?" | `shared-context.json` |
| "What's the current project state?" | Ledger (lean, <500 lines) |
| "What was I working on last session?" | Latest handoff |
| "What patterns did we learn?" | `learnings/extracted-patterns.md` |
| "What was done 3 months ago?" | Archive files (ledger-YYYY-QQ.md) |
| "Is the system healthy?" | `/check-maintenance` output |

---

## Per-Command Skills

Each command also has a dedicated skill for direct invocation:
`/save-state`, `/create-handoff`, `/resume-session`, `/check-maintenance`, `/archive-ledger`, `/archive-handoffs`, `/continuity-metrics`, `/setup-continuity`, `/setup-context-monitor`

## Commands

Detailed workflows for all 9 commands (purpose, when to use, step-by-step process, output format, and evidence of completion) are documented in the command guide.

**Full reference:** `${CLAUDE_SKILL_DIR}/references/command-guide.md`

---

## File Locations and Maintenance

File paths for active files (ledger, handoffs, learnings, context) and archive files, plus the recommended daily/weekly/monthly maintenance schedule.

**Full reference:** `${CLAUDE_SKILL_DIR}/references/file-structure.md`

---

## Templates

Read templates when creating new files:

- `${CLAUDE_SKILL_DIR}/templates/ledger-template.md` - When creating ledger for new project
- `${CLAUDE_SKILL_DIR}/templates/handoff-template.yaml` - YAML handoff format (~30% token savings)

---

## Integration Notes

Complement (not replace) existing context management:

- Continue updating `shared-context.json` with decisions and tasks during work
- Use ledger for human-readable project overview at checkpoints
- Use handoffs for explicit session transitions only
- Run maintenance commands proactively to prevent context bloat
- Extract learnings regularly; promote patterns to permanent rules after 3+ sessions

---

## Health Indicators

A healthy system keeps the ledger lean and recent, the handoffs directory to the last ~30 days, shared-context small, and archives organized by quarter/month; context should load in under ~2 seconds. Degradation shows as a bloated ledger/handoffs/shared-context and noticeably slow context loading.

**Canonical numeric thresholds** (ledger lines, handoff count, shared-context KB, archive recency) are defined once in the /check-maintenance command (Notes → Health thresholds) — run /check-maintenance to evaluate them.

---

## Additional Resources

- **Ledger Template**: `${CLAUDE_SKILL_DIR}/templates/ledger-template.md` - Structure for creating project ledgers
- **Handoff Template**: `${CLAUDE_SKILL_DIR}/templates/handoff-template.yaml` - Structure for session handoffs
- **Command Files**: `commands/*.md` - Detailed implementation guides for each command

---

**Version**: 3.0.0 | **Updated**: 2026-02-25
**Model**: Append-Until-Handoff v3 - Session Activity Log and Key Decisions accumulate; cleaned on /create-handoff
**Features**: Dirty tracking, session heartbeat, stale detection, YAML handoffs, metrics dashboard
