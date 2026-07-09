# Command Detailed Workflows

Complete reference for each continuity management command, including purpose, triggers, workflow steps, and expected output.

## Table of Contents

- [`/save-state`](#save-state)
- [`/create-handoff`](#create-handoff)
- [`/resume-session`](#resume-session)
- [`/check-maintenance`](#check-maintenance)
- [`/archive-ledger`](#archive-ledger)
- [`/archive-handoffs`](#archive-handoffs)
- [`/continuity-metrics`](#continuity-metrics)
- [`/setup-continuity`](#setup-continuity)
- [`/setup-context-monitor`](#setup-context-monitor)

---

## `/save-state`

**Purpose:** Update project ledger with current state using **append-until-handoff** model.

**When to use:**
- After completing 3-5 tasks
- After making architectural decisions
- Before context fills up
- At phase transitions (planning -> implementation -> QA)

**What it does:**
1. Read `shared-context.json` (extract recent decisions, tasks, patterns)
2. Read current ledger and count lines
3. **APPEND** new entry to Session Activity Log (timestamped)
4. **APPEND** new decisions to Key Decisions (preserve existing)
5. **REPLACE** Current State sections (snapshot)
6. **REPLACE** Open Questions (snapshot)
7. Write updated ledger with timestamp
8. **Check threshold**: If >500 lines, suggest `/create-handoff`

**Section behaviors:**
| Section | Behavior |
|---------|----------|
| Session Activity Log | APPEND (new entry at top with timestamp) |
| Key Decisions | APPEND (never remove, only add) |
| Current State | REPLACE (snapshot) |
| Open Questions | REPLACE (snapshot) |

**Evidence:** Ledger file updated with new timestamp + Session Activity Log entry

---

## `/create-handoff`

**Purpose:** Create session-end artifact for clean resumption **and clean the ledger**.

**When to use:**
- End of work day
- Before context switching to different feature
- After major milestone completion
- When taking multi-day break
- **When `/save-state` warns about ledger >500 lines**

**What it does:**
1. Gather session information (topic, duration, accomplishments)
2. Read `shared-context.json` and current ledger
3. Create handoff with:
   - What accomplished
   - **Session Activity Log (archived from ledger)**
   - What's next, Blockers, Key context, Session notes
4. Extract learnings to `extracted-patterns.md`
5. Write to `handoffs/YYYY-MM-DD_<topic>.yaml`
6. **CLEAN LEDGER**:
   - Archive Session Activity Log to handoff -> Clear in ledger
   - Archive Key Decisions >30 days to quarterly archive
   - Reset Current State to clean snapshot
   - Trim Done (Recent) to last 5 items

**Cleanup summary:**
| Content | Action | Destination |
|---------|--------|-------------|
| Session Activity Log | Archive + Clear | Handoff file |
| Key Decisions (>30 days) | Archive + Remove | `archive/ledger-YYYY-QQ.md` |
| Key Decisions (<30 days) | Keep | Ledger |
| Current State | Reset | Ledger |

**Evidence:** New handoff file created + Ledger cleaned (line count reduced)

---

## `/resume-session`

**Purpose:** Load context from previous session.

**When to use:**
- Starting new session (usually auto-loaded via hook)
- After multi-day break
- When switching between feature branches

**What it does:**
1. Find latest handoff in `handoffs/`
2. Read: handoff + ledger + `shared-context.json`
3. Synthesize summary: Last session, Current state, Recommended actions
4. Present context for Claude to continue work

**Evidence:** Context summary displayed with "where we left off"

**Note:** Usually happens automatically via SessionStart hook. Manual use is optional.

---

## `/check-maintenance`

**Purpose:** Check system health and get maintenance recommendations.

**When to use:**
- Weekly routine (recommended: Friday EOD)
- Before starting major new work
- When context loading feels slow
- After completing large features

**What it does:**
1. Count ledger lines (warn if >500, urgent if >800)
2. Count handoff files (warn if >20, urgent if >40)
3. Check shared-context.json size (warn if >50KB)
4. Provide actionable recommendations

**Output format:**
```
System Health Report:
- Ledger: [lines] [status emoji] [message]
- Handoffs: [count] [status emoji] [message]
- Shared context: [size] [status emoji] [message]
- Recommendation: [action needed or "system healthy"]
```

**Thresholds:** canonical values are defined once in the /check-maintenance command file (Notes → Health thresholds) — do not restate them here.

---

## `/archive-ledger`

**Purpose:** Archive old sections of the ledger to keep it lean (<500 lines).

**When to use:**
- When `/check-maintenance` warns ledger >500 lines
- Before long breaks (quarterly cleanup)
- When context loading becomes slow

**What it does:**
1. Read current ledger
2. Identify archivable content:
   - "Done (Previous Sessions)" items older than 4 weeks
   - "Key Decisions" older than 30 days
3. Create quarterly archive file: `archive/ledger-YYYY-QQ.md`
4. Update main ledger with summaries and archive links
5. Preserve recent work (last 4 weeks) in full detail

**Output format:**
```
Archive Complete:
- Archive created: archive/ledger-YYYY-QQ.md
- Date range: [start] to [end]
- Content archived: [N] tasks, [M] decisions
- Ledger reduced: [old] -> [new] lines ([%] reduction)
- Context savings: ~[N] tokens
```

**What stays in main ledger:**
- Recent work (last 4 weeks) - full detail
- Active decisions (last 30 days) - full context
- Historical summaries with links to archives

**Evidence:** Ledger file size reduced, archive file created

---

## `/archive-handoffs`

**Purpose:** Archive old handoff files to keep the handoffs directory lean (<20 files).

**When to use:**
- When `/check-maintenance` warns >20 handoff files
- Monthly maintenance routine
- When handoffs directory becomes cluttered

**What it does:**
1. Identify handoffs older than 30 days
2. Create monthly archive folders: `archive/handoffs-YYYY-MM/`
3. Move old handoffs to appropriate monthly folders
4. Keep recent 30 days of handoffs in main directory

**Output format:**
```
Handoffs Archived:
- [N] files archived
- Date range: [start] to [end]
- Archive locations:
  - archive/handoffs-YYYY-MM/ ([N] files)
  - archive/handoffs-YYYY-MM/ ([N] files)
- Active handoffs: [N] files (recent 30 days)
```

**Retention:**
- 0-30 days: Active in main directory
- >30 days: Archived in monthly folders
- All archives preserved for historical reference

**Evidence:** Handoffs directory has <20 files, archives created

---

## `/continuity-metrics`

See the Quick Reference table in the main SKILL.md for summary. This command displays a metrics dashboard with system recommendations. Refer to `/check-maintenance` thresholds for health status interpretation.

---

## `/setup-continuity`

See the Quick Reference table in the main SKILL.md for summary. This command runs a first-time initialization wizard to set up the continuity system directories, templates, and initial ledger.

---

## `/setup-context-monitor`

See the Quick Reference table in the main SKILL.md for summary. This command configures the StatusLine-based context percentage monitor with a stable launcher script and global settings.
