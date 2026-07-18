---
name: doctor
description: "Cross-plugin system diagnostics for the claude-forge ecosystem. Checks installed plugins, hook compilation, duplicate hook detection, continuity system health, environment (Node, npm, VCS CLI), and log sizes. Use when: plugins seem broken, hooks are not firing, after installing or updating plugins, or for periodic health checks. Triggers on: doctor, diagnose plugins, plugin health, hooks not working, system check, plugin status, what is installed, troubleshoot plugins"
effort: low
---

# /doctor

Cross-plugin system diagnostics for the claude-forge ecosystem. Checks what's installed, what's built, what's configured, and what needs attention.

## When to Use
- After installing or updating plugins
- When hooks seem to not be working
- First time using the plugin system
- Monthly system check
- Troubleshooting unexpected behavior

## What It Does
- Detects all installed claude-forge (marketplace cache + local dev)
- Verifies hook compilation status (dist/bin/run-hook.js exists)
- Counts hook registrations per plugin, checks for duplicates
- Verifies continuity system setup (ledger, context monitor, shared-context.json)
- Checks environment (Node.js, npm, glab/gh for VCS)
- Checks log directory health and sizes
- Generates prioritized recommendations

## Execution Steps

### Step 1: Detect Installed Plugins

Scan for all 6 possible plugins:

```
Plugins to check: ctk, etk, dtk, atk, ftk
Legacy names (still resolve via glob fallback for older installs):
                   continuity-toolkit, engineering-toolkit, devops-toolkit,
                   ai-toolkit, frontend-toolkit

For each short name, check:
1. ~/.claude/plugins/cache/*/[plugin-name]/ (marketplace install)
2. Current working directory plugins/[source-dir]/ (local dev / monorepo)
   — note: source dirs still use the legacy long names (e.g. plugins/continuity-toolkit/)

Extract version from .claude-plugin/plugin.json
```

### Step 2: Verify Hook Builds

For each installed plugin:
```
Check: [plugin-root]/hooks/dist/bin/run-hook.js exists?
  YES → hooks built, report OK
  NO  → hooks NOT built, recommend: cd hooks && npm run build
```

### Step 3: Count Hook Registrations

For each installed plugin, read hooks.json and count event registrations.
Verify ctk is sole owner of shared hooks (other plugins should only have domain-specific hooks).

Flag if duplicate shared hooks detected across multiple plugins.

### Step 4: Check Continuity System

```
Ledger:          .claude/continuity/ledgers/CONTINUITY_*.md exists?
Context monitor: see Step 4a — file existence alone is NOT the check
Shared context:  .claude/context/shared-context.json exists?
Last session:    was_cleanly_ended field value
```

### Step 4a: Verify the Context-Warning Pipeline Is Actually Wired

**The launcher existing does not mean context warnings work.** ctk's statusline script is the
only writer of the context-percentage temp file that the `context-monitor` hook reads to inject
the 70/80/90% warnings. If `statusLine` points at any *other* program — claude-hud, a custom
script, a different plugin — the launcher file still sits on disk untouched while the warnings
silently stop firing. Checking for the file alone reports a false healthy.

Read the configured command and compare it to ctk's launcher:

```bash
# The value that actually decides whether warnings fire
python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/.claude/settings.json')));print(json.dumps(d.get('statusLine','(unset)')))"
```

Classify the result:

| `statusLine.command` | Context warnings | Report |
|---|---|---|
| Contains `continuity-statusline.sh` | Firing | OK |
| Unset / no `statusLine` key | **Dead** | NOT CONFIGURED — run `/ctk:setup-context-monitor` |
| Points at any other program | **Dead** | CONFLICT — name the program; see the resolution below |

On CONFLICT, state the consequence plainly rather than just flagging a mismatch: *"`statusLine`
runs <program>, so ctk's 70/80/90% context warnings are not firing."* Then offer the two
resolutions — switch back with `/ctk:setup-context-monitor`, or keep the other statusline and
accept that the warnings are off. Do not silently "fix" the user's `statusLine`; it is their
configuration and they may have chosen it deliberately.

### Step 5: Check Environment

```
node --version    (required for hooks)
npm --version     (required for hook builds)
glab --version    (optional, for /review-mr with GitLab)
gh --version      (optional, for /review-mr with GitHub)
```

### Step 6: Check Log Health

```
For each plugin, check ~/.claude/logs/[short-name]/hooks.log size
Check review-history.jsonl entry count
Flag logs >1MB for rotation
```

### Step 7: Generate Report

Present structured dashboard with:
- Installed plugins table (name, version, hooks built, hook count, status)
- Continuity system status
- Environment status
- Hook deduplication check
- Log health
- Prioritized recommendations

## Output Format

```markdown
## Plugin System Diagnostics

### Installed Plugins (X/6)
| Plugin | Version | Hooks | Status |
|--------|---------|-------|--------|
| ctk | 1.3.2 | 22 built | OK |
| etk | 1.0.4 | 2 built | OK |
...

### System Checks
| Check | Status |
|-------|--------|
| Continuity setup | OK |
| Context monitor | OK / NOT CONFIGURED / CONFLICT (statusLine runs <program>) |
| Last session | Clean / Stale |
| Node.js | vXX.x |
| VCS CLI | glab / gh / none |

### Recommendations
[Priority list or "All systems healthy"]
```

## Difference from Other Diagnostics

| Command | What it checks |
|---------|----------------|
| `/doctor` | Plugin installation, hook builds, environment, cross-plugin health |
| `/check-maintenance` | Continuity file sizes (ledger, handoffs, archives) |
| `/continuity-metrics` | Current session state (dirty tracking, heartbeat) |

## Related
- `/check-maintenance` for continuity file health
- `/continuity-metrics` for session state
- `/setup-continuity` to initialize continuity system
- `/setup-context-monitor` to configure context warnings
