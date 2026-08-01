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
- **Observes whether ctk hooks actually fired this session** (#82) — the only check here that
  watches hooks *run* rather than inspecting files and records, both of which reported healthy
  through a session with zero hook invocations
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

### Step 1b: Verify ctk Hooks Are Actually Firing (#82)

**This is the only check in this skill that observes hooks running.** Everything above it —
the Step 1 glob, the Step 1a install-path comparison, `claude plugin list` — describes *files
and records*. On 2026-07-29 all of those reported healthy while ctk's hooks fired **zero**
times for a whole session, so the session ran with no `security-blocker`, no permission hooks
and no continuity lifecycle, and nothing announced it. Step 1a would not reliably have caught
it: the same record/disk inconsistency was present during the *previous*, fully working
session.

Hooks stamp a marker on SessionStart and on every user prompt. **This check is the
only detection surface in 2.14.0** — a passive statusline warning was built and then
cut before release, because every serious defect two review rounds found lived in it
(chiefly: it asked whether a stamping-capable ctk was *installed* when the question
is whether the *loaded* hooks stamp, so upgrading ctk mid-session would have alarmed
a healthy one).

Absence is only meaningful under three conditions, all evaluated below. Do not
shorten this to "marker missing ⇒ broken":

```bash
# The Bash tool exports CLAUDE_CODE_SESSION_ID (note the _CODE_); hooks key the
# marker by the session id in their payload, which is the same UUID.
node -e "
const os=require('os'),fs=require('fs'),p=require('path');
const sid=process.env.CLAUDE_CODE_SESSION_ID||process.env.CLAUDE_SESSION_ID||'default';
// 'default' and 'unknown' are the two fallback constants the writer and reader
// layers substitute independently. Under either, marker absence is meaningless.
const trusted=!['default','unknown',''].includes(sid);
let installed=null;
try{
  const dir=process.env.CLAUDE_CONFIG_DIR||p.join(os.homedir(),'.claude');
  const recs=JSON.parse(fs.readFileSync(p.join(dir,'plugins','installed_plugins.json'),'utf8'));
  // CC keys these records '<name>@<marketplace>' (e.g. 'ctk@claude-forge'), NOT 'ctk'.
  const t=recs.plugins||{};
  installed=Object.keys(t).filter(k=>k==='ctk'||k.startsWith('ctk@')).flatMap(k=>(t[k]||[]).map(e=>e.version)).filter(Boolean);
}catch{}
const cmp=(a,b)=>{const A=(a.split('-')[0]||'').split('.'),B=(b.split('-')[0]||'').split('.');
  for(let i=0;i<Math.max(A.length,B.length);i++){const x=parseInt(A[i]||'0',10)||0,y=parseInt(B[i]||'0',10)||0;if(x!==y)return x-y;}return 0;};
const stamping=(installed||[]).some(v=>cmp(v,'2.14.0')>=0);
let rec=null; try{rec=JSON.parse(fs.readFileSync(p.join(os.tmpdir(),'claude-ctk-hook-alive-'+sid+'.txt'),'utf8'))}catch{}
console.log('session       :', sid, trusted?'(trusted)':'(UNTRUSTED fallback id)');
console.log('installed ctk :', installed?installed.join(', '):'unreadable');
console.log('stamp expected:', stamping);
console.log('marker        :', rec?('PRESENT — stamped by '+rec.hook+' at '+rec.at):'ABSENT');
console.log('VERDICT       :', rec?'OK':(!trusted?'INCONCLUSIVE (untrusted session id)':(!stamping?'INCONCLUSIVE (installed ctk predates stamping)':'FAIL')));
"
```

| VERDICT | Meaning |
|---|---|
| `OK` | A ctk hook demonstrably ran in this session. Report the stamping hook and time. |
| `FAIL` | **This is the #82 state.** A stamping-capable ctk is installed and the session id is trustworthy, yet nothing stamped. Treat as a total or partial hook unload and capture evidence below. |
| `INCONCLUSIVE (installed ctk predates stamping)` | Not a fault. The installed ctk is older than 2.14.0 and its hooks never stamp. Report the version. |
| `INCONCLUSIVE (untrusted session id)` | Not a fault. The id fell back to a constant, so writer and reader may key different files. Report it as undetermined. |

> **Why not simply "marker absent ⇒ broken":** an earlier revision of this check
> keyed off a flag that stamping dropped in the temp directory, on the theory that
> its presence proved the install could stamp. The flag was machine-global and
> never expired, so **this repo's own test suite armed it** — and `/doctor` then
> reported FAIL on a completely healthy install. Ask CC's plugin records for the
> installed version instead of inferring capability from a side effect.

On **FAIL**, capture evidence *before* repairing anything. The 2026-07-29 occurrence was
repaired first, which destroyed the evidence and is why the trigger is still unidentified.
Collect, in this order: `ls -la ~/.claude/plugins/`; copies of `installed_plugins.json`,
`known_marketplaces.json` and `plugin-catalog-cache.json`; `git -C
~/.claude/plugins/marketplaces/<mkt> log --oneline -1` plus `status`; the `/plugin` **Errors**
tab; and `claude --output-format stream-json -p test | jq '.init.plugin_errors'`, which is the
runtime load-error signal `claude plugin list` lacks. Then repair **one command at a time**,
re-checking load state between each, so the fix is isolated — that was not done last time, and
is why no command can be credited with the repair.

**Do not report this check as OK on the strength of a passing Step 1 or 1a.** Their agreement
is exactly what was true while the hooks were dead.

### Step 1c: Look for PAST Hook Outages (#82)

Step 1b answers *"is a hook firing in **this** session?"* — it cannot see an outage that has
already ended. That is why #82 was believed to be a single event: nobody could look backwards.

This step looks backwards. It joins two per-hour series — hooked tool calls from CC's
transcripts, and lines in ctk's own permission/hook logs — and reports hours where tools ran and
hooks did not:

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/dist/bin/detect-hook-outages.js"
```

| Exit | Meaning |
|---|---|
| `0` | No outage hour found in retained history. |
| `1` | **Outage hours found.** Each is an hour where the session ran with no `security-blocker`, no permission hooks and no continuity lifecycle. |
| `2` | Inconclusive — no hook-log coverage to be silent. |

Add `--json` for machine-readable output, `--min-tools N` to change the pre-filter.

**Silence is probabilistic, not binary — do not lower the bar.** `bash-combined` writes a
permission line on auto-approve or deny but **not** when a command defers to a user prompt, and
`hooks.log` is WARN-level, so only ~0.5 log lines are written per hooked tool call. A quiet hour
of 5 tool calls happens by chance about 5% of the time. The tool therefore applies a
family-wise significance test against the **measured** rate rather than a fixed threshold, and
prints both (`logging rate`, and how many quiet hours it rejected as chance). On the machine
this was built against, a naive fixed threshold reported **18** outages where **7** were real.

**A finding here is historical, not live.** It says hooks were absent then. Run Step 1b to
learn whether they are absent *now*, and only follow the capture-before-repair checklist there
if 1b also fails.

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

⚠ **Check `$CLAUDE_PLUGIN_DATA/logs/`, not `~/.claude/logs/<short-name>/`.** `logging.ts`
prefers `CLAUDE_PLUGIN_DATA` for live hooks; the `~/.claude/logs/` path is a fallback written
only when that variable is unset — in practice by the **test suite**. Its newest entries
(`session=unknown`, fixture commands like `echo hi`) read exactly like recent live activity, so
sizing up the legacy directory reports on a file no live hook has touched.

```bash
# Resolve the real directory first — do not assume either path.
find ~/.claude -name "permission-feedback.log" -newermt "-24 hours"
```

```
For each plugin, check <resolved-log-dir>/hooks.log size
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
