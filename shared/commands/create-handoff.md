---
description: End session properly by creating a handoff document. Use when finishing work or before long breaks.
---

# /create-handoff - End Session Properly

Create a session handoff document for clean resumption later, and **clean the ledger** for the next session.

**Output Format**: YAML (`.yaml`) - ~30% fewer tokens than markdown, machine-parseable

## Model: Append-Until-Handoff

This command is the **session boundary** where cleanup happens:
- Archives Session Activity Log to handoff file (YAML format)
- Archives old Key Decisions (>30 days) to quarterly archive
- Resets ledger to clean snapshot for next session
- **Resets dirty_tracking counter** and marks session as cleanly ended

## When to Use

- Ending work session for the day
- Switching to a different project
- Before a long break
- When context is getting full
- **When `/save-state` warns about ledger >500 lines**
- **When dirty_tracking shows ≥25 file edits (the auto-suggest threshold; canonical values in the `dirty-state-tracker` hook)**

## What This Command Does

1. **Summarize session**: Document what was accomplished
2. **Capture pending work**: Note what's left to do
3. **Document blockers**: Record any issues
4. **Extract learnings**: Add patterns to learnings file
5. **Create handoff file**: Timestamped YAML document (`.yaml`)
6. **Update tracking**: Set `last_handoff` in shared-context.json
7. **Reset dirty_tracking**: Clear file edit counter, mark `was_cleanly_ended: true`
8. **CLEAN LEDGER**: Archive accumulated content, reset for next session

## Execution Steps

### Step 1: Gather Session Information

Ask user or infer from context:
- What was the main topic/task?
- How long was the session?
- What was accomplished?

### Step 2: Read Context

```
Read: .claude/context/shared-context.json
Read the project ledger in .claude/continuity/ledgers/
LEDGER=$(ls .claude/continuity/ledgers/CONTINUITY_*.md | head -1)
```

### Step 3: Create Handoff Content (YAML Format)

Using template from `skills/continuity-management/templates/handoff-template.yaml`:

```yaml
# Metadata
created: "{{TIMESTAMP}}"
duration_hours: {{DURATION}}
branch: "{{BRANCH}}"
session_id: "{{SESSION_ID}}"

# What was completed
accomplished:
  - item: "Description"
    type: feature|bugfix|refactor

# Session activity (archived from ledger)
session_activity_log:
  - timestamp: "{{TS}}"
    entries: ["{{ENTRY}}"]

# Work remaining
pending:
  - task: "Description"
    priority: high|medium|low
    recommended_first: true

# Blockers (empty array if none)
blockers: []

# Key decisions
key_decisions:
  - decision: "What was decided"
    reasoning: "Why"

# Files touched
files_modified:
  - path: "file/path"
    change_type: created|modified|deleted

# Quality checks at end of session
quality_checks:
  biome: pass|fail
  typescript: pass|fail
  tests: {passed: N, failed: N}

# Dirty tracking stats
dirty_tracking:
  files_edited_count: {{COUNT}}
  threshold_triggered: false
```

### Step 4: Extract Learnings

If new patterns discovered:
```
Read: .claude/continuity/learnings/extracted-patterns.md
Add: New patterns with source session and date
Write: Updated learnings file
```

### Step 5: Write Handoff File (YAML)

Filename format: `<YYYY-MM-DD>_<topic>.yaml`

```
Write: .claude/continuity/handoffs/2026-01-07_topic-name.yaml
```

### Step 6: CLEAN LEDGER (New in Append Model)

This is the critical cleanup step that makes the append model sustainable:

#### 6a: Archive Session Activity Log

Move the entire Session Activity Log to the handoff file, then clear it from ledger:

```markdown
## Session Activity Log
<!-- Cleared on /create-handoff at YYYY-MM-DDTHH:MM:SSZ -->
<!-- Previous session archived to: handoffs/YYYY-MM-DD_topic.md -->
```

#### 6b: Archive Old Key Decisions

For Key Decisions older than 30 days:
1. Move to quarterly archive: `.claude/continuity/archive/ledger-YYYY-QQ.md`
2. Keep in ledger: Only decisions from last 30 days
3. Add archive reference in ledger

```markdown
## Key Decisions
<!-- Decisions older than 30 days archived to: archive/ledger-YYYY-QQ.md -->

### Architecture
[Only recent decisions remain]
```

#### 6c: Reset Current State

Update Current State to clean snapshot:
- Now: Summary of where things stand
- Done (Recent): Last 5 items only (not full history)
- Next: Immediate priorities

#### 6d: Verify Line Count

After cleanup, ledger should be <300 lines. If still >500 lines:
- Archive more aggressively
- Move project-specific documentation to separate files
- Warn user about potential issues

### Step 7: Update shared-context.json

Track the handoff and reset dirty tracking for clean session boundary:
```
Edit: .claude/context/shared-context.json
Update: continuity.last_handoff = ".claude/continuity/handoffs/<filename>.yaml"
Update: continuity.last_cleanup = current ISO timestamp
Reset: dirty_tracking.files_edited_count = 0
Reset: dirty_tracking.files_edited_this_session = []
Reset: dirty_tracking.last_edit_timestamp = null
Update: session_heartbeat.was_cleanly_ended = true
```

## Output

Confirm handoff creation:
- Handoff file path (`.yaml`)
- Summary of what's documented
- **Dirty tracking stats** (files edited this session)
- **Ledger cleanup summary** (lines before/after, content archived)
- Reminder to use `/resume-session` next time

## Example Usage

User: /create-handoff

Claude:
1. Asks: "What was the main topic of this session?"
2. Gathers context from shared-context.json
3. Creates handoff: `.claude/continuity/handoffs/2026-01-07_continuity-implementation.yaml`
4. **Resets dirty tracking:**
   - Files edited this session: 12
   - Marked session as cleanly ended
5. **Cleans ledger:**
   - Session Activity Log: Archived 5 entries → cleared
   - Key Decisions: Archived 3 old decisions (>30 days) → 5 remain
   - Ledger: 456 lines → 187 lines (59% reduction)
6. Confirms: "Handoff created. Ledger cleaned. Resume with `/resume-session`"

## Handoff File Structure (YAML)

```yaml
# Session Handoff: [Topic]
created: "YYYY-MM-DDTHH:MM:SSZ"
duration_hours: X
branch: "[branch-name]"
session_id: "[session-id]"

accomplished:
  - item: "[Completed item]"
    type: feature
    commits: ["abc1234"]

session_activity_log:
  - timestamp: "YYYY-MM-DD HH:MM"
    entries:
      - "[Entry 1]"
      - "[Entry 2]"

pending:
  - task: "[Priority item]"
    priority: high
    recommended_first: true

blockers: []

key_decisions:
  - decision: "[What was decided]"
    reasoning: "[Why]"

files_modified:
  - path: "[file/path]"
    change_type: modified

quality_checks:
  biome: pass
  typescript: pass
  tests: {passed: 10, failed: 0}

dirty_tracking:
  files_edited_count: 12
  threshold_triggered: false

context:
  patterns_discovered: []
  open_questions: []
  session_notes:
    - "[What worked, what to avoid]"
```

## Cleanup Behavior Summary

| Content | Action | Destination |
|---------|--------|-------------|
| Session Activity Log | Archive + Clear | Handoff file |
| Key Decisions (>30 days) | Archive + Remove | `archive/ledger-YYYY-QQ.md` |
| Key Decisions (<30 days) | Keep | Ledger |
| Current State | Reset to snapshot | Ledger |
| Done (Recent) | Trim to last 5 | Ledger |
| Open Questions | Keep current | Ledger |

---
*Model: Append-Until-Handoff (v2.0)*
