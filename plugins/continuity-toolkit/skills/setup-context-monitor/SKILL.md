---
name: setup-context-monitor
description: Configure the StatusLine-based context percentage monitor. Use when setting up context window warnings for the first time.
effort: low
---

# /setup-context-monitor

One-time setup to enable proactive context window usage warnings via StatusLine.

## When to Use
- First time enabling context monitoring
- After reinstalling the plugin
- When context warnings aren't appearing
- To verify the monitoring pipeline is working

## What It Does
- Creates stable launcher script at `~/.config/claude/continuity-statusline.sh`
- Configures global StatusLine in `~/.claude/settings.json` (applies to all projects)
- Sets `refreshInterval: 30` for periodic auto-refresh (CC 2.1.97+)
- Launcher auto-discovers the plugin's context-percentage.js via glob pattern
- Verifies context-monitor hook is registered in `hooks.json`
- Context warnings inject at thresholds: 70% advisory, 80% warning, 90% critical
- Warnings only escalate (never repeat at same tier); reset after compaction drops below 70%

## Step 0: Check for an Existing StatusLine First

**Run this before writing anything.** Overwriting a `statusLine` the user deliberately chose is
destructive, and the consequence of *not* checking runs both ways — see the conflict note below.

```bash
python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/.claude/settings.json')));print(json.dumps(d.get('statusLine','(unset)')))"
```

| Existing value | Action |
|---|---|
| Unset, or already `continuity-statusline.sh` | Proceed with setup |
| Any other program | **Stop and ask.** Name what is configured, explain the trade-off below, and let the user choose |

## What the StatusLine Displays

Every field below comes from the JSON Claude Code already sends the statusline on stdin — no
transcript parsing and no polling. The one exception is the branch, which shells out to
`git rev-parse --abbrev-ref HEAD` and is cached for 5 seconds.

```
[Opus 4.8 ◐ xhigh] 📁 my-project | 🌿 main | PR #35 pending
██░░░░░░░░ 22% ✨ | $51 | ⏱️ 17h 4m
session: █░░░░░░░░░ 11% (resets in 4h 31m) · weekly: █████░░░░░ 51% (resets in 4d 3h)
tokens: 217.4k in · 826 out · 215.8k cached
```

| Line | Contents | Present when |
|---|---|---|
| 1 | Model + effort/mode badge, project, branch, open PR, worktree | Always. Branch is omitted outside a git repo or on a detached HEAD; the PR segment only when an open PR exists for the branch; the effort badge only on models that report a reasoning-effort level |
| 2 | Context bar + %, freshness emoji, session cost, duration | Always |
| 3 | 5-hour and 7-day rate-limit bars with reset countdowns | Claude.ai Pro/Max, after the first API response. A countdown is dropped if its timestamp is absent or implausible (beyond eight days) |
| 4 | Session token accounting (in / out / cache reads) | Whenever the payload reports non-zero tokens — omitted rather than printing a row of zeros. The cached segment appears only when there are cache reads |

The effort badge shows `⚡ fast` in fast mode, otherwise the effort level with `◐` when extended
thinking is on. Set `CONTINUITY_STATUSLINE_COMPACT=1` to collapse to the classic two lines.

## The Conflict Worth Knowing About

Claude Code runs **one** `statusLine` program. ctk's statusline script is also the only writer of
the context-percentage file that the `context-monitor` hook reads, so:

> Pointing `statusLine` at any other program — [claude-hud](https://github.com/jarrodwatts/claude-hud),
> a custom script, another plugin — silently disables ctk's 70/80/90% context warnings. The launcher
> file stays on disk and nothing errors; the warnings just stop.

The display is exclusive; the side effect does not have to be. Three options:

| You want | Configure | Trade-off |
|---|---|---|
| Context warnings + the fields above | ctk alone (this skill) | No live tool/agent/todo counts |
| Live tool counts, subagent tracking, todo progress | The other statusline alone | ctk's context warnings stop firing |
| **Both** | Composed launcher — ctk silent + the other program (Step 1a) | Two processes per refresh instead of one |

**Composition is usually the right answer.** `CONTINUITY_STATUSLINE_SILENT=1` makes ctk write the
percentage file and print nothing, so another program can own every pixel while the context
warnings keep firing. It also avoids the duplication a naive stack produces — model, context bar,
cost, rate limits, and tokens are rendered by both ctk and claude-hud, so concatenating raw output
repeats about half the fields.

claude-hud (MIT) parses the session transcript to render per-tool call counts, running subagents,
and todo progress — capability ctk deliberately does not duplicate. Install it, then compose via
Step 1a. `/ctk:doctor` reports a conflict only when the pipeline is genuinely broken, not merely
because a second statusline is present.

## Related
- `/ctk:doctor` — reports whether the context-warning pipeline is actually wired (Step 4a)
- `/continuity-management` — full system documentation
