---
description: Archive old ledger sections to reduce file size. Use when ledger exceeds 500 lines.
---

# /archive-ledger - Archive Old Ledger Sections

Archive old sections of the project ledger to keep it lean and context-efficient.

## When to Use

- When ledger exceeds 500 lines (warning)
- When ledger exceeds 800 lines (urgent)
- Weekly maintenance (if growing fast)
- Before long break (quarterly cleanup)
- When `/check-maintenance` recommends it

## What This Command Does

1. **Read current ledger** - Load full ledger file
2. **Identify archivable content** - Find old "Done" items and decisions
3. **Create archive file** - Move old content to dated archive
4. **Summarize in main ledger** - Keep high-level summaries
5. **Write lean ledger** - Update main ledger (<500 lines)
6. **Update timestamps** - Record archive date

## Execution Steps

### Step 1: Read Current Ledger

```bash
LEDGER=$(ls .claude/continuity/ledgers/CONTINUITY_*.md | head -1)
cat "$LEDGER"
```

### Step 2: Identify Archivable Sections

**"Done (Previous Sessions)" - Keep Recent Only**

```markdown
Current structure:
### Done (Previous Sessions)
- ✅ Week of 2025-10-15: 50 completed tasks [archive this]
- ✅ Week of 2025-10-22: 45 completed tasks [archive this]
- ✅ Week of 2025-11-05: 60 completed tasks [archive this]
- ✅ Week of 2025-12-10: 55 completed tasks [archive this]
- ✅ Week of 2026-01-09: 40 completed tasks [keep - recent]

Rule: Archive items older than 4 weeks (28 days)
```

**"Key Decisions" - Archive Old, Keep Active**

```markdown
Current structure:
## Key Decisions

### Authentication Strategy (Added 2025-09-12) [archive this]
...

### Database Optimization (Added 2025-11-20) [archive this]
...

### Journey Progress UI (Added 2026-01-10) [keep - recent]
...

Rule: Archive decisions older than 30 days
Exception: Keep if referenced in last 4 weeks of work
```

### Step 3: Determine Archive Filename

```bash
# Format: ledger-YYYY-QQ.md (quarterly archives)
CURRENT_DATE=$(date +%Y-%m-%d)
QUARTER=$(date +%Y-Q$(($(date +%-m)/3+1)))

ARCHIVE_FILE=".claude/continuity/archive/ledger-$QUARTER.md"
```

### Step 4: Create Archive File

Compose the archive from the structure below and write it to a **draft file** with the Write tool.
Step 6 moves the draft into place — nothing overwrites a real file before then.

```bash
ARCHIVE_DRAFT="${TMPDIR:-/tmp}/ctk-archive-draft.md"
# Write the composed archive (structure below) to "$ARCHIVE_DRAFT".
```

**Archive structure**:

```markdown
# Project Ledger Archive - {QUARTER}

> Archived from: .claude/continuity/ledgers/CONTINUITY_<project-name>.md
> Archive date: {CURRENT_DATE}
> Covers: {START_DATE} to {END_DATE}

## Archived Completed Work

### {OLDEST_MONTH}
- ✅ Task 1 details
- ✅ Task 2 details
[Full details from "Done (Previous Sessions)"]

### {NEXT_MONTH}
...

## Archived Key Decisions

### {DECISION_TITLE} (Original date: {DATE})
**Decision**: ...
**Reasoning**: ...
**Evidence**: ...
**References**: ...

[All archived decisions with full context]

## Statistics

- Total tasks archived: {COUNT}
- Total decisions archived: {COUNT}
- Date range: {START} to {END}
- Original ledger size: {OLD_LINES} lines
- Archived content: {ARCHIVED_LINES} lines
```

### Step 5: Create Summarized Ledger

Compose the lean ledger — the **whole** replacement file, not just the changed sections — and write
it to a draft with the Write tool. Same rule as Step 4: draft now, move in Step 6.

```bash
LEAN_DRAFT="${TMPDIR:-/tmp}/ctk-lean-ledger-draft.md"
# Write the composed lean ledger (sections below) to "$LEAN_DRAFT".
```

**New "Done (Previous Sessions)"**:

```markdown
### Done (Previous Sessions)

**Recent (Last 4 Weeks)**
- ✅ Week of 2026-01-09 to 2026-01-15:
  - Completed authentication backend
  - Built user profile frontend
  - Fixed 12 bugs
  - [Summary, not full details]

**Historical Summary**
- 2025 Q4 (Oct-Dec): See archive/ledger-2025-Q4.md
  - Major features: Authentication, User profiles, Dashboard
  - 250 tasks completed
  - 45 key decisions documented
```

**New "Key Decisions"**:

```markdown
## Key Decisions

### Active Decisions (Last 30 Days)
[Keep all recent decisions with full detail]

### Historical Decisions
See archive/ledger-{QUARTER}.md for decisions older than 30 days:
- Authentication strategy (2025-09-12)
- Database optimization (2025-11-20)
- [List titles only, link to archive]
```

### Step 6: Write Updated Files

Back up the live ledger **before** replacing it. This is the rollback point the Safety section
promises and the baseline Step 7 measures against, so it has to exist by the time either runs.

```bash
# Rollback point — must precede the overwrite below
cp "$LEDGER" "$LEDGER.backup"

# Move the drafts composed in Steps 4 and 5 into place
mkdir -p "$(dirname "$ARCHIVE_FILE")"
mv "$ARCHIVE_DRAFT" "$ARCHIVE_FILE"
mv "$LEAN_DRAFT"    "$LEDGER"

# Update metadata
# Add archive record to .claude/continuity/archive/README.md
```

> **Why drafts and not variables (issue #110).** Step 6 used to write `$ARCHIVE_CONTENT` and
> `$LEAN_LEDGER`, neither of which was ever assigned. The second one is the dangerous shape: its
> *destination* `$LEDGER` **is** bound, to the live `CONTINUITY_*.md`. Because these blocks are a
> spec a model reads rather than a script the shell runs, the cost is ambiguity — a reader has to
> invent the content — and literal lines from these blocks do propagate into commands a model
> composes. Drafts remove the invention: Steps 4 and 5 produce named files, Step 6 moves them.

### Step 7: Verify Results

```bash
# Check new sizes
OLD_SIZE=$(wc -l < "$LEDGER.backup")
NEW_SIZE=$(wc -l < "$LEDGER")
REDUCTION=$((OLD_SIZE - NEW_SIZE))
PERCENT=$((REDUCTION * 100 / OLD_SIZE))

echo "Ledger reduced: $OLD_SIZE → $NEW_SIZE lines ($PERCENT% reduction)"
```

## Output Format

```markdown
## Ledger Archive Complete

**Archive Created**
- File: `.claude/continuity/archive/ledger-2026-Q1.md`
- Date range: 2025-10-01 to 2025-12-31
- Content archived:
  - Completed work: 210 tasks
  - Key decisions: 38 decisions

**Ledger Updated**
- Original size: 813 lines
- New size: 387 lines
- Reduction: 426 lines (52%)

**What Was Archived**
- "Done (Previous Sessions)": Oct-Dec 2025 (3 months)
- "Key Decisions": Decisions older than 30 days

**What Remains in Main Ledger**
- Recent work: Last 4 weeks (detailed)
- Active decisions: Last 30 days (full context)
- Historical summaries: Quarterly links

**Context Impact**
- Before: ~3,252 tokens (ledger)
- After: ~1,548 tokens (ledger)
- Savings: ~1,704 tokens

**Next Steps**
- Archive file backed up at: `.claude/continuity/archive/ledger-2026-Q1.md`
- Main ledger optimized for current work
- Run `/check-maintenance` to verify system health
```

## Safety & Backup

**Before archiving**:
1. Step 6 creates the backup at `"$LEDGER.backup"` — one fixed name, so rollback and the Step 7
   baseline both resolve without guessing a date. Do not invent a second, differently-named copy.
2. Verify archive file written successfully
3. Verify main ledger still valid markdown

**Rollback if needed**:
```bash
# Restore from the backup Step 6 wrote
LEDGER=$(ls .claude/continuity/ledgers/CONTINUITY_*.md | head -1)
cp "$LEDGER.backup" "$LEDGER"
```

> The rollback path used to name `"${LEDGER}.backup.20260116"` — a hardcoded date that matched
> nothing any step produced, against a backup instruction that used a *third* spelling. Part of
> issue #110: a literal that looks runnable is worse than an obvious placeholder, because a reader
> copies it.

## Archive Retention Policy

| Archive Age | Action | Reason |
|-------------|--------|--------|
| **0-90 days** | Keep active in archive/ | Recent history, may need reference |
| **90-365 days** | Keep, add to .gitignore if large | Historical reference |
| **1-2 years** | Consider compressing to summary | Rarely accessed |
| **>2 years** | Archive to cold storage or delete | Unlikely to need |

## Integration with Other Commands

**Auto-suggestion**:
- `/save-state`: Warn if ledger >500 lines
- `/check-maintenance`: Show archive recommendation

**Pre-requisites**:
- Should run `/save-state` before archiving (capture current work)
- Consider `/create-handoff` if ending session

**Follow-up**:
- Run `/check-maintenance` after archiving to verify
- Update `.claude/continuity/archive/README.md` with archive log

## Edge Cases

**First archive (no existing archive file)**:
- Create new archive file
- Include all old content

**Multiple archives in same quarter**:
- Append to existing quarterly archive
- OR: Create dated archive (ledger-2026-01-16.md)

**Very large ledger (>2000 lines)**:
- May need multiple archive passes
- Archive in chunks by date range

**Referenced decisions**:
- If recent work references old decision, keep summary in main ledger
- Full detail in archive with link

## Example: Before and After

**Before (813 lines)**:
```markdown
## Current State
### Now
[...]

### Done (Recent - This Session)
[...]

### Done (Previous Sessions)
- ✅ 2025-10-15: [50 lines of detail]
- ✅ 2025-10-22: [45 lines of detail]
- ✅ 2025-11-05: [60 lines of detail]
- ✅ 2025-12-10: [55 lines of detail]
- ✅ 2026-01-09: [40 lines of detail]
[... 500 lines of old work ...]

## Key Decisions
### Decision 1 (2025-09-12)
[Full 50-line decision]
### Decision 2 (2025-11-20)
[Full 45-line decision]
[... 38 old decisions, 300 lines total ...]
```

**After (387 lines)**:
```markdown
## Current State
### Now
[...]

### Done (Recent - This Session)
[...]

### Done (Previous Sessions)
**Recent (Last 4 Weeks)**
- ✅ 2026-01-09 to 2026-01-15: Auth backend, profiles, 12 bugs fixed

**Historical Summary**
- 2025 Q4: See archive/ledger-2025-Q4.md (210 tasks, 38 decisions)

## Key Decisions

### Active Decisions (Last 30 Days)
[Recent decisions with full detail]

### Historical Decisions
See archive/ledger-2025-Q4.md for older decisions
```
