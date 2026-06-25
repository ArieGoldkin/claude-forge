# atk — AI Toolkit

> **Formerly named `ai-toolkit`.** Renamed to `atk` in v2.0.0 to shorten slash-command prefixes (e.g. `/ai-toolkit:rag-retrieval` → `/atk:rag-retrieval`). The source directory remains `plugins/ai-toolkit/` for repo readability. Existing installations must uninstall `ai-toolkit@claude-forge` and reinstall as `atk@claude-forge`.

Claude Code plugin for AI/LLM development patterns including RAG, embeddings, LangGraph, prompt engineering, and more.

## Features

- **14 Skills**: ai-native-development, embeddings, function-calling, golden-dataset, langfuse-observability, langgraph, llm-patterns, multi-agent-orchestration, notebooklm, ollama-local, prompt-caching, rag-retrieval, semantic-caching, streaming-api-patterns
- **1 Agent**: ai-ml-engineer
- **23 Commands**: ai-native-development, embeddings, function-calling, golden-dataset-curation, golden-dataset-management, golden-dataset-validation, langfuse-observability, langgraph-checkpoints, langgraph-human-in-loop, langgraph-parallel, langgraph-routing, langgraph-state, langgraph-supervisor, llm-evaluation, llm-streaming, llm-testing, multi-agent-orchestration, notebooklm, ollama-local, prompt-caching, rag-retrieval, semantic-caching, streaming-api-patterns
- **Hooks**: No plugin-specific hooks. Shared hooks provided by ctk.

## Installation

### From Marketplace (Recommended)

```bash
/plugin marketplace add https://github.com/ArieGoldkin/claude-forge.git
/plugin install atk@claude-forge
```

### Via git-subdir (Direct Install)

```bash
/plugin install --source git-subdir \
  --url https://github.com/ArieGoldkin/claude-forge.git \
  --path plugins/ai-toolkit
```

### Local Development

```bash
git clone git@github.com:ArieGoldkin/claude-forge.git
claude --plugin-dir ./claude-forge/plugins/ai-toolkit
```

> **Tip**: Use `/reload-plugins` to hot-reload plugin changes without restarting Claude Code.

## Development

```bash
cd hooks && npm install && npm run build && npm test
```

---

**Version**: 2.0.0
**Repository**: https://github.com/ArieGoldkin/claude-forge
**Maintainer**: Arie Goldkin
