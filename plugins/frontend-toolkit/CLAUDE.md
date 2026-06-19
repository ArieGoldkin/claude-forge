# ftk — Frontend Toolkit (Claude Code Plugin)

> **Plugin Name**: ftk (formerly `frontend-toolkit`, renamed in v2.0.0)
> **Version**: 2.3.4

## Overview

Claude Code plugin for frontend development, UI/UX design, browser automation, and Remotion explainer videos. Provides 17 skills, 4 agents, and 11 commands.

**Hooks**: No hooks (shared hooks provided by ctk).

## Plugin Structure

- `skills/` - 17 specialized skill directories (agent-browser, agentation, ai-ui-generation, ascii-visualizer, browser-content-capture, coding-standards, design-system-tokens, **explainer-video** (NEW v2.1.0), figma-design-workflow, frontend-creative-design, interaction-patterns, json-render, prototype-to-production, responsive-patterns, shadcn, stitch, ui-components)
- `agents/` - 4 agent definitions (ui-developer, rapid-ui-designer, ux-researcher, whimsy-injector)
- `commands/` - 11 slash commands

## Development

```bash
cd hooks
npm install
npm run build
npm run typecheck
npm test
npm run lint
```

## Environment Variables

- `CLAUDE_PLUGIN_NAME` - Set to "frontend" by run-hook-wrapper.sh (used for log-dir naming; kept short, unchanged by the ftk rename)
- `FRONTEND_TOOLKIT_LOG_LEVEL` - Log level: debug|info|warn|error (default: warn)
- `STITCH_API_KEY` - Google Stitch API key (via 1Password, required for /stitch skill)
