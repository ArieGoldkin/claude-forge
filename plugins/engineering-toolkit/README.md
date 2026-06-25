# Engineering Toolkit

Claude Code plugin for engineering practices, quality gates, and workflow orchestration.

## Installation

### From Marketplace (Recommended)

```bash
/plugin marketplace add https://github.com/ArieGoldkin/claude-forge.git
/plugin install etk@claude-forge
```

### Via git-subdir (Direct Install)

```bash
/plugin install --source git-subdir \
  --url https://github.com/ArieGoldkin/claude-forge.git \
  --path plugins/engineering-toolkit
```

### Local Development

```bash
git clone git@github.com:ArieGoldkin/claude-forge.git
claude --plugin-dir ./claude-forge/plugins/engineering-toolkit
```

> **Tip**: Use `/reload-plugins` to hot-reload plugin changes without restarting Claude Code.

## Features

- **20 Skills**: agent-loops, architecture-decision-record, atlassian-integration, auto-research, brainstorming, code-review-playbook, coding-standards, cover, development-pipeline, evidence-verification, experiment, fix-bug, hipaa-compliance-checker, investigate-sentry, quality-gates, security-checklist, testing-strategy-builder, tool-wrapper-patterns, verify
- **5 Agents**: logic-validator, product-manager, quality-reviewer, sprint-prioritizer, tdd-implementer
- **20 Commands**: agent-loops, allocate-tasks-parallel, architecture-decision-record, atlassian-integration, auto-research, brainstorm, code-review-playbook, cover, develop, experiment, fix-bug, generate-agents-md, hipaa-compliance-checker, investigate-sentry, review-mr, review-stats, start-parallel, sync-parallel, verify
- **Hooks**: review-logger, continuity-recommendation. Shared hooks provided by ctk.

## Recommended Companion Plugins

### debug-skill (Interactive Debugging)

For real interactive debugging (breakpoints, stepping, variable inspection), install [debug-skill](https://github.com/AlmogBaku/debug-skill) alongside etk:

- **What it adds**: Real debugger integration via DAP (Debug Adapter Protocol) for Python, Go, Node.js/TypeScript, Rust, C/C++
- **How it complements**: Our `fix-bug` skill provides structured methodology; debug-skill provides the actual debugging tool
- **Install**: `/plugin install debug-skill` or visit the [GitHub repo](https://github.com/AlmogBaku/debug-skill)

## Repository

https://github.com/ArieGoldkin/claude-forge

---

**Version**: 2.7.1
