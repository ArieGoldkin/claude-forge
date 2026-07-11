---
name: code-review-playbook
description: Structured code review with conventional comments and domain checklists (security, tenant isolation, sensitive data)
keep-coding-instructions: true
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.py"
  - "**/*.js"
disallowed-tools:
  - Edit
  - Write
  - NotebookEdit
---

# Code Review Playbook

## Overview

Comprehensive code review framework for PRs with security compliance, tenant isolation, and sensitive data handling patterns.

## Quick Start

Use the `/review-mr` command which applies this skill automatically:
```bash
/review-mr <MR_NUMBER>           # Quick check (5-10 min)
/review-mr <MR_NUMBER> --standard # Standard review (10-15 min)
/review-mr <MR_NUMBER> --deep     # Deep review with security audit (15-25 min)
```

---

## Code Review Principles

### Be Kind and Respectful
- Review code, not the person
- Assume positive intent
- Praise good solutions

### Be Specific and Actionable
- Point to exact lines (file:line format)
- Explain *why* changes are needed
- Suggest concrete improvements with code examples

### Balance Speed with Thoroughness
- Provide timely feedback (< 24 hours)
- Use automation for routine checks (mise tasks)
- Focus human review on logic/design

### Distinguish Must-Fix from Nice-to-Have
- Use conventional comments for severity
- Block merges only for critical issues (security, compliance, bugs)

---

## Conventional Comments

Standard format for review comments:

### Format
```
<label> [decorations]: <subject>

[discussion with code examples if applicable]
```

### Labels

| Label | Meaning | Blocks Merge? | Use Case |
|-------|---------|---------------|----------|
| **praise** | Highlight positive | No | Good patterns, clever solutions |
| **nitpick** | Minor suggestion | No | Style preferences, tiny improvements |
| **suggestion** | Propose improvement | No | Better approaches, refactoring ideas |
| **issue** | Problem to address | Usually | Bugs, logic errors, missing tests |
| **question** | Request clarification | No | Unclear intent, need explanation |
| **security** | Security concern | **Yes** | XSS, injection, auth issues, sensitive data exposure, tenant isolation |
| **bug** | Potential bug | **Yes** | Crashes, incorrect behavior |
| **breaking** | Breaking change | **Yes** | API changes, incompatible updates |

### Decorations

| Decoration | Meaning |
|------------|---------|
| **[blocking]** | Must be addressed before merge |
| **[non-blocking]** | Optional, can be deferred |
| **[if-minor]** | Only if quick fix (< 5 min) |

**For detailed examples of each label:** See [references/conventional-comments-examples.md](${CLAUDE_SKILL_DIR}/references/conventional-comments-examples.md)

---

## Structured Review Output

Agent findings use a structured format with confidence scoring for consistent, filterable results.

**Finding format**: Type, Confidence (0-100), Blocking (yes/no), File:Line, Evidence

**Confidence tiers**: 90-100 (verified by tool) | 70-89 (clear pattern) | 50-69 (suspicious) | <50 (speculative)

**Filtering**: Findings below confidence threshold (default 70) are excluded. Configurable via `.claude/policies/review-policy.json`.

**Anti-FP rules**: Linter-catchable (->50), pre-existing code (->30), intentional suppression (->40). Security findings exempt from filters 2-3.

**Details**: See [references/structured-output-format.md](${CLAUDE_SKILL_DIR}/references/structured-output-format.md) and [references/false-positive-filtering.md](${CLAUDE_SKILL_DIR}/references/false-positive-filtering.md)

---

## Commit Message Reasoning

When making commits, include reasoning to document the "why" alongside the "what".

### Template

```
<type>: <short description>

WHY: <business or technical reason for the change>
DECISION: <key choice made>
ALTERNATIVES: <what was considered and rejected>
```

### Types

| Type | Use For |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructure without behavior change |
| `docs` | Documentation only |
| `test` | Adding/updating tests |
| `chore` | Build, tooling, dependencies |

**For detailed examples:** See [references/commit-message-examples.md](${CLAUDE_SKILL_DIR}/references/commit-message-examples.md)

---

## Review Process

### 1. Pre-Review (1-2 min)

- Read PR description (what/why/how)
- Check CI/CD status (all checks must pass)
- Estimate time:
  - < 200 lines: 15-30 min
  - 200-500 lines: 30-60 min
  - 500+ lines: Request split into smaller PRs

### 2. High-Level Review (5-10 min)

- Skim all files for overview
- Verify approach makes sense
- Check affected domains (frontend/backend/database)
- Identify security concerns (sensitive data handling, tenant isolation)

### 3-4. Detailed Review & Submit

**For detailed review steps (code quality, functionality, testing, security) and submit guidance:** See [references/review-process-detailed.md](${CLAUDE_SKILL_DIR}/references/review-process-detailed.md)

---

## Quick Checklists

### Security Basics

- [ ] No hardcoded secrets (API keys, passwords)
- [ ] Protected endpoints require auth
- [ ] Authorization checks present
- [ ] SQL injection prevented (parameterized queries)
- [ ] XSS prevented (proper escaping)
- [ ] Input validated and sanitized

### Multi-Tenant Security

- [ ] Sensitive data not logged (no emails, names, PII in logs)
- [ ] All queries filter by tenant ID (tenant isolation)
- [ ] Tests verify tenant isolation (negative tests)
- [ ] Migration included if schema changed

---

## Review Metrics & Feedback

| Metric | Target |
|--------|--------|
| **Review Time** | < 24 hours |
| **PR Size** | < 400 lines |
| **Comments per PR** | 3-10 |

**For detailed feedback patterns, comment templates, and warning signs:** See [references/feedback-patterns.md](${CLAUDE_SKILL_DIR}/references/feedback-patterns.md)

---

## Integration with `/review-mr` Command

This skill is automatically used by the `/review-mr` command:

**Quick Mode (default):**
- Auto-fixes formatting
- Runs automated checks
- Inline review with conventional comments

**Standard Mode (`--standard`):**
- All quick mode checks
- 6 parallel agents (quality, types, security, tests, backend, frontend)

**Deep Mode (`--deep`):**
- All standard mode checks
- 2 additional specialists (security auditor, database architect)

**Command usage:**
```bash
/review-mr 123              # Quick
/review-mr 123 --standard   # Standard
/review-mr 123 --deep       # Deep with security audit
```

---

## References

**Detailed Reference Files:**
- [Conventional Comments Examples](${CLAUDE_SKILL_DIR}/references/conventional-comments-examples.md) - Extended examples for each label
- [Commit Message Examples](${CLAUDE_SKILL_DIR}/references/commit-message-examples.md) - Feature, bugfix, and security commit examples
- [Review Process Detailed](${CLAUDE_SKILL_DIR}/references/review-process-detailed.md) - Deep analysis steps and submit guidance
- [Feedback Patterns](${CLAUDE_SKILL_DIR}/references/feedback-patterns.md) - Feedback principles, comment templates, warning signs
- [Structured Output Format](${CLAUDE_SKILL_DIR}/references/structured-output-format.md) - Confidence scoring, finding format, filtering rules
- [Finder Angles](${CLAUDE_SKILL_DIR}/references/finder-angles.md) - Correctness (A–E incl. wrapper/proxy), cleanup (reuse/simplify/efficiency/altitude), and Conventions/CLAUDE.md hunting lenses
- [False Positive Filtering](${CLAUDE_SKILL_DIR}/references/false-positive-filtering.md) - Anti-FP rules for linter-catchable, pre-existing, intentional + security-finding validity precedents
- [Architectural Review Dimensions](${CLAUDE_SKILL_DIR}/references/architectural-review-dimensions.md) - 5-dimension scoring rubric (Scalability, Data Integrity, Security, Ops, Coherence)
- [Agent Review Templates](${CLAUDE_SKILL_DIR}/references/agent-review-templates.md) - Shared format templates for all review agents
- [Business Invariants — Authoring](${CLAUDE_SKILL_DIR}/references/business-invariants-authoring.md) - Canonical `.claude/business-invariants.md` format, 3-question test, per-rule schema, anti-patterns
- [Business Invariants — Intake Template](${CLAUDE_SKILL_DIR}/references/business-invariants-intake-template.md) - Relaxed contributor template for collecting candidate rules from a team
- [Business Invariants — Aggregation Playbook](${CLAUDE_SKILL_DIR}/references/business-invariants-aggregation.md) - Turning team contributions into the clean contract (dedup, verify, promote)
- [Load Business Invariants](${CLAUDE_SKILL_DIR}/references/load-business-invariants.md) - Shared loader logic (review-time + planning-time consumers)

**Related Skills:**
- `testing-strategy-builder` - Test coverage planning

**Related Commands:**
- `/review-mr` - Automated MR review with tiered depth
- `/brainstorm` - Design features with architectural patterns

---

**Skill Version**: 4.0.0 (Structured Scoring + Anti-FP Filtering)
**Last Updated**: 2026-02-27
**Token Optimization**: 473 lines -> ~210 lines (detailed content moved to reference files)
