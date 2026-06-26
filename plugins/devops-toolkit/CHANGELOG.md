# Changelog

All notable changes to the devops-toolkit (`dtk`) plugin will be documented in this file.

## [2.0.9] - 2026-06-26 — adopt Claude Code OTEL telemetry in observability-monitoring

Documents the new Claude Code OpenTelemetry surface (CC alignment v2.1.193) in the `observability-monitoring` skill: the `model` attribute on metrics (CC v2.1.180) for per-model cost/latency breakdowns, and the `claude_code.assistant_response` log event (CC v2.1.193, redacted unless `OTEL_LOG_ASSISTANT_RESPONSES=1`). Skill-content only; no hook/dist change.


## [2.0.8] - 2026-06-25 — rebrand to Claude Forge

Suite renamed `claude-dev-kit` → **Claude Forge**. Updated repository/homepage URLs, the `continuity-recommendation` hook's install hint (`/plugin install ctk@claude-forge`), schema `$id` URLs, and install commands; dist rebuilt. Re-add the marketplace and reinstall as `dtk@claude-forge`.


## [2.0.7] - 2026-06-24 — genericize company-specific domain references

Part of a monorepo-wide pass removing company-specific domain references and genericizing example data across every plugin.

### Changed

- **`salesforce-integration-patterns`**: genericized the skill/command description and instruction examples (member/subscription framing → neutral domain).
- **`aws-cli-toolkit`**: replaced a hardcoded AWS account ID with the standard `123456789012` placeholder across the examples.
- **Shared skills** (`postgresql`, `coding-standards`, `ascii-visualizer`): genericized example data to a neutral domain.

## [2.0.6] - 2026-06-19 — security: SOQL-injection example fix; drop dangling reference links

Skills-security audit hardening (`docs/reviews/2026-06-19_skills-security-audit.md`).

### Security

- **`salesforce-integration-patterns`**: the User Sync example now validates the interpolated external ID before building the SOQL string (simple_salesforce has no bind-parameter API), with an upsert-by-external-id alternative — the prior f-string SOQL modeled an injectable pattern. Replaced the 5 dangling `references/` links with an inline Security Notes section (SOQL injection, webhook HMAC, least privilege).

## [2.0.5] - 2026-06-14 — first open-source release

DevOps, infrastructure, and backend development: AWS, Terraform, CI/CD, Salesforce, Lambda container patterns, and Husky pre-commit setup. 15 skills, 2 agents, 13 commands, plus the `repo-access-guard` hook.

### Highlights

- **`repo-access-guard`** restricts configured repos to AWS Bedrock users; ships with an empty default policy (`bedrock_only: []`) — add your own patterns via `.claude/repo-access-policy.json`.
- MIT licensed.

_First public release at 2.0.5; earlier version history was internal and has been omitted._
