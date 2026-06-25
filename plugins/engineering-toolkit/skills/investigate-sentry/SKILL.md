---
name: investigate-sentry
description: "Investigate and triage Sentry issues with structured analysis. Fetches issue data via Sentry API (1Password CLI for auth), aggregates event patterns (releases, browsers, users, environments), cross-references AWS CloudWatch Lambda metrics, and produces an assessment document with root cause hypotheses, decision matrix, and open questions. Use when: a Sentry issue needs investigation before deciding on a fix, you want to understand event distribution patterns, you need server-side AWS cross-correlation, or you want a structured assessment to share with the team. Triggers on: investigate-sentry, sentry issue, sentry triage, sentry investigation"
effort: xhigh
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.py"
  - "**/*.js"
  - "docs/sentry-*.md"
context: fork
---

# Investigate Sentry Issue

Structured investigation: pull Sentry data via API, aggregate patterns, cross-reference AWS, produce an assessment doc with decision matrix.

**Core principle: Investigate before fixing. Present evidence and options, not premature solutions.**

## Workflow

### 1. Parse input

Extract from arguments:
- **Short ID** (e.g., `APP-2Y`) or **full Sentry URL**
- **Flags**: `--skip-aws` (skip CloudWatch), `--verbose` (raw API data)

### 2. Authenticate

Read token via `op` CLI, fall back to `$SENTRY_AUTH_TOKEN` env var.

See `${CLAUDE_SKILL_DIR}/references/sentry-api.md` for auth pattern and error handling.

### 3. Fetch Sentry data

Call four API endpoints in sequence:
1. Resolve short ID to numeric issue ID (search endpoint)
2. Get issue metadata (title, status, priority, counts, first/last seen)
3. Get events with full context (up to 100)
4. Get tag distributions (release, browser, OS, environment, URL)

See `${CLAUDE_SKILL_DIR}/references/sentry-api.md` for endpoints and response parsing.

### 4. Aggregate and analyze

From the raw event data, build:

- **Event timeline table** — one row per event with de-identified user, release prefix, browser, URL
- **Distribution analysis** — releases, browsers, environments, users, routes
- **Pattern detection**:
  - >70% events share a release → potential regression
  - >70% events share a browser → browser-specific
  - >70% events share a route → route-specific
  - Scattered across all dimensions → environmental/transient

### 5. AWS cross-reference (optional)

Skip if `--skip-aws` set or error is purely client-side.

Extract Lambda name from project/tags, query CloudWatch for duration percentiles and error counts, compare client timeout vs server p99.

See `${CLAUDE_SKILL_DIR}/references/aws-cross-reference.md` for queries and timeout analysis.

### 6. Synthesize

Produce:
- **Root cause hypotheses** ranked by likelihood with supporting/contradicting evidence
- **Decision matrix** (effort/risk/value) from "do nothing" to "full fix"
- **Open questions** the team needs to answer
- **Plain-English recommendation** with reasoning

### 7. Write assessment document

Output to `docs/sentry-{short-id-lowercase}-assessment.md`.

Follow template in `${CLAUDE_SKILL_DIR}/references/assessment-template.md`.

### 8. Present results

Show TL;DR + recommendation + file path. Suggest next steps:
- Share with team for decision
- `/fix-bug` if fix approved
- Instrumentation option if more data needed

## HIPAA Guardrails

This skill processes production error data. Strict rules:

- **De-identify users**: last 12 chars of ID only, never emails/names/IPs
- **No request/response bodies**: may contain PHI or other sensitive user data
- **No breadcrumb payloads**: summarize types and timing, not content
- **Aggregates only**: counts and distributions, never individual user journeys
- **Release hashes**: first 8 characters only

See `${CLAUDE_SKILL_DIR}/references/assessment-template.md` for full de-identification rules.

## Integration Points

| Command | Relationship |
|---------|-------------|
| `/fix-bug` | Downstream: investigation feeds into bug-fix workflow |
| `/auto-research` | Can route here when given a Sentry issue ID |
| `/verify` | Confirm the fix after implementation |
| `/etk:atlassian-integration` | Link findings to Jira tickets |

## Reference Files

- `${CLAUDE_SKILL_DIR}/references/sentry-api.md` — API endpoints, auth, error handling
- `${CLAUDE_SKILL_DIR}/references/aws-cross-reference.md` — CloudWatch queries, timeout analysis
- `${CLAUDE_SKILL_DIR}/references/assessment-template.md` — Output document template, HIPAA de-identification rules
