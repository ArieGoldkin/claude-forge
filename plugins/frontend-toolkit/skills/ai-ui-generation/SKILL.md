---
name: ai-ui-generation
description: "Decision framework for AI UI \u2014 json-render vs Stitch AI vs Claude Design vs manual components. Triggers on AI UI, generative UI, claude design"
effort: low
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*render*"
  - "**/*generate*"
---

# AI UI Generation

Select the right approach for AI-powered UI generation based on your use case, then follow the appropriate patterns.

## Decision Matrix

| Criterion | json-render | Stitch AI | Claude Design | Manual Components |
|-----------|-------------|-----------|---------------|-------------------|
| **Best for** | Runtime AI-generated UIs, dashboards, streaming | Design mockups, prototypes, visual exploration | End-to-end design → Claude Code handoff for implementation | Known, stable UIs with specific requirements |
| **Type safety** | Zod schemas enforce valid props | No type constraint on output | No type constraint; handoff bundle interpreted by Claude Code | Full TypeScript control |
| **Streaming** | JSON Patch over SSE | Not streaming | Not streaming | N/A |
| **Token cost** | YAML mode: 30% savings | Image-based (higher cost) | Bundled in Pro/Max/Team/Enterprise subscription | Zero AI cost |
| **Output** | JSON/YAML spec → rendered UI | HTML/images → manual conversion | Handoff bundle → `claude-code` session → production code | Production code directly |
| **Multi-surface** | React, Native, PDF, email, video | Web only | Web prototypes (voice, video, shaders, 3D) | Per-platform implementation |
| **Target user** | AI/ML engineers, streaming dashboards | Designers/PMs exploring visual options | Designers + engineers collaborating via Claude Code | Frontend engineers on production work |
| **CI/CD** | Codegen converts spec → JSX | Prototype-to-production skill | Manual — handoff bundle is a one-shot prompt, not pipeline-friendly | Standard builds |
| **Derives design system from codebase?** | No | No | **Yes** — reads codebase + design files for colors, typography, components | No |

## When to Use Each

### Use json-render When:
- The UI is **generated at runtime** from user prompts or data
- You need **streaming progressive rendering** (dashboards, real-time views)
- You want **type-safe guardrails** — AI can only produce valid component specs
- You need **multi-surface output** from one spec (web + mobile + PDF)
- You're building **AI-powered tools** (session monitors, analytics dashboards, admin panels)

### Use Stitch AI When:
- You need **visual design exploration** before coding
- The UI is a **one-time design** that will be manually implemented
- You want **design variants** (REFINE/EXPLORE/REIMAGINE creative ranges)
- You're in **early prototyping** and need rapid visual iteration
- Your target handoff is **Figma** (Stitch exports to Figma files)

### Use Claude Design When:
- Your target handoff is **Claude Code itself** (not Figma) — Claude Design packages a handoff bundle that Claude Code can act on directly
- You want Claude to **auto-derive a design system** from your existing codebase + design files (colors, typography, components reused automatically)
- You need **interactive prototypes** with voice, video, shaders, 3D, or built-in AI features (not just static mockups)
- Stakeholders are already in the **Claude Pro/Max/Team/Enterprise** subscription surface
- The workflow is **design → handoff → build in Claude Code** (one continuous session)

> **Caveats (research preview, as of 2026-04):** no public API, no MCP server, no SDK. The handoff bundle format is undocumented. Enterprise rollout requires admin enablement. For HIPAA/health-data work, note that Claude Design's file ingestion is outside our hook coverage. Revisit this section when Anthropic ships a programmatic API; for now, treat Claude Design as a UI-only tool.

### Use Manual Components When:
- The UI is **well-defined** with specific pixel-perfect requirements
- **Performance is critical** (no runtime spec interpretation overhead)
- The UI **won't change dynamically** based on AI input
- You're building **shared library components** consumed by other teams

## Architecture Pattern: AI Dashboard

For AI-generated dashboards (session monitor, analytics):

```
User prompt → LLM generates json-render spec → Stream via SSE → React renders progressively
                    ↓
              Zod validates against catalog
              (rejects invalid components/props)
```

### Implementation Steps

1. **Define catalog** — Map your domain components to Zod schemas (use `@json-render/shadcn` as base, extend with custom components)
2. **Build API endpoint** — Accept prompt, call LLM with catalog context, stream JSON Patch response
3. **Render client-side** — `useUIStream` hook handles connection, progressive rendering, error states
4. **Add interactivity** — Define event handlers (`on`) and state bindings (`watch`) in spec
5. **Production path** — Use `@json-render/codegen` to convert proven specs to static JSX

### Catalog Design Principles

- **Constrain props tightly** — `z.enum()` over bare `z.string()` where possible
- **Set max lengths** — `z.string().max(100)` prevents AI from generating walls of text
- **Avoid `z.any()`** — Every prop should have a specific type
- **Limit children depth** — Use `children: false` for leaf components
- **Match your design system** — Catalog component variants should mirror your design tokens

Full catalog patterns: Read `json-render` skill at `skills/json-render/`

## Architecture Pattern: Production App UI

For production user-facing UIs:

```
Designer creates spec template → AI personalizes per user → Codegen → Review → Deploy
```

1. **Template catalog** — Define domain-specific components (ProductCard, OrderSummary, NotificationBanner)
2. **AI personalization** — LLM fills template spec with user-specific data and copy
3. **Codegen to JSX** — `@json-render/codegen` produces reviewable React components
4. **Code review** — Standard PR review process (no runtime AI interpretation in prod)
5. **Deploy** — Static JSX, deterministic, testable

## Integration with Existing Skills

| Skill | How It Connects |
|-------|----------------|
| `json-render` | Core framework patterns — catalogs, specs, streaming, codegen |
| `shadcn` | Component library that `@json-render/shadcn` wraps |
| `design-system-tokens` | Token values map to catalog prop constraints |
| `stitch` | Design-first alternative for prototyping (Figma-targeted) |
| Claude Design (claude.ai/design) | External — design-first generator with handoff bundle → Claude Code. Use when target is CC, not Figma. No plugin/skill yet (API not public). |
| `agent-browser` | Test rendered json-render output in headless browser |
| `prototype-to-production` | Convert Stitch/design prototypes to json-render catalogs |
| `cover` (etk) | E2E test generated UIs with Playwright |
| `streaming-api-patterns` (ai-toolkit) | SSE patterns for json-render streaming endpoint |
