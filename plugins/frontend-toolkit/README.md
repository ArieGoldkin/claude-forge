# ftk — Frontend Toolkit

[![CI](https://github.com/ArieGoldkin/claude-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/ArieGoldkin/claude-forge/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

> **Formerly named `frontend-toolkit`.** Renamed to `ftk` in v2.0.0 to shorten slash-command prefixes (e.g. `/frontend-toolkit:shadcn` → `/ftk:shadcn`). The source directory remains `plugins/frontend-toolkit/` for repo readability. Existing installations must uninstall `frontend-toolkit@claude-forge` and reinstall as `ftk@claude-forge`.

Claude Code plugin for frontend development, UI/UX design, and browser automation.

## Features

- **16 Skills**: agent-browser, agentation, ai-ui-generation, ascii-visualizer, browser-content-capture, coding-standards, design-system-tokens, figma-design-workflow, frontend-creative-design, interaction-patterns, json-render, prototype-to-production, responsive-patterns, shadcn, stitch, ui-components
- **4 Agents**: ui-developer, rapid-ui-designer, ux-researcher, whimsy-injector
- **11 Commands**: agent-browser, ai-ui-generation, ascii-visualizer, browser-content-capture, figma-design-workflow, frontend-creative-design, json-render, prototype-to-production, shadcn, stitch, web-research
- **Hooks**: No plugin-specific hooks. Shared hooks provided by ctk.

### Stitch AI MCP Server

The `stitch` skill integrates with Google Stitch, providing 10 MCP tools for AI-powered UI generation, design extraction, and screen management. Requires a `STITCH_API_KEY` environment variable.

### Newer Skills

- **design-system-tokens** - Design token management and generation
- **ui-components** - UI component patterns and best practices
- **responsive-patterns** - Responsive design patterns and breakpoint strategies
- **interaction-patterns** - User interaction patterns and micro-interactions

## Installation

### From Marketplace (Recommended)

```bash
/plugin marketplace add https://github.com/ArieGoldkin/claude-forge.git
/plugin install ftk@claude-forge
```

### Via git-subdir (Direct Install)

```bash
/plugin install --source git-subdir \
  --url https://github.com/ArieGoldkin/claude-forge.git \
  --path plugins/frontend-toolkit
```

### Local Development

```bash
git clone git@github.com:ArieGoldkin/claude-forge.git
claude --plugin-dir ./claude-forge/plugins/frontend-toolkit
```

> **Tip**: Use `/reload-plugins` to hot-reload plugin changes without restarting Claude Code.

## Development

```bash
cd hooks && npm install && npm run build && npm test
```

---

**Version**: 2.3.3
