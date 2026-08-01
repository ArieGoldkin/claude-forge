---
description: Display review history statistics from the review-logger hook
---

# Review Stats

Read and display statistics from the review history log.

## Step 1: Read Log File

```bash
# Live hooks write to $CLAUDE_PLUGIN_DATA/logs/ -- in practice
# ~/.claude/plugins/data/<plugin-id>/logs/. The legacy ~/.claude/logs/<name>/
# tree is written only when CLAUDE_PLUGIN_DATA is UNSET: pre-CLAUDE_PLUGIN_DATA
# installs, and the test suite.
#
# Searching only the legacy tree was issue #106: the two trees are disjoint, so
# this command reported 1026 test fixtures and zero real reviews, and read as a
# working feature. Search BOTH.
#
# ~/.claude/logs/plugin/ is excluded BY CONSTRUCTION, not by guesswork: every
# production run-hook-wrapper.sh exports a real CLAUDE_PLUGIN_NAME
# (continuity|devops|ai|frontend|engineering), and 'plugin' is the fallback used
# only when that variable is unset -- i.e. the test suite. Nothing that ever
# reached a user writes there. (Do NOT filter by session_id instead: fixtures
# use many ids -- abc, s1, test, a5f8a1c4 -- so an id blocklist is a guess.)
# Residual test rows in the OTHER legacy dirs are issue #105's to fix at source.
# CLAUDE_CONFIG_DIR relocates the whole .claude tree, and since #105 the log
# fallback honors it — so a user who sets it has BOTH their plugin-data and
# their legacy logs under $CLAUDE_CONFIG_DIR, not under $HOME.
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SEARCH_ROOTS=""
for root in "$CLAUDE_PLUGIN_DATA" "$CFG/plugins/data" "$CFG/logs" \
            "$HOME/.claude/plugins/data" "$HOME/.claude/logs"; do
  [ -n "$root" ] && [ -d "$root" ] && SEARCH_ROOTS="$SEARCH_ROOTS $root"
done

# Roots are existence-checked above, so find needs no error suppression here --
# a failure now is a real failure and should be visible, not swallowed.
# The exclusion is anchored on `/logs/plugin/`, NOT on `/.claude/logs/plugin/`.
# Anchoring it to `.claude` was correct only while the tree lived under $HOME;
# a relocated CLAUDE_CONFIG_DIR puts the fixtures at $CFG/logs/plugin/, which a
# `.claude`-anchored filter silently misses — reintroducing the 1026 fabricated
# rows this command exists to keep out. The roots and the filter are coupled:
# widen one, widen the other.
REVIEW_LOGS=$(find $SEARCH_ROOTS -name "review-history.jsonl" \
  | grep -v "/logs/plugin/" | sort -u)

if [ -z "$REVIEW_LOGS" ]; then
  echo "No review history found."
  echo "Searched:$SEARCH_ROOTS"
  echo "Run /review-mr, then /etk:post-mr-comments, to generate review data."
  exit 0
fi

# Name the sources. The failure mode #106 replaced was a plausible number from
# an unnamed directory -- printing what was read makes that self-diagnosing.
echo "Sources read:"
for f in $REVIEW_LOGS; do
  printf '  %6s rows  %s\n' "$(wc -l < "$f" | tr -d ' ')" "$f"
done
echo

# Merge all log files into a temp file for analysis
REVIEW_LOG=$(mktemp)
cat $REVIEW_LOGS > "$REVIEW_LOG"
trap "rm -f $REVIEW_LOG" EXIT
```

## Step 2: Compute Basic Stats

```bash
# Total reviews
TOTAL=$(wc -l < "$REVIEW_LOG" | tr -d ' ')

# Reviews by type
APPROVALS=$(grep -c '"command_type":"approve"' "$REVIEW_LOG" || echo 0)
NOTES=$(grep -c '"command_type":"note"' "$REVIEW_LOG" || echo 0)
# "discussion" is the type emitted when /etk:post-mr-comments posts inline-anchored
# comments via the GitLab discussions API (ctk review-logger 2.6.2+). This is the
# real posting path, so it is typically the dominant count.
DISCUSSIONS=$(grep -c '"command_type":"discussion"' "$REVIEW_LOG" || echo 0)

# Recent activity (last 7 and 30 days)
WEEK_AGO=$(date -v-7d +%Y-%m-%d 2>/dev/null || date -d '7 days ago' +%Y-%m-%d)
MONTH_AGO=$(date -v-30d +%Y-%m-%d 2>/dev/null || date -d '30 days ago' +%Y-%m-%d)

LAST_7=$(awk -v d="$WEEK_AGO" '$0 ~ "\"timestamp\":\"" && substr($0, index($0,"\"timestamp\":\"")+14, 10) >= d' "$REVIEW_LOG" | wc -l | tr -d ' ')
LAST_30=$(awk -v d="$MONTH_AGO" '$0 ~ "\"timestamp\":\"" && substr($0, index($0,"\"timestamp\":\"")+14, 10) >= d' "$REVIEW_LOG" | wc -l | tr -d ' ')
```

## Step 3: Compute Advanced Stats (if jq available)

```bash
if command -v jq &>/dev/null; then
  UNIQUE_MRS=$(jq -r '.mr_number' "$REVIEW_LOG" | sort -u | wc -l | tr -d ' ')
  TOP_MRS=$(jq -r '.mr_number' "$REVIEW_LOG" | sort | uniq -c | sort -rn | head -5)
  RECENT=$(jq -r '[.timestamp[:10], "!", .mr_number, .command_type] | join(" ")' "$REVIEW_LOG" | tail -10 | tac)
fi
```

## Step 4: Output Report

```markdown
# Review History Stats

| Metric | Value |
|--------|-------|
| Total Reviews | $TOTAL |
| Inline Comments (discussions) | $DISCUSSIONS |
| Approvals | $APPROVALS |
| Review Comments (notes) | $NOTES |
| Unique MRs | $UNIQUE_MRS |
| Last 7 Days | $LAST_7 |
| Last 30 Days | $LAST_30 |

## Recent Reviews (Last 10)

| Date | MR | Action |
|------|----|--------|
[for each entry in $RECENT:]
| $date | !$mr_number | $command_type |

## Most Reviewed MRs

[for each in $TOP_MRS:]
| !$mr_number | $count reviews |

---
Sources: listed above (live: `~/.claude/plugins/data/*/logs/`; legacy: `~/.claude/logs/*/`, excluding `logs/plugin/`)
```
