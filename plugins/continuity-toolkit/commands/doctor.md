---
description: Cross-plugin system diagnostics — check installed plugins, hook health, build status, and configuration
---

# /doctor - Plugin System Diagnostics

Comprehensive health check across all installed claude-forge. Shows what's installed, what's working, and what needs attention.

**Complements**: `/check-maintenance` (continuity files) and `/continuity-metrics` (session state). This command covers the **plugin system** itself.

## Execution Steps

### Step 1: Detect Installed Plugins

On CC v2.1.163+ the native listing is the fastest inventory — but treat it as a **claim, not a
verdict**. It renders from `installed_plugins.json`, so it prints `✔ enabled` even when the
plugin's files have been deleted. Always pair it with Step 1a.

```bash
claude plugin list --enabled || echo "native list unavailable (CC < 2.1.163)"
```

Fall back to scanning known plugin directories on older CC:

```bash
# Check marketplace cache for each plugin
PLUGINS=("ctk" "etk" "dtk" "atk" "ftk")

for PLUGIN in "${PLUGINS[@]}"; do
  # Check marketplace cache
  CACHE_DIR=$(find ~/.claude/plugins/cache -type d -name "$PLUGIN" | head -1)
  if [ -n "$CACHE_DIR" ]; then
    VERSION=$(grep -h '"version"' "$CACHE_DIR"/*/.claude-plugin/plugin.json | head -1)
    echo "INSTALLED: $PLUGIN ($VERSION)"
  else
    echo "NOT INSTALLED: $PLUGIN"
  fi
done
```

This glob matches **every** version folder ever installed, including stale ones left behind by
earlier upgrades — which is why Step 1a is mandatory before trusting the result.

Also check for local dev plugins via `--plugin-dir`:
```bash
# Check if running from monorepo (local dev) — source dirs use the legacy long names
if [ -f "plugins/continuity-toolkit/.claude-plugin/plugin.json" ]; then
  echo "LOCAL DEV MODE: Running from monorepo"
fi
```

### Step 1a: Verify Recorded Install Paths Resolve

The Step 1 glob matches any version folder, including stale ones; `installed_plugins.json` records
one specific `installPath` per plugin. A `DANGLING` row means the two disagree.

> **Why this check exists, how to interpret a `DANGLING` row, and how to repair it** live in the
> `doctor` skill's Step 1a (`skills/doctor/SKILL.md`) — the single source of truth. Read it before
> interpreting a `DANGLING` row; do not restate its reasoning here.

```bash
python3 -c "
import json,os
d=json.load(open(os.path.expanduser('~/.claude/plugins/installed_plugins.json')))
bad=0
for name,entries in sorted(d.get('plugins',{}).items()):
    for e in entries:
        p=e.get('installPath','')
        ok=os.path.isdir(p)
        bad+=0 if ok else 1
        print(('OK      ' if ok else 'DANGLING'), name, e.get('version'), p)
print('\nDANGLING:', bad)
"
```

A `DANGLING` row is an **INCONSISTENT RECORD**, not proof the plugin is unloaded — the two have been
observed apart. Confirm by content (are the plugin's skills and agents present, do its hooks fire),
then repair only if it is genuinely absent:

```bash
claude plugin marketplace update <marketplace-name>   # e.g. claude-forge
claude plugin install <plugin>@<marketplace-name>     # may report "already installed"
```

Then restart. See the skill's Step 1a for why neither command is credited as *the* fix, and why
skills reappearing is not evidence that hooks came back.

### Step 2: Check Hook Build Status

For each installed plugin, verify hooks are compiled:

```bash
for PLUGIN in $INSTALLED_PLUGINS; do
  DIST="$PLUGIN_ROOT/hooks/dist/bin/run-hook.js"
  if [ -f "$DIST" ]; then
    echo "$PLUGIN hooks: BUILT"
  else
    echo "$PLUGIN hooks: NOT BUILT (run: cd hooks && npm run build)"
  fi
done
```

### Step 3: Check Hook Configuration

Read hooks.json for each installed plugin and count registered hooks:

```bash
for PLUGIN in $INSTALLED_PLUGINS; do
  HOOKS_JSON="$PLUGIN_ROOT/hooks.json"
  if [ -f "$HOOKS_JSON" ]; then
    # Count hook events registered
    EVENT_COUNT=$(grep -c '"matcher"' "$HOOKS_JSON" 2>/dev/null || echo 0)
    echo "$PLUGIN: $EVENT_COUNT hook registrations"
  fi
done
```

Verify no duplicate hooks across plugins (ctk should own shared hooks exclusively).

### Step 4: Check Continuity System

```bash
# Is continuity set up?
if [ -d ".claude/continuity/ledgers" ]; then
  LEDGER=$(ls .claude/continuity/ledgers/CONTINUITY_*.md 2>/dev/null | head -1)
  if [ -n "$LEDGER" ]; then
    LINE_COUNT=$(wc -l < "$LEDGER")
    echo "Continuity: SETUP (ledger: $LINE_COUNT lines)"
  fi
else
  echo "Continuity: NOT SETUP (run /setup-continuity)"
fi

# Is context monitor configured?
if [ -f "$HOME/.config/claude/continuity-statusline.sh" ]; then
  echo "Context monitor: CONFIGURED"
else
  echo "Context monitor: NOT CONFIGURED (run /setup-context-monitor)"
fi

# Check shared-context.json
if [ -f ".claude/context/shared-context.json" ]; then
  CLEANLY_ENDED=$(grep "was_cleanly_ended" .claude/context/shared-context.json)
  echo "Last session: $CLEANLY_ENDED"
fi
```

### Step 5: Check Node.js Environment

```bash
# Node.js available?
node --version 2>/dev/null || echo "Node.js: NOT FOUND"

# npm available?
npm --version 2>/dev/null || echo "npm: NOT FOUND"
```

### Step 6: Check VCS CLI (for /review-mr)

```bash
# GitLab CLI
glab --version 2>/dev/null && echo "glab: AVAILABLE" || echo "glab: NOT INSTALLED"

# GitHub CLI
gh --version 2>/dev/null && echo "gh: AVAILABLE" || echo "gh: NOT INSTALLED"
```

### Step 7: Check Log Directory Health

```bash
# Check log sizes
for PLUGIN in $INSTALLED_PLUGINS; do
  LOG="$HOME/.claude/logs/$PLUGIN_SHORT_NAME/hooks.log"
  if [ -f "$LOG" ]; then
    SIZE=$(wc -c < "$LOG")
    echo "$PLUGIN log: $(($SIZE / 1024))KB"
  fi
done

# Check review history
REVIEW_LOG=$(find ~/.claude/logs -name "review-history.jsonl" 2>/dev/null | head -1)
if [ -n "$REVIEW_LOG" ]; then
  REVIEW_COUNT=$(wc -l < "$REVIEW_LOG")
  echo "Review history: $REVIEW_COUNT entries"
fi
```

## Output Format

Present results as a structured dashboard:

```markdown
## Plugin System Diagnostics

### Installed Plugins
| Plugin | Version | Install Path | Hooks Built | Hook Count | Status |
|--------|---------|--------------|-------------|------------|--------|
| ctk | 1.3.2 | resolves | Yes | 22 | OK |
| etk | 1.0.4 | resolves | Yes | 2 | OK |
| dtk | 1.0.9 | resolves | Yes | 2 | OK |
| atk | 1.0.2 | resolves | Yes | 1 | OK |
| ftk | 1.0.2 | **DANGLING** | Yes | 1 | **INCONSISTENT RECORD** — confirm load |

**Total**: 5/5 plugins installed, 28 hook registrations — ftk's recorded path is missing from disk;
verify whether its skills/agents/hooks are actually present before treating it as broken

### Continuity System
| Component | Status | Details |
|-----------|--------|---------|
| Ledger | OK | 245 lines (healthy <500) |
| Context Monitor | OK | StatusLine configured |
| shared-context.json | OK | 24KB (healthy <50KB) |
| Last session | OK | Ended cleanly |

### Environment
| Component | Status | Details |
|-----------|--------|---------|
| Node.js | OK | v22.x.x |
| npm | OK | v10.x.x |
| glab | OK | v1.x.x |
| gh | Not installed | Optional (for GitHub repos) |

### Hook Deduplication
| Shared Hook Owner | Status |
|-------------------|--------|
| ctk | OK — sole owner of 22 shared hooks |
| Other plugins | OK — only domain-specific hooks registered |

### Log Health
| Plugin | Log Size | Review History |
|--------|----------|----------------|
| continuity | 45KB | 23 entries |
| engineering | 12KB | — |
| frontend | 8KB | — |

### Recommendations
{Priority-ordered list of actions, or "All systems healthy — no action needed"}
```

## Recommendation Logic

Generate recommendations based on findings:

- **Dangling install path**: "{plugin} is recorded at {path}, which does not exist. That is an inconsistent record, not proof it is unloaded — confirm whether {plugin}'s skills, agents and hooks are actually present. If genuinely absent, repair with `claude plugin marketplace update {marketplace}` then `claude plugin install {plugin}@{marketplace}`, and restart. For ctk, genuine absence also means the shared security and permission hooks are gone."
- **Plugin not installed**: "Install {plugin} for {capability}: `claude plugin install ...`"
- **Hooks not built**: "Build hooks for {plugin}: `cd {path}/hooks && npm run build`"
- **Continuity not set up**: "Initialize continuity: `/setup-continuity`"
- **Context monitor not configured**: "Set up context warnings: `/setup-context-monitor`"
- **No VCS CLI**: "Install glab (GitLab) or gh (GitHub) for /review-mr"
- **Stale session detected**: "Previous session did not end cleanly. Run `/resume-session` to check state."
- **Large log files (>1MB)**: "Log rotation may be needed for {plugin}"
- **Suspected hook/plugin fault**: "Relaunch with `claude --safe-mode` (or `CLAUDE_CODE_SAFE_MODE`, CC v2.1.169+) to disable all plugins/hooks/skills — if the problem disappears, the fault is plugin-side; re-enable and use /doctor + the /plugin Errors tab to isolate."
- **All healthy**: "All systems healthy — no action needed"

## When to Use

- After installing or updating plugins
- When hooks seem to not be working
- When starting with the plugin system for the first time
- Periodic system check (monthly)
- When troubleshooting unexpected behavior

## Difference from Other Commands

| Command | Scope | Focus |
|---------|-------|-------|
| `/doctor` | **Cross-plugin system** | Plugin installation, hook builds, environment, VCS CLI |
| `/check-maintenance` | **Continuity files** | Ledger size, handoff count, archive status |
| `/continuity-metrics` | **Current session** | Dirty tracking, session heartbeat, hook activity |
