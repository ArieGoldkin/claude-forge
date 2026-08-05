# Engineering Toolkit

[![CI](https://github.com/ArieGoldkin/claude-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/ArieGoldkin/claude-forge/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

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

- **27 Skills**: agent-loops, architecture-decision-record, atlassian-integration, audit-skill, auto-research, brainstorming, caveman, cmux, code-review-playbook, coding-standards, conduct, cover, development-pipeline, evidence-verification, experiment, fix-bug, hipaa-compliance-checker, investigate-sentry, prepare-pr, quality-gates, review-mr, scope-check, security-checklist, testing-strategy-builder, tool-wrapper-patterns, verify, zoom-out
- **5 Agents**: adversarial-verifier, product-manager, quality-reviewer, sprint-prioritizer, tdd-implementer
- **21 Commands**: agent-loops, allocate-tasks-parallel, architecture-decision-record, atlassian-integration, audit-skill, auto-research, brainstorm, code-review-playbook, conduct, cover, develop, experiment, fix-bug, generate-agents-md, hipaa-compliance-checker, investigate-sentry, post-mr-comments, review-stats, start-parallel, sync-parallel, verify
- **1 Hook**: continuity-recommendation. All shared hooks (including `review-logger`) are provided by ctk.

## Recommended Companion Plugins

### debug-skill (Interactive Debugging)

For real interactive debugging (breakpoints, stepping, variable inspection), install [debug-skill](https://github.com/AlmogBaku/debug-skill) alongside etk:

- **What it adds**: Real debugger integration via DAP (Debug Adapter Protocol) for Python, Go, Node.js/TypeScript, Rust, C/C++
- **How it complements**: Our `fix-bug` skill provides structured methodology; debug-skill provides the actual debugging tool
- **Install**: `/plugin install debug-skill` or visit the [GitHub repo](https://github.com/AlmogBaku/debug-skill)

## Repository

https://github.com/ArieGoldkin/claude-forge

---

**Version**: 2.19.0
