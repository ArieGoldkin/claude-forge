# agent-browser Migration Guide

> Historical migration notes. For the **current** command surface on your installed version, run `agent-browser skills get core --full`; for the full release history, see upstream `CHANGELOG.md`. This guide is curated through **v0.27.3**.

## Table of Contents

- [v0.20.0: 100% Native Rust](#v0200-100-native-rust-major-breaking-change)
- [v0.22.0: Network and Dialog Enhancements](#v0220-network--dialog-enhancements)
- [v0.22.2: Proxy Improvements](#v0222-proxy-improvements)
- [v0.22.3: Keyboard and Recording Fixes](#v0223-keyboard--recording-fixes)
- [v0.24.0: AWS Bedrock AgentCore Provider](#v0240-aws-bedrock-agentcore-provider)
- [v0.24.1: Chrome Profile Reuse](#v0241-chrome-profile-reuse)
- [v0.25.0: AI Chat and Batch Args](#v0250-ai-chat-and-batch-args)
- [v0.25.1 / v0.25.4: Embedded Dashboard and Skills](#v0251--v0254-embedded-dashboard-and-skills)
- [v0.26.0: doctor, Stable Tabs, core Skill](#v0260-doctor-stable-tabs-core-skill)
- [v0.27.0: React Introspection and Web Vitals](#v0270-react-introspection-and-web-vitals)
- [Version Compatibility](#version-compatibility)

## v0.20.0: 100% Native Rust (Major Breaking Change)

The Node.js/Playwright daemon was completely removed. The entire stack is now native Rust.

### What Changed

| Before (< v0.20) | After (v0.20+) |
|---|---|
| Rust CLI + Node.js daemon | 100% Native Rust |
| 710 MB install | 7 MB install |
| 143 MB daemon memory | 8 MB daemon memory |
| 1002ms cold start | 617ms cold start |
| Node.js required | No Node.js dependency for daemon |

### Migration Steps

- No API changes needed -- commands are backward compatible
- Remove any Node.js daemon configurations
- Video recording codec changed to VP9 (WebM)

## v0.22.0: Network & Dialog Enhancements

- `network request <id>` -- view full request details
- `network requests --type/--method/--status` -- request filtering
- `-C`/`--cursor` snapshot flag deprecated (cursor elements included by default)
- Cross-origin iframe support via Target.setAutoAttach

## v0.22.2: Proxy Improvements

- Proxy fallback to standard env vars (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`)
- Proxy authentication via CDP Fetch.authRequired
- `dialog status` command

## v0.22.3: Keyboard & Recording Fixes

- `keyboard inserttext` for IME-style input
- Download behavior fixes during recording
- Stability improvements

## v0.24.0: AWS Bedrock AgentCore Provider

- `--provider agentcore` (or `AGENT_BROWSER_PROVIDER=agentcore`) — AWS Bedrock AgentCore cloud browser
- SigV4 auth via the full AWS credential chain (env vars, CLI, SSO, IAM roles); configure with `AGENTCORE_REGION`, `AGENTCORE_PROFILE_ID`, `AGENTCORE_BROWSER_ID`

## v0.24.1: Chrome Profile Reuse

- `--profile <name>` resolves Chrome profile names (e.g. `Default`, `Profile 1`) and copies the profile to a temp dir to reuse login state/cookies/extensions without mutating the original
- New `profiles` command lists available Chrome profiles (`--json`)

## v0.25.0: AI Chat and Batch Args

- `chat` command — AI-powered automation, single-shot (`chat "open google.com"`) or interactive REPL; requires `AI_GATEWAY_API_KEY`, model via `--model`/`AI_GATEWAY_MODEL`
- `snapshot --urls`/`-u` — include link hrefs in snapshot output
- `batch` now accepts inline arguments in addition to stdin

## v0.25.1 / v0.25.4: Embedded Dashboard and Skills

- Observability dashboard bundled into the binary (`rust-embed`) — no `dashboard install`; available on port 4848 immediately
- `skills` command — discover/install agent skills, with eval support against live sessions

## v0.26.0: doctor, Stable Tabs, core Skill

- `doctor` command — one-shot install diagnosis (env, Chrome, daemons, config, security, providers, network, live launch); `--offline`/`--quick`/`--fix`/`--json`
- **Stable tab ids** (`t1`, `t2`, …) that don't shift; `tab new --label <name>`; `tab <id|label>` everywhere a tab ref is accepted. **Bare integers are now rejected.**
- Built-in `agent-browser` skill renamed to `core` and expanded into a full usage guide; `agent-browser skills get core [--full]`
- `agent-browser.schema.json` — JSON Schema for config files

## v0.27.0: React Introspection and Web Vitals

- React DevTools integration: `react tree`, `react inspect <fiberId>`, `react renders start|stop`, `react suspense`; requires `--enable react-devtools` at launch
- `vitals [url]` — Core Web Vitals (LCP, CLS, TTFB, FCP, INP) + React hydration phases
- `pushstate <url>` — client-side SPA navigation
- `--init-script <path>` (repeatable; `AGENT_BROWSER_INIT_SCRIPTS`) and `--enable <feature>` (repeatable; `AGENT_BROWSER_ENABLE`)
- `network route --resource-type <csv>` — filter intercepts by CDP resource type
- `cookies set --curl <file>` — bulk cookie import (auto-detects JSON, cURL, Cookie-header)
- Dashboard works from proxied origins (same-origin proxy)

## Version Compatibility

| Feature | Minimum Version |
|---|---|
| Cloud providers | v0.7.0+ |
| iOS Simulator | v0.9.0 |
| Config file support | v0.11.0 |
| Annotated screenshots | v0.12.0 |
| Diff commands | v0.13.0 |
| Keyboard command | v0.14.0 |
| Security features | v0.15.0 |
| Clipboard commands | v0.19.0 |
| Native Rust daemon | v0.20.0 |
| Batch command | v0.21.0 |
| Self-update (`upgrade`) / HAR capture | v0.21.1 |
| Network filtering | v0.22.0 |
| Proxy env fallback | v0.22.2 |
| AgentCore provider | v0.24.0 |
| Chrome profile reuse / `profiles` | v0.24.1 |
| `chat` / `snapshot --urls` / batch args | v0.25.0 |
| Embedded dashboard | v0.25.1 |
| `skills` command | v0.25.4 |
| `doctor` / stable tab ids / `core` skill | v0.26.0 |
| React introspection / `vitals` / `pushstate` | v0.27.0 |
