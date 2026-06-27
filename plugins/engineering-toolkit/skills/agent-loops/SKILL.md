---
name: agent-loops
description: Agentic workflow patterns — ReAct agents, plan-and-execute, self-correcting validation, sliding-window memory, and replanning. Triggers on agent loop, ReAct, plan-and-execute, reasoning loop, self-correcting agent, replanning, agentic workflow
effort: low
keep-coding-instructions: true
---

# Agent Loops

Enable LLMs to reason, plan, and take autonomous actions.

## Key Decisions

| Parameter | Recommended | Notes |
|-----------|-------------|-------|
| Max steps | 5-15 | Higher for research, lower for actions with side effects |
| Temperature | 0.3-0.7 | Lower for deterministic tasks, higher for creative |
| Memory window | 10-20 messages | Summarize older context to avoid token overflow |
| Validation frequency | Every 3-5 steps | Self-check to prevent drift |

## Patterns

Choose based on task type:
- **ReAct** (Thought/Action/Observation loop) - Default for most tasks
- **Plan-and-Execute** - For multi-step tasks where upfront planning reduces errors
- **Self-Correction** - When output quality must be validated before returning

See [agent-workflow-template.ts](${CLAUDE_SKILL_DIR}/templates/agent-workflow-template.ts) for a complete TypeScript implementation.

### Karpathy Loop (Autonomous Iteration)

Metric-driven autonomous improvement loop. Establish baseline, then iterate: hypothesize, modify, evaluate, keep if improved, discard if regressed. Continue until budget exhausted or goal reached.

**Components**: mutable target + measurable metric + fixed budget + binary keep/discard
**Use cases**: performance optimization, coverage improvement, ML training, cost reduction
**Key constraint**: single metric with clear direction (minimize/maximize) removes ambiguity
**Safety**: git-based rollback, file allowlists, correctness gates, stuck detection

See `/experiment` skill for full implementation. See `/cover --target` for specialized coverage variant.

## Before running an unattended loop

Walk the [loop failure-mode checklist](${CLAUDE_SKILL_DIR}/references/loop-failure-modes.md) — ten
named ways an autonomous loop goes wrong (Infinite Fix Loop, Verifier Theater, Token Burn,
Over-Reach, Escalation Failure, …), each cross-linked to the guardrail this repo already enforces
against it. It's a 30-second pre-flight before letting any loop run unwatched, and it pairs with the
[autonomy ladder](../auto-research/references/autonomy-ladder.md) (how much autonomy to grant, and
when to promote).

## Related Skills

- `function-calling` - Tool definitions and execution
- `multi-agent-orchestration` - Coordinating multiple agents
- `langgraph-workflows` - Stateful agent graphs
- `/experiment` - Autonomous metric-driven iteration (Karpathy Loop implementation)
- `langfuse-observability` - LLM observability, tracing, and evaluation
