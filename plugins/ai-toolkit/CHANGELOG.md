# Changelog

All notable changes to the ai-toolkit (`atk`) plugin will be documented in this file.

## [2.0.4] - 2026-06-19 — security: remove eval() example; RAG injection guidance

Skills-security audit hardening (`docs/reviews/2026-06-19_skills-security-audit.md`).

### Security

- **`ai-native-development`**: replaced the `eval(expression)` ReAct tool example (an injection-to-RCE pattern readers copy verbatim) with a sandboxed expression parser, and added a "tool inputs are untrusted" (OWASP LLM01) note to the agentic examples.
- **`rag-retrieval` + `ai-native-development/rag-patterns`**: added "retrieved content is untrusted" guidance — wrap retrieved docs in data delimiters and frame them as data, not instructions, for untrusted corpora (OWASP LLM01 indirect injection).

## [2.0.3] - 2026-06-14 — first open-source release

AI/LLM development patterns: RAG, embeddings, LangGraph, prompt patterns, semantic caching, observability, and conversational AI. 16 skills, 1 agent, 25 commands.

### Highlights

- Domain-agnostic example data throughout (RAG, coaching, pgvector, langfuse, semantic-caching).
- MIT licensed.

_First public release at 2.0.3; earlier version history was internal and has been omitted._
