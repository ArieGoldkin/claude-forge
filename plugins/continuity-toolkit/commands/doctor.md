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

### Step 1b: Verify ctk Hooks Are Actually Firing (#82)

Steps 1 and 1a inspect files and records; this is the only step that observes hooks **running**.
Both reported healthy through a session where ctk's hooks fired zero times, leaving it with no
security or permission hooks.

**Run the skill's snippet, not a shortened one.** Marker absence is a fault only when the session
id is trustworthy *and* the installed ctk is new enough to stamp. This is the only detection surface
in 2.14.0 — the passive statusline warning was cut before release.

> **Single source of truth**: the three-condition snippet, the VERDICT table, the capture-before-repair
> evidence list, and why an ABSENT marker is frequently *inconclusive rather than a fault* live in the
> `doctor` skill's Step 1b (`skills/doctor/SKILL.md`). Read and run it from there — `ABSENT` alone is
> not a failure, and an earlier revision of this check reported FAIL on a healthy install by
> inferring capability from a side effect any process could produce.

### Step 2: Build the Per-Plugin Inventory, Then Check Hook Builds

Steps 2, 3 and 7 are per-plugin checks, and each needs the plugin's **install path** — which is
not derivable from its name. Build one inventory that carries both.

> **Why this exists (#109).** These three steps used to loop over `$INSTALLED_PLUGINS` while
> checking a path built from `$PLUGIN_ROOT` / `$PLUGIN_SHORT_NAME`. All three variables were
> unassigned, present since the initial commit.
>
> **⚠ CORRECTED 2026-08-01 (ctk 2.17.4).** This note first said the loops "iterated an empty list
> and printed nothing — a loop over an empty list exits 0, which is indistinguishable from
> 'checked, nothing to report.'" **That described literal execution, which does not happen.** A
> command body is delivered to the model as `role=user` **prompt text**; Claude Code never runs the
> fenced bash. Measured across 26 unwitnessed sessions: every one composed its *own* command rather
> than running the block, and one even added a flag the source lacked. The real defect was that
> these steps were an **ambiguous spec** — a reader had to invent both the plugin list and the
> install path before it could act on them — and literal text from a block *does* propagate into the
> commands a model composes (3 of 26 sessions), so a wrong literal is not inert. Evidence:
> `docs/reviews/2026-08-01_command-md-execution-mode.md`.
>
> ⚠ Note what the minimal-looking repair would have done: because
> the path variables never varied with the loop variable, assigning `INSTALLED_PLUGINS` alone
> would have checked **one** path N times and labelled the single result with N different plugin
> names — a confident wrong answer in place of a silent one. The name and the path must travel
> together, which is what the inventory is for.

```bash
# Written to a file, not a shell variable: Steps 3 and 7 may run in separate shells.
INVENTORY="${TMPDIR:-/tmp}/claude-doctor-inventory.tsv"
python3 -c "
import json,os
d=json.load(open(os.path.expanduser('~/.claude/plugins/installed_plugins.json')))
for key,entries in sorted(d.get('plugins',{}).items()):
    name,_,market=key.partition('@')   # 'ctk@claude-forge' -> ctk, claude-forge
    for e in entries:
        print(name, market, e.get('version',''), e.get('installPath',''), sep='\t')
" > "$INVENTORY"

COUNT=$(wc -l < "$INVENTORY" | tr -d ' ')
if [ "$COUNT" -eq 0 ]; then
  echo "INVENTORY: EMPTY — Steps 2, 3 and 7 CANNOT RUN. Report this as a FAILED CHECK, never as 'all healthy'."
else
  echo "INVENTORY: $COUNT plugin record(s)"
fi
```

Then verify hooks are compiled. **A missing `dist/` is only a fault for plugins that compile their
hooks.** The inventory covers every installed plugin, including third-party ones: some ship no
hooks at all, and others (e.g. Vercel's) ship executable `.mjs` hooks with no build step. Both
would be reported NOT BUILT by a bare `dist/` check — a false fault against a healthy plugin.
`hooks/package.json` is the discriminator for our compiled architecture:

```bash
while IFS=$'\t' read -r PLUGIN MARKET VERSION PLUGIN_ROOT; do
  if [ ! -d "$PLUGIN_ROOT/hooks" ]; then
    echo "$PLUGIN hooks: n/a (no hooks directory — skills/commands only)"
  elif [ ! -f "$PLUGIN_ROOT/hooks/package.json" ]; then
    echo "$PLUGIN hooks: n/a (script-based hooks, no build step)"
  elif [ -f "$PLUGIN_ROOT/hooks/dist/bin/run-hook.js" ]; then
    echo "$PLUGIN hooks: BUILT"
  else
    echo "$PLUGIN hooks: NOT BUILT (run: cd '$PLUGIN_ROOT/hooks' && npm run build)"
  fi
done < "$INVENTORY"
```

### Step 3: Check Hook Configuration

Read hooks.json for each installed plugin and count registered hooks:

⚠ **Do not count `"matcher"` occurrences.** `matcher` is an *optional* key — it appears only on
tool-matching events. A `SessionStart` group carries none, so a `grep -c '"matcher"'` reports
**0 registrations for a plugin that has real hooks**: measured 0 for dtk, atk, ftk and etk, each
of which does register hooks. Parse the manifest and count handler entries instead.

⚠ **`grep -c` also can't be totalled with `|| echo 0`.** On no match it prints `0` *and* exits 1,
so the fallback appends a second `0` and the value becomes the two-line string `0\n0`. Both traps
were dormant in this step for as long as the loop never ran.

```bash
INVENTORY="${TMPDIR:-/tmp}/claude-doctor-inventory.tsv"
[ -s "$INVENTORY" ] || echo "INVENTORY MISSING — run Step 2 first. Do NOT report Step 3 as healthy."

while IFS=$'\t' read -r PLUGIN MARKET VERSION PLUGIN_ROOT; do
  # NOTE: hooks/hooks.json, not hooks.json. The manifest sits inside the hooks
  # directory; the old path was wrong independently of the unassigned variable.
  HOOKS_JSON="$PLUGIN_ROOT/hooks/hooks.json"
  if [ -f "$HOOKS_JSON" ]; then
    python3 -c "
import json,sys
name, path = sys.argv[1], sys.argv[2]
h = json.load(open(path)).get('hooks', {})
handlers = sum(len(g.get('hooks', [])) for groups in h.values() for g in groups)
print(f'{name}: {handlers} hook handler(s) across {len(h)} event(s)')
" "$PLUGIN" "$HOOKS_JSON"
  else
    echo "$PLUGIN: no hooks.json (skills/commands only)"
  fi
done < "$INVENTORY"
```

A plugin may wire one hook onto several events, so the handler count is expected to meet or exceed
its `registerHook()` count (ctk: 50 handlers, 34 registered). A count *below* the registry is the
signal worth chasing.

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

Per-plugin hook logs live under **two different naming schemes**, which is why one variable could
never serve both: the live tier is keyed by `<plugin>-<marketplace>` (`ctk-claude-forge`), the
legacy tier by `CLAUDE_PLUGIN_NAME` (`continuity`). The tier rule itself is stated once, in ctk's
CLAUDE.md → "Log locations" — read it there rather than inferring it from this snippet.

```bash
INVENTORY="${TMPDIR:-/tmp}/claude-doctor-inventory.tsv"
[ -s "$INVENTORY" ] || echo "INVENTORY MISSING — run Step 2 first. Do NOT report Step 7 as healthy."
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

while IFS=$'\t' read -r PLUGIN MARKET VERSION PLUGIN_ROOT; do
  LIVE="$CFG/plugins/data/$PLUGIN-$MARKET/logs/hooks.log"
  # The legacy dir is keyed by CLAUDE_PLUGIN_NAME, which differs from the install
  # name (ctk -> continuity). Read it from the installed wrapper instead of
  # hardcoding a map here — this is what the old $PLUGIN_SHORT_NAME reached for.
  SHORT=$(grep -o 'CLAUDE_PLUGIN_NAME="[^"]*"' \
          "$PLUGIN_ROOT/hooks/bin/run-hook-wrapper.sh" 2>/dev/null | cut -d'"' -f2)

  if [ -f "$LIVE" ]; then
    KB=$(( $(wc -c < "$LIVE") / 1024 ))
    [ "$KB" -gt 1024 ] && echo "$PLUGIN log: ${KB}KB (live) — >1MB, consider rotation" \
                       || echo "$PLUGIN log: ${KB}KB (live)"
  elif [ -n "$SHORT" ] && [ -f "$CFG/logs/$SHORT/hooks.log" ]; then
    KB=$(( $(wc -c < "$CFG/logs/$SHORT/hooks.log") / 1024 ))
    echo "$PLUGIN log: ${KB}KB (LEGACY tree — history, not live-hook output)"
  else
    echo "$PLUGIN log: — (no hook log; normal for a plugin whose hooks have not fired)"
  fi
done < "$INVENTORY"

# Check review history.
# Live hooks write under $CLAUDE_PLUGIN_DATA/logs/; the fallback honors
# CLAUDE_CONFIG_DIR since #105. Searching ~/.claude/logs alone found only the
# legacy tree — which on a machine with test residue holds nothing but fixtures
# (#106). Skip the `plugin/` fixture dir: `plugin` is the log-dir name only when
# CLAUDE_PLUGIN_NAME is unset, i.e. the test suite, never a real install.
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
REVIEW_ROOTS=""
for root in "$CLAUDE_PLUGIN_DATA" "$CFG/plugins/data" "$CFG/logs" \
            "$HOME/.claude/plugins/data" "$HOME/.claude/logs"; do
  [ -n "$root" ] && [ -d "$root" ] && REVIEW_ROOTS="$REVIEW_ROOTS $root"
done
REVIEW_LOG=$(find $REVIEW_ROOTS -name "review-history.jsonl" | grep -v "/logs/plugin/" | head -1)
if [ -n "$REVIEW_LOG" ]; then
  REVIEW_COUNT=$(wc -l < "$REVIEW_LOG")
  echo "Review history: $REVIEW_COUNT entries ($REVIEW_LOG)"
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
Rows are labelled by **install name** (`ctk`), which is what the inventory carries — not by
`CLAUDE_PLUGIN_NAME` (`continuity`). A `—` is the normal result for a plugin whose hooks have not
fired; it is not a fault. `LEGACY` means the live tree holds nothing for that plugin, so the figure
is history rather than current activity.

| Plugin | Log Size | Tier | Review History |
|--------|----------|------|----------------|
| ctk | 127KB | live | 23 entries |
| dtk | 163KB | LEGACY | — |
| atk | — | — | — |

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
