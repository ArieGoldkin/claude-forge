# atk — AI Toolkit (Claude Code Plugin)

> **Plugin Name**: atk (formerly `ai-toolkit`, renamed in v2.0.0)
> **Version**: 2.0.5

## Overview

Claude Code plugin for AI/LLM development patterns. Provides 14 skills, 1 agent, and 23 commands for AI-native development.

**Hooks**: No hooks (shared hooks provided by ctk).

## Content

### Skills (14)
ai-native-development, embeddings, function-calling, golden-dataset, langfuse-observability, langgraph, llm-patterns, multi-agent-orchestration, notebooklm, ollama-local, prompt-caching, rag-retrieval, semantic-caching, streaming-api-patterns

### Agents (1)
ai-ml-engineer

### Commands (23)
ai-native-development, embeddings, function-calling, golden-dataset-curation, golden-dataset-management, golden-dataset-validation, langfuse-observability, langgraph-checkpoints, langgraph-human-in-loop, langgraph-parallel, langgraph-routing, langgraph-state, langgraph-supervisor, llm-evaluation, llm-streaming, llm-testing, multi-agent-orchestration, notebooklm, ollama-local, prompt-caching, rag-retrieval, semantic-caching, streaming-api-patterns

## Environment Variables

```bash
CLAUDE_PROJECT_DIR     # Project root (from Claude Code)
CLAUDE_PLUGIN_ROOT     # Plugin installation path
AI_TOOLKIT_LOG_LEVEL   # Log level: debug|info|warn|error (default: warn)
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
