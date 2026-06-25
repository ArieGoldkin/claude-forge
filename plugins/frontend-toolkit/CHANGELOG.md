# Changelog

All notable changes to the frontend-toolkit (`ftk`) plugin will be documented in this file.

## [2.3.6] - 2026-06-25 — rebrand to Claude Forge

Suite renamed `claude-dev-kit` → **Claude Forge**. Updated repository/homepage URLs, the `continuity-recommendation` hook's install hint (`/plugin install ctk@claude-forge`), explainer-video references, and install commands; dist rebuilt. Re-add the marketplace and reinstall as `ftk@claude-forge`.


## [2.3.5] - 2026-06-24 — genericize company-specific domain references

Part of a monorepo-wide pass removing company-specific domain references and genericizing example data across every plugin.

### Changed

- **`explainer-video`**: re-themed the worked examples — member-lifecycle FSM → subscription-lifecycle (asset file renamed) and the event-lambda architecture genericized.
- **`agentation` + `ai-ui-generation`**: genericized the examples to drop company framing.

## [2.3.4] - 2026-06-19 — security: trust-boundary notes; MCP dep audit + SDK pin

Skills-security audit hardening (`docs/reviews/2026-06-19_skills-security-audit.md`).

### Security

- **Trust-boundary notes** added to `browser-content-capture` (captured page text is untrusted data; use `--content-boundaries`) and `stitch` (Gemini-generated markup is untrusted content — prompt-injection risk, review before adopting; not XSS).
- **MCP workspace**: pinned `@google/stitch-sdk` to an exact version (it handles the API key). The MCP advisories themselves are unreachable (stdio-only transport); a non-blocking `mcp-audit` CI job for visibility is staged separately.

## [2.3.3] - 2026-06-17 — agent-browser: refresh to upstream Vercel v0.27.3

### Changed

- **`agent-browser` skill docs synced from v0.22.x → v0.27.3** (`SKILL.md`, `references/commands.md`, `references/protocol-alignment.md`). Adds v0.24–v0.27 coverage: React introspection, Web Vitals, the doctor/chat/skills subsystems, and stable `t1`/`t2` tab ids. Corrects the `snapshot -s` documentation bug (it scopes the snapshot to a CSS-selector subtree, not a "structure-only DOM tree"). Upstream `--provider agentcore` (AWS Bedrock cloud browser) coverage is retained — it is an upstream agent-browser feature, not company infrastructure.

## [2.3.2] - 2026-06-14 — first open-source release

Frontend development, UI/UX design, browser automation, and Remotion explainer videos. 16 skills, 4 agents, 11 commands.

### Highlights

- React, Figma, Google Stitch AI, shadcn/ui, design systems, browser automation, and block-based + bespoke explainer-video generation.
- MIT licensed.

_First public release at 2.3.2; earlier version history was internal and has been omitted._
