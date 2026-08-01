# Engineering Toolkit - Claude Code Plugin

> **Plugin Name**: etk (formerly `engineering-toolkit`, renamed in v2.0.0)
> **Version**: 2.18.2

## Overview

Claude Code plugin for engineering practices: architecture decision records, TDD, code review, quality gates, brainstorming, and workflow orchestration.

## Contents

- **27 skills**: agent-loops, architecture-decision-record, atlassian-integration, audit-skill, auto-research, brainstorming, caveman, cmux, code-review-playbook, coding-standards, conduct, cover, development-pipeline, evidence-verification, experiment, fix-bug, hipaa-compliance-checker, investigate-sentry, prepare-pr, quality-gates, review-mr, scope-check, security-checklist, testing-strategy-builder, tool-wrapper-patterns, verify, zoom-out
- **5 agents**: adversarial-verifier, product-manager, quality-reviewer, sprint-prioritizer, tdd-implementer
- **21 commands**: agent-loops, allocate-tasks-parallel, architecture-decision-record, atlassian-integration, audit-skill, auto-research, brainstorm, code-review-playbook, conduct, cover, develop, experiment, fix-bug, generate-agents-md, hipaa-compliance-checker, investigate-sentry, post-mr-comments, review-stats, start-parallel, sync-parallel, verify
- **1 hook**: continuity-recommendation (SessionStart) - recommends installing ctk for full shared-hook coverage. (`review-logger` is a *shared* hook, registered and owned by **ctk** — etk does not wire it.)

**Note**: Shared hooks (security, permissions, lifecycle, etc.) are provided by ctk.

## Hook System

Hooks run through `hooks/bin/run-hook-wrapper.sh`. Build with:

```bash
cd hooks && npm install && npm run build
```

### Environment Variables

```bash
CLAUDE_PROJECT_DIR       # Project root (from Claude Code)
CLAUDE_PLUGIN_ROOT       # Plugin installation path
ENGINEERING_LOG_LEVEL    # Log level: debug|info|warn|error (default: warn)
```

## Development

```bash
cd hooks
npm install          # Install dependencies
npm run build        # Build with tsup
npm run typecheck    # TypeScript check
npm test             # Run tests
npm run lint         # Biome lint
```
