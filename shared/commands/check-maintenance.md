---
description: Check continuity system health and file integrity. Use for periodic maintenance checks.
---

# /check-maintenance - Check Continuity System Health

Check the health of the continuity system and identify maintenance needs.

## When to Use

- Weekly (every Friday or end of week)
- When experiencing slow context loading
- Before long breaks (end of month, vacation)
- When Claude suggests maintenance

## What This Command Does

Checks the size and health of:
1. **Ledger** - Project state document
2. **Handoffs** - Session transition documents
3. **Shared Context** - Agent coordination state
4. **Archive Status** - Last archiving activity

Provides:
- Current metrics
- Health status (✅ OK / ⚠️ Warning / 🔴 Action needed)
- Specific recommendations

## Execution Steps

### Step 1: Check Ledger Size

```bash
# Count lines in ledger
LEDGER=$(ls .claude/continuity/ledgers/CONTINUITY_*.md | head -1)
LINE_COUNT=$(wc -l < "$LEDGER")

Status:
- ✅ < 500 lines: Healthy
- ⚠️ 500-800 lines: Warning (consider archiving)
- 🔴 > 800 lines: Action needed (archive soon)
```

### Step 2: Check Handoff Count

```bash
# Count handoff files (current convention is .yaml; .md covers pre-v3.0 installs)
HANDOFFS_DIR=".claude/continuity/handoffs"
HANDOFF_COUNT=$(find "$HANDOFFS_DIR" -type f \( -name "*.yaml" -o -name "*.md" \) | wc -l)

Status:
- ✅ < 20 files: Healthy
- ⚠️ 20-40 files: Warning (consider archiving)
- 🔴 > 40 files: Action needed (archive old handoffs)
```

### Step 3: Check Shared Context Size

```bash
# Check shared context file size
SHARED_CONTEXT=".claude/context/shared-context.json"
FILE_SIZE=$(wc -c < "$SHARED_CONTEXT")

Status:
- ✅ < 50KB: Healthy
- ⚠️ 50-100KB: Warning (growing)
- 🔴 > 100KB: Action needed (archive old decisions)
```

### Step 4: Check Archive History

```bash
# Find most recent archive
ARCHIVE_DIR=".claude/continuity/archive"
LAST_ARCHIVE=$(find "$ARCHIVE_DIR" -type f -name "ledger-*.md" -o -name "handoffs-*" |
               xargs ls -t 2>/dev/null | head -1)

Status:
- ✅ < 30 days ago: Recent
- ⚠️ 30-60 days ago: Warning
- 🔴 > 60 days ago or never: Overdue
```

### Step 5: Calculate Context Impact

```bash
# Estimate context consumption
# Ledger: ~4 tokens per line
# Handoff: ~2000 tokens average
# Shared context: ~5 tokens per KB

LEDGER_TOKENS=$((LINE_COUNT * 4))
HANDOFF_TOKENS=$((HANDOFF_COUNT * 2000))
SHARED_TOKENS=$((FILE_SIZE / 1024 * 5))
TOTAL_TOKENS=$((LEDGER_TOKENS + HANDOFF_TOKENS + SHARED_TOKENS))

Context percentage: TOTAL_TOKENS / 200000 * 100
```

## Output Format

```markdown
## Continuity System Health Check

**Ledger Status**
- Size: {LINE_COUNT} lines
- Status: {✅/⚠️/🔴}
- Context impact: ~{LEDGER_TOKENS} tokens
- Recommendation: {action if needed}

**Handoff Status**
- Count: {HANDOFF_COUNT} files
- Oldest: {OLDEST_DATE}
- Status: {✅/⚠️/🔴}
- Context impact: ~{HANDOFF_TOKENS} tokens (latest only)
- Recommendation: {action if needed}

**Shared Context Status**
- Size: {FILE_SIZE_KB} KB
- Agent decisions: {DECISION_COUNT}
- Status: {✅/⚠️/🔴}
- Recommendation: {action if needed}

**Archive Status**
- Last archive: {DATE} ({DAYS_AGO} days ago)
- Status: {✅/⚠️/🔴}

**Overall Context Consumption**
- Estimated usage: {TOTAL_TOKENS} tokens ({PERCENTAGE}%)
- Target: Keep under 30% (60,000 tokens)

**Recommended Actions**
{Priority list of maintenance commands to run}
```

## Example Scenarios

### Scenario 1: Healthy System
```
## Continuity System Health Check

**Ledger Status**
- Size: 342 lines
- Status: ✅ Healthy
- Context impact: ~1,368 tokens
- Recommendation: None

**Handoff Status**
- Count: 12 files
- Oldest: 2026-01-02 (14 days ago)
- Status: ✅ Healthy
- Context impact: ~2,000 tokens (latest only)
- Recommendation: None

**Shared Context Status**
- Size: 28 KB
- Status: ✅ Healthy
- Recommendation: None

**Archive Status**
- Last archive: 2026-01-10 (6 days ago)
- Status: ✅ Recent

**Overall Context Consumption**
- Estimated usage: 3,368 tokens (1.7%)
- Target: Keep under 30% (60,000 tokens) ✅

**Recommended Actions**
None - system is healthy
```

### Scenario 2: Maintenance Needed
```
## Continuity System Health Check

**Ledger Status**
- Size: 813 lines
- Status: 🔴 Action needed
- Context impact: ~3,252 tokens
- Recommendation: Run /archive-ledger to reduce to <500 lines

**Handoff Status**
- Count: 47 files
- Oldest: 2025-11-12 (65 days ago)
- Status: 🔴 Action needed
- Context impact: ~2,000 tokens (latest only)
- Recommendation: Run /archive-handoffs to keep recent 30 days

**Shared Context Status**
- Size: 127 KB
- Agent decisions: 342
- Status: 🔴 Action needed
- Recommendation: Manually prune old agent decisions from shared-context.json (no dedicated archive command exists)

**Archive Status**
- Last archive: 2025-11-20 (57 days ago)
- Status: 🔴 Overdue

**Overall Context Consumption**
- Estimated usage: 5,887 tokens (2.9%)
- After archiving: ~1,500 tokens (0.75%)
- Target: Keep under 30% (60,000 tokens) ✅

**Recommended Actions (Priority Order)**
1. 🔴 /archive-ledger (reduce 813 → ~400 lines)
2. 🔴 /archive-handoffs (reduce 47 → ~15 files)
3. 🟡 Manually prune shared-context.json (no dedicated command; keep current-session fields)
```

## Maintenance Schedule Recommendations

| Frequency | Command | Trigger |
|-----------|---------|---------|
| **Weekly** | `/check-maintenance` | Every Friday |
| **As Needed** | `/archive-ledger` | When ledger >500 lines |
| **Monthly** | `/archive-handoffs` | When handoffs >30 files |
| **Quarterly** | Manual shared-context.json prune | When >100KB or >90 days |

## Integration with Other Commands

**Proactive suggestions**: Other commands should suggest `/check-maintenance` when:
- `/save-state`: Detects ledger growing beyond 500 lines
- `/create-handoff`: Detects >30 handoff files
- `/resume-session`: Slow loading (large context files)

**Auto-run**: Consider running automatically:
- Weekly via cron job
- Before `/create-handoff` (pre-flight check)
- On session start if >30 days since last check

## Notes

**Context token estimates**:
- Ledger: ~4 tokens per line (includes formatting)
- Handoff: ~2000 tokens average (only latest loaded)
- Shared context: ~5 tokens per KB

**Health thresholds** (CANONICAL — other skill/reference files point here; change values in this block and Steps 1-4 only):
- Ledger: 500 lines (warn), 800 lines (limit)
- Handoffs: 20 files (warn), 40 files (limit)
- Shared context: 50KB (warn), 100KB (limit)
- Archive recency: 30 days (warn), 60 days (overdue)

**False positives**: Large projects may naturally have higher numbers. Adjust thresholds in project CLAUDE.md if needed.
