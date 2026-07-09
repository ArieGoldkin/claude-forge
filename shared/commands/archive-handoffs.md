---
description: Archive old handoff files to maintain a clean continuity directory. Use when handoffs accumulate.
---

# /archive-handoffs - Archive Old Handoff Files

Archive old handoff files to keep the handoffs directory clean and focused on recent sessions.

## When to Use

- When handoff count exceeds 20 files (warning)
- When handoff count exceeds 40 files (urgent)
- Monthly maintenance (end of month)
- When `/check-maintenance` recommends it
- Before long break (cleanup before vacation)

## What This Command Does

1. **List all handoffs** - Find all handoff files with dates
2. **Identify old handoffs** - Find files older than 30 days
3. **Create monthly archive** - Group by month in archive folder
4. **Move old handoffs** - Relocate to archive/handoffs-YYYY-MM/
5. **Verify recent handoffs** - Ensure latest 30 days remain active
6. **Update index** - Record what was archived

## Execution Steps

### Step 1: List All Handoff Files

```bash
HANDOFFS_DIR=".claude/continuity/handoffs"
find "$HANDOFFS_DIR" -type f \( -name "*.yaml" -o -name "*.md" \) | sort
```

**Expected filename formats** (current convention is `.yaml`; `.md` covers pre-v3.0 installs):
- `YYYY-MM-DD_topic-name.yaml`
- `handoff-YYYY-MM-DD.md` (legacy)
- `handoff-YYYY-MM-DD_topic.md` (legacy)

### Step 2: Determine Archive Cutoff Date

```bash
# Archive handoffs older than 30 days
CUTOFF_DATE=$(date -d '30 days ago' +%Y-%m-%d)

# For monthly archives, determine which months need archiving
CURRENT_MONTH=$(date +%Y-%m)
```

### Step 3: Identify Files to Archive

```bash
# Find handoffs older than cutoff
OLD_HANDOFFS=$(find "$HANDOFFS_DIR" -type f \( -name "*.yaml" -o -name "*.md" \) | while read file; do
    # Extract date from filename
    FILENAME=$(basename "$file")
    FILE_DATE=$(echo "$FILENAME" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)

    # Compare with cutoff
    if [[ "$FILE_DATE" < "$CUTOFF_DATE" ]]; then
        echo "$file"
    fi
done)
```

### Step 4: Group by Month

```bash
# Group files by month for organized archiving
# 2025-12-15_topic.md → archive/handoffs-2025-12/
# 2026-01-05_topic.md → archive/handoffs-2026-01/

for file in $OLD_HANDOFFS; do
    FILENAME=$(basename "$file")
    MONTH=$(echo "$FILENAME" | grep -oE '[0-9]{4}-[0-9]{2}' | head -1)

    ARCHIVE_MONTH_DIR=".claude/continuity/archive/handoffs-$MONTH"
    mkdir -p "$ARCHIVE_MONTH_DIR"

    mv "$file" "$ARCHIVE_MONTH_DIR/"
done
```

### Step 5: Create Archive Index

```bash
# Create or update archive/handoffs-YYYY-MM/README.md

ARCHIVE_INDEX="$ARCHIVE_MONTH_DIR/README.md"

cat > "$ARCHIVE_INDEX" <<EOF
# Handoff Archive - $MONTH

> Archived: $(date +%Y-%m-%d)
> Session handoffs from: $MONTH

## Handoffs in This Archive

$(ls -1 "$ARCHIVE_MONTH_DIR"/*.yaml "$ARCHIVE_MONTH_DIR"/*.md 2>/dev/null | grep -v README | while read f; do
    echo "- $(basename "$f")"
done)

## Total Files

- Count: $(ls -1 "$ARCHIVE_MONTH_DIR"/*.yaml "$ARCHIVE_MONTH_DIR"/*.md 2>/dev/null | grep -v README | wc -l)
- Date range: $(ls -1 "$ARCHIVE_MONTH_DIR"/*.yaml "$ARCHIVE_MONTH_DIR"/*.md 2>/dev/null | grep -v README | head -1 | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}') to $(ls -1 "$ARCHIVE_MONTH_DIR"/*.yaml "$ARCHIVE_MONTH_DIR"/*.md 2>/dev/null | grep -v README | tail -1 | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}')

## Access

These handoffs are archived for historical reference. To access:
\`\`\`bash
cat .claude/continuity/archive/handoffs-$MONTH/YYYY-MM-DD_topic.yaml
\`\`\`

## Retention

- Keep for 1 year from archive date
- After 1 year: Consider deleting if not referenced
EOF
```

### Step 6: Verify Active Handoffs

```bash
# Ensure recent handoffs remain
ACTIVE_COUNT=$(find "$HANDOFFS_DIR" -type f \( -name "*.yaml" -o -name "*.md" \) | wc -l)
ARCHIVED_COUNT=$(echo "$OLD_HANDOFFS" | wc -l)

echo "Active handoffs: $ACTIVE_COUNT (recent 30 days)"
echo "Archived handoffs: $ARCHIVED_COUNT"
```

### Step 7: Update Session-Start Hook (Optional)

**Check if hook needs updating**:
```bash
# Session-start hook should load only latest handoff
# Verify it doesn't try to load from archive
```

If hook tries to load from archive, it will slow down session start.

## Output Format

```markdown
## Handoff Archive Complete

**Handoffs Archived**
- Total archived: 32 files
- Date range: 2025-10-15 to 2025-12-31
- Archive locations:
  - `.claude/continuity/archive/handoffs-2025-10/` (8 files)
  - `.claude/continuity/archive/handoffs-2025-11/` (12 files)
  - `.claude/continuity/archive/handoffs-2025-12/` (12 files)

**Active Handoffs Remaining**
- Count: 15 files
- Date range: 2026-01-01 to 2026-01-16 (recent 30 days)
- Location: `.claude/continuity/handoffs/`

**Archive Structure Created**
.claude/continuity/archive/
├── handoffs-2025-10/
│   ├── README.md (index)
│   └── [8 handoff files]
├── handoffs-2025-11/
│   ├── README.md (index)
│   └── [12 handoff files]
└── handoffs-2025-12/
    ├── README.md (index)
    └── [12 handoff files]

**Context Impact**
- Before: 32 handoff files (session-start loads latest only)
- After: 15 handoff files (cleaner directory)
- Context unchanged: Only latest handoff loaded by session-start hook

**Benefits**
- ✅ Cleaner handoffs/ directory
- ✅ Organized monthly archives
- ✅ Easy to find specific old handoff if needed
- ✅ No impact on session-start performance (still loads latest only)

**Next Steps**
- Run `/check-maintenance` to verify system health
- Archive indexes created for easy reference
- Archived handoffs remain accessible in archive/
```

## Archive Organization

**Archive structure**:
```
.claude/continuity/archive/
├── handoffs-2025-10/
│   ├── README.md                    # Index of archived handoffs
│   ├── handoff-2025-10-15.md
│   ├── handoff-2025-10-22.md
│   └── ...
├── handoffs-2025-11/
│   ├── README.md
│   └── ...
└── handoffs-2025-12/
    ├── README.md
    └── ...
```

**Archive retention**:
| Age | Action | Location |
|-----|--------|----------|
| **0-30 days** | Active | `.claude/continuity/handoffs/` |
| **30-365 days** | Archived | `.claude/continuity/archive/handoffs-YYYY-MM/` |
| **1-2 years** | Optional delete | Cold storage or delete |
| **>2 years** | Delete | Unlikely to need |

## Integration with Other Commands

**Auto-suggestion**:
- `/create-handoff`: Warn if >30 handoff files
- `/check-maintenance`: Show archive recommendation

**Session-start hook**:
- Hook loads ONLY latest handoff (unaffected by archive)
- Archive doesn't slow down session start

**Manual access**:
```bash
# Find old handoff
grep -r "topic keyword" .claude/continuity/archive/handoffs-*/

# View specific old handoff
cat .claude/continuity/archive/handoffs-2025-10/handoff-2025-10-15.md
```

## Safety & Verification

**Before archiving**:
1. Verify files have proper date format in filename
2. Check no active work references old handoffs
3. Ensure archive directories created successfully

**After archiving**:
1. Verify active directory still has recent handoffs
2. Check archive README.md files created
3. Test session-start hook still works (loads latest)

**Rollback if needed**:
```bash
# Restore archived handoffs
mv .claude/continuity/archive/handoffs-2025-12/*.yaml \
   .claude/continuity/handoffs/          # (use *.md for legacy archives)
```

## Edge Cases

**Handoff without date in filename**:
- Warn: "Cannot determine date for: {filename}"
- Skip archiving (keep in active directory)
- Recommend renaming to proper format

**No handoffs older than 30 days**:
```
No handoffs older than 30 days found.
Active handoffs: 12 files (all recent)
No archive needed.
```

**Handoff referenced in current work**:
- Handoffs are historical; safe to archive
- Latest handoff always kept active
- Archived handoffs remain accessible if needed

**Multiple handoffs same day**:
```
handoff-2025-12-15_backend.md
handoff-2025-12-15_frontend.md
```
Both archived together in same month folder.

## Example: Before and After

**Before archiving**:
```
.claude/continuity/handoffs/
├── handoff-2025-10-15.md
├── handoff-2025-10-22.md
├── handoff-2025-11-05.md
├── handoff-2025-11-12.md
├── handoff-2025-11-20.md
├── handoff-2025-12-01.md
├── handoff-2025-12-10.md
├── handoff-2025-12-18.md
├── handoff-2025-12-22.md
├── handoff-2026-01-05.md
├── handoff-2026-01-09.md
├── handoff-2026-01-12.md
└── handoff-2026-01-16.md
(13 files, oldest 93 days old)
```

**After archiving** (30-day cutoff: 2025-12-17):
```
.claude/continuity/handoffs/
├── handoff-2025-12-18.md
├── handoff-2025-12-22.md
├── handoff-2026-01-05.md
├── handoff-2026-01-09.md
├── handoff-2026-01-12.md
└── handoff-2026-01-16.md
(6 files, all within 30 days)

.claude/continuity/archive/
├── handoffs-2025-10/
│   ├── README.md
│   ├── handoff-2025-10-15.md
│   └── handoff-2025-10-22.md
├── handoffs-2025-11/
│   ├── README.md
│   ├── handoff-2025-11-05.md
│   ├── handoff-2025-11-12.md
│   └── handoff-2025-11-20.md
└── handoffs-2025-12/
    ├── README.md
    ├── handoff-2025-12-01.md
    └── handoff-2025-12-10.md
```
