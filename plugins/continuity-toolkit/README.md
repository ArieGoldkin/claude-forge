# ctk

Session continuity and context management plugin for Claude Code. Provides multi-session state persistence, automatic dirty tracking, context window monitoring, and security guardrails.

## Features

- **Session persistence**: Ledger tracking with append-until-handoff model
- **Automatic dirty tracking**: Warns after 15/25 file edits
- **Context monitoring**: Tiered warnings at 70/80/90% context usage
- **Stale session detection**: Warns when previous session ended uncleanly
- **Security guardrails**: Blocks dangerous commands and sensitive file access
- **Rich StatusLine**: Context %, cost, duration in status bar

## Installation

### From Marketplace (Recommended)

```bash
# Add the marketplace
/plugin marketplace add https://github.com/ArieGoldkin/claude-forge.git

# Install plugin
/plugin install ctk@claude-forge
```

### Via git-subdir (Direct Install)

```bash
/plugin install --source git-subdir \
  --url https://github.com/ArieGoldkin/claude-forge.git \
  --path plugins/ctk
```

### Local Development

```bash
# Clone the monorepo
git clone git@github.com:ArieGoldkin/claude-forge.git

# Build hooks
cd claude-forge/plugins/ctk/hooks && npm install && npm run build

# Test locally
claude --plugin-dir ./claude-forge/plugins/ctk
```

> **Tip**: Use `/reload-plugins` to hot-reload plugin changes without restarting Claude Code.

## Quick Start

1. Start a new Claude Code session with the plugin
2. Run `/setup-continuity` to initialize the continuity system
3. Run `/setup-context-monitor` to enable StatusLine monitoring
4. Use `/save-state` periodically to track progress
5. Use `/create-handoff` when ending sessions

## Commands

| Command | When to Use |
|---------|-------------|
| `/save-state` | After milestones, before context fills up |
| `/create-handoff` | End of session, switching projects |
| `/resume-session` | Starting new session |
| `/check-maintenance` | Weekly health check |
| `/archive-ledger` | When ledger >500 lines |
| `/archive-handoffs` | When handoffs >20 files |
| `/continuity-metrics` | Check session status |
| `/setup-continuity` | First-time setup |
| `/setup-context-monitor` | Enable context monitoring |

## Why This Exists

Claude Code sessions are stateless. When a session ends or the context window fills up, Claude loses all working knowledge. You start fresh every time — re-explaining what you're building, what's done, and what's next.

This plugin keeps a local record of your work so the next session picks up where the last one left off.

## Walkthrough

### First time on a project

```
> /setup-continuity
```

This creates `.claude/continuity/` in your project with a ledger file. The ledger is a markdown file that accumulates what happened across sessions. Run this once per project.

### During a session

Work normally. The plugin runs in the background:

- It loads the last ledger summary when the session starts, so Claude already knows what happened before.
- It counts file edits. After 15 edits, you'll see a warning suggesting you save state. Another warning at 25.
- It monitors context window usage. At 70%, 80%, and 90% full, you'll see escalating warnings to save before auto-compaction.

When you hit a milestone or see a warning:

```
> /save-state
```

This appends your current progress to the ledger — what you did, what files changed, what's next.

### Ending a session

```
> /create-handoff
```

This creates a YAML snapshot with everything the next session needs: current status, recent changes, open issues, file list. Think of it as a structured bookmark.

### Starting the next session

```
> /resume-session
```

This reads the ledger and latest handoff, then presents a summary. Claude now has the context it needs to continue.

### What you'll actually see

**Session start** — a compact summary appears automatically:
```
=== SESSION CONTEXT ===
Branch: feature/auth
Status: In progress - implementing OAuth flow
Recent: Added login endpoint, token refresh logic
Next: Add logout endpoint, write integration tests
```

**After 15 file edits** — a system warning:
```
⚠ 15 files modified this session. Consider running /save-state.
```

**At 80% context usage** — a system warning:
```
⚠ Context 80% full. Recommend /create-handoff then /clear soon.
```

### What it doesn't do

- It does not send data anywhere. Everything stays in `.claude/continuity/` on your filesystem.
- It does not auto-save. You decide when to save state and create handoffs.
- It does not replace git. The ledger tracks AI session context, not code history.

### File structure

```
.claude/continuity/
├── ledgers/          # Project ledger (append-only markdown)
├── handoffs/         # Session handoff snapshots (YAML)
├── context/          # Session heartbeat (shared-context.json)
└── archive/          # Old ledgers and handoffs after archiving
```

The `.claude/` directory is gitignored by default. The continuity data is local to each developer's machine.

## Prerequisites

- Claude Code v4.1+ (StatusLine support)
- Node.js 22+

## Repository

https://github.com/ArieGoldkin/claude-forge

## License

MIT — see [LICENSE](LICENSE).
