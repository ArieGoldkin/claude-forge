# Claude Code Plugins Monorepo

Monorepo for Arie Goldkin Claude Code plugins with shared hook infrastructure.

## Plugins

| Plugin | Version | Skills | Agents | Commands | Description |
|--------|---------|--------|--------|----------|-------------|
| [ctk](plugins/continuity-toolkit/) (was: continuity-toolkit) | 2.6.9 | 11 | 1 | 12 | **Solves for** context loss — sessions that forget everything after compaction or a restart. Session continuity — state persistence, context monitoring, delta-cache token compression, dangerous-bash registry (filesystem/http/aws/terraform), preflight context + approval-first git-push gate for destructive commands, auto-continue handoff contract (PreCompact → SessionStart), opt-in terminal window-title (CONTINUITY_TERMINAL_TITLE=1), token-savings measurement spike, HIPAA hook, 29 shared hooks |
| [dtk](plugins/devops-toolkit/) (was: devops-toolkit) | 2.0.6 | 15 | 2 | 12 | **Solves for** infra guesswork — AWS/Terraform/CI patterns rebuilt from scratch on every project. DevOps — AWS, Terraform, CI/CD, Salesforce, Lambda container patterns, Husky pre-commit setup |
| [atk](plugins/ai-toolkit/) (was: ai-toolkit) | 2.0.4 | 16 | 1 | 25 | **Solves for** LLM-feature trial-and-error — RAG/agent/evaluation patterns rediscovered per team. AI/LLM — RAG, embeddings, LangGraph, coaching, prompt patterns, NotebookLM |
| [ftk](plugins/frontend-toolkit/) (was: frontend-toolkit) | 2.3.4 | 17 | 4 | 11 | **Solves for** slow design-to-code round-trips and decisions buried in chat scrollback. Frontend — React, Figma, Stitch AI, json-render, design systems, browser automation, Remotion explainer videos (block-based + bespoke) |
| [etk](plugins/engineering-toolkit/) (was: engineering-toolkit) | 2.7.4 | 24 | 4 | 19 | **Solves for** review bounces — lint/format/typecheck failures caught after push instead of before. Engineering — ADR, TDD, code review, HIPAA, quality gates, brainstorming, Sentry investigation, MR-comment posting, business-invariants authoring + planning-time consumption, subagent scope-restate, ticket scope-check (auto-loaded), codebase zoom-out, caveman terse-mode |

## Installation

### Via Marketplace (Recommended)

```bash
# Add the marketplace
/plugin marketplace add https://github.com/ArieGoldkin/claude-dev-kit.git

# Install individual plugins
/plugin install ctk@claude-dev-kit
/plugin install etk@claude-dev-kit
```

### Via git-subdir (Direct Install)

Install individual plugins directly from the monorepo without adding a marketplace:

```bash
/plugin install --source git-subdir \
  --url https://github.com/ArieGoldkin/claude-dev-kit.git \
  --path plugins/continuity-toolkit
```

### Local Development

```bash
git clone git@github.com:ArieGoldkin/claude-dev-kit.git
claude --plugin-dir ./claude-dev-kit/plugins/continuity-toolkit
```

> **Tip**: Use `/reload-plugins` to hot-reload plugin changes without restarting Claude Code.

## Architecture

Shared hook infrastructure (lib utilities, types) lives in `shared/hooks-infra/` and is symlinked into each plugin's `hooks/src/` directory. Each plugin maintains its own hook implementations, build configs, and versioning.

```
claude-dev-kit/
├── shared/hooks-infra/     # Shared lib (12 files) + types.ts
│   ├── src/lib/            # output, input, logging, path-utils, guards, etc.
│   ├── src/types.ts        # Core type definitions
│   └── tests/lib/          # Shared lib unit tests
├── plugins/
│   ├── continuity-toolkit/    # hooks/src/lib → symlink to shared
│   ├── devops-toolkit/        # hooks/src/lib → symlink to shared
│   ├── ai-toolkit/            # hooks/src/lib → symlink to shared
│   ├── frontend-toolkit/      # hooks/src/lib → symlink to shared
│   └── engineering-toolkit/   # hooks/src/lib → symlink to shared
└── .github/workflows/     # GitHub Actions CI (per-plugin matrix)
```

> **Note**: Install `ctk` alongside other plugins for shared hook coverage (security, permissions, lifecycle). All 5 plugins are domain-agnostic and reusable on any project. See [CLAUDE.md](CLAUDE.md) for full architecture details.

## Development

```bash
# Edit shared code — all plugins pick it up instantly
vim shared/hooks-infra/src/lib/output.ts

# Test in any plugin
cd plugins/continuity-toolkit/hooks && npm test

# Plugin-specific changes
cd plugins/continuity-toolkit/hooks && vim src/pretool/security-blocker.ts

# Hot-reload after changes (no restart needed)
/reload-plugins
```

## Repository

https://github.com/ArieGoldkin/claude-dev-kit
