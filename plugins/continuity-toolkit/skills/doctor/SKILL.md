---
name: doctor
description: "Cross-plugin system diagnostics for the claude-forge ecosystem. Checks installed plugins, hook compilation, duplicate hook detection, continuity system health, environment (Node, npm, VCS CLI), and log sizes. Use when: plugins seem broken, hooks are not firing, skills or agents have gone missing, after installing or updating plugins, or for periodic health checks. Triggers on: doctor, diagnose plugins, plugin health, hooks not working, skills missing, plugin not loading, system check, plugin status, what is installed, troubleshoot plugins"
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
- Compares each plugin's recorded `installPath` against the disk — the cache glob and
  `claude plugin list` are both metadata-derived and report a plugin installed regardless
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

### Step 1a: Verify the Recorded Install Path Still Resolves

**The Step 1 glob and the recorded install path can disagree.** The glob matches *any* version
folder under the plugin's cache directory, including stale ones left by earlier installs, while
`~/.claude/plugins/installed_plugins.json` records one specific `installPath` per plugin. When that
recorded directory is missing, the record and the disk are inconsistent — surface it.

`claude plugin list` will not surface it: it renders from the same metadata, so it prints
`✔ enabled` regardless of what is on disk. Compare the record against the disk:

```bash
python3 -c "
import json,os
d=json.load(open(os.path.expanduser('~/.claude/plugins/installed_plugins.json')))
for name,entries in sorted(d.get('plugins',{}).items()):
    for e in entries:
        p=e.get('installPath','')
        print(('OK      ' if os.path.isdir(p) else 'DANGLING'), name, e.get('version'), p)
"
```

| Result | Meaning | Report |
|---|---|---|
| All entries `OK` | Record and disk agree | continue to Step 2 |
| Any `DANGLING` | Record and disk disagree — worth repairing, but **not** proof the plugin is unloaded | INCONSISTENT RECORD — confirm with the load check below |

**A `DANGLING` row is not a verdict.** Claude Code has been observed serving a plugin normally while
its recorded path pointed at a deleted directory — on 2026-07-28 ctk's record named a nonexistent
`ctk/2.10.2` while 43 hook invocations fired from an existing `ctk/2.10.0` and every ctk skill and
agent was present. Do not report BROKEN INSTALL from this row alone; it would contradict the
hook-build and hook-count rows, which in that state are correct.

Settle loaded-vs-not by content, which is the only check that distinguished the two cases:

- Are the plugin's skills and agents present in this session?
- Do its hooks actually fire? (For ctk, the decisive signal — it owns all shared hooks, so if ctk is
  genuinely unloaded then `security-blocker`, the auto-approve permission hooks, and every lifecycle
  hook are absent and the session runs with no guardrails.)

If the load check shows the plugin **is** absent, repair the install. Both of these have been seen
to change plugin state; neither has been isolated as *the* fix, so try them in order and re-check
between:

```bash
claude plugin marketplace update <marketplace-name>   # e.g. claude-forge
claude plugin install <plugin>@<marketplace-name>     # may report "already installed"
```

Hooks load only at session start, so restart after repairing — and note that skills can reappear
without a restart, so their return is **not** evidence that hooks came back.

> Observed 2026-07-29: a session started with zero claude-forge plugins loaded while
> `claude plugin list` reported all five `✔ enabled` and `/doctor`'s glob still matched stale
> version folders — two metadata-derived signals reporting green over a real outage. All five
> records were also dangling, and an in-use sweep had run 3 seconds after the prior `SessionEnd`;
> **neither was shown to be the cause.** ctk's record was already dangling during the prior session,
> when the plugin loaded and ran normally, so the dangling record cannot be the mechanism and the
> sweep did not create it. What broke that session is still unidentified.

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
| Contains `continuity-statusline.sh` | Necessary, not sufficient — go to the end-to-end check | see below |
| Unset / no `statusLine` key | **Dead** | NOT CONFIGURED — run `/ctk:setup-context-monitor` |
| Runs ctk with `CONTINUITY_STATUSLINE_SILENT=1` alongside another program | **Healthy** — this is the composed launcher | OK (composed) |
| Points at any other program | **Dead** | CONFLICT — name the program; see the resolution below |

A composed launcher is *not* a conflict: if the command pipes the payload through ctk with
`CONTINUITY_STATUSLINE_SILENT=1`, the side effect still runs and the warnings still fire even
though another program owns the display. Read the launcher's contents before classifying.

**The config string alone does not prove the warnings fire.** The statusline writes the
percentage file and the hook reads it, keyed by session id on both sides; if those keys ever
disagree the file is written under one name and sought under another, and the warnings stay
silent with a perfectly correct `statusLine`. That exact defect shipped through ctk 2.7.4 — the
writer keyed off `CLAUDE_SESSION_ID`, which Claude Code does not export into the statusline
child process, so every file was written as `-default.txt` while the hook looked for the real
session UUID. Verify the artifact, not the intent:

```bash
# Does a percentage file exist for THIS session? (needs the current session id)
node -e "const os=require('os'),fs=require('fs');console.log(fs.readdirSync(os.tmpdir()).filter(f=>f.startsWith('claude-context-pct-')))"
```

| Files found | Meaning |
|---|---|
| One matching the current session id | Pipeline verified end-to-end — report OK |
| Only `claude-context-pct-default.txt` | *May* indicate the pre-2.8.0 keying bug — but `default` is also the legitimate fallback when the payload carries no `session_id` and `CLAUDE_SESSION_ID` is unset. Confirm the installed ctk version before recommending an update |
| None | The statusline has not run yet this session; re-check after a turn or two before reporting a fault |

On CONFLICT, state the consequence plainly rather than just flagging a mismatch: *"`statusLine`
runs <program>, so ctk's 70/80/90% context warnings are not firing."* Then offer three
resolutions, composition first:

1. **Keep both** — rebuild the launcher to run ctk with `CONTINUITY_STATUSLINE_SILENT=1` and
   `<program>` for the display (`/ctk:setup-context-monitor` Step 1a). Usually the right answer.
2. Switch back to ctk alone with `/ctk:setup-context-monitor`.
3. Keep `<program>` alone and accept that the warnings are off.

Do not silently "fix" the user's `statusLine`; it is their configuration and they may have chosen
it deliberately.

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

### Installed Plugins (X/5)
| Plugin | Version | Install path | Hooks | Status |
|--------|---------|--------------|-------|--------|
| ctk | 1.3.2 | resolves | 22 built | OK |
| etk | 1.0.4 | resolves | 2 built | OK |
...

A plugin whose install path is `DANGLING` is reported as an inconsistent record and paired with the
load check — the other columns stay as measured, since a dangling path does not by itself mean the
plugin is unloaded.

### System Checks
| Check | Status |
|-------|--------|
| Install paths | All resolve / N DANGLING (record vs disk — confirm with the load check) |
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
