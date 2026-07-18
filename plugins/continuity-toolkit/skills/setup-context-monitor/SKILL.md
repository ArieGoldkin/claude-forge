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
transcript parsing, no polling, no extra processes.

```
[Opus 4.8 ◐ xhigh] 📁 my-project | 🌿 main | PR #35 pending
███░░░░░░░ 22% ✨ | $51 | ⏱️ 17h 4m
session: █░░░░░░░░░ 11% (resets in 4h 31m) · weekly: █████░░░░░ 51% (resets in 4d 3h)
tokens: 217.4k in · 826 out · 215.8k cached
```

| Line | Contents | Present when |
|---|---|---|
| 1 | Model + effort/mode badge, project, branch, open PR, worktree | Always (PR only when one is open for the branch) |
| 2 | Context bar + %, freshness emoji, session cost, duration | Always |
| 3 | 5-hour and 7-day rate-limit bars with reset countdowns | Claude.ai Pro/Max, after the first API response |
| 4 | Session token accounting (in / out / cache reads) | Always |

The effort badge shows `⚡ fast` in fast mode, otherwise the effort level with `◐` when extended
thinking is on. Set `CONTINUITY_STATUSLINE_COMPACT=1` to collapse to the classic two lines.

## The Conflict Worth Knowing About

Claude Code runs **one** `statusLine` program. ctk's statusline script is also the only writer of
the context-percentage file that the `context-monitor` hook reads, so:

> Pointing `statusLine` at any other program — [claude-hud](https://github.com/jarrodwatts/claude-hud),
> a custom script, another plugin — silently disables ctk's 70/80/90% context warnings. The launcher
> file stays on disk and nothing errors; the warnings just stop.

This is a genuine either/or, not a bug to route around. Choose deliberately:

| You want | Configure | Trade-off |
|---|---|---|
| Context warnings + the fields above | ctk (this skill) | No live tool/agent/todo counts |
| Live tool counts, subagent tracking, todo progress | claude-hud | ctk's context warnings stop firing |

claude-hud (MIT) parses the session transcript to render per-tool call counts, running subagents,
and todo progress — capability ctk deliberately does not duplicate. If you prefer it, install it and
accept the trade-off knowingly; `/ctk:doctor` will report the conflict rather than a false healthy.

## Related
- `/ctk:doctor` — reports whether the context-warning pipeline is actually wired (Step 4a)
- `/continuity-management` — full system documentation
