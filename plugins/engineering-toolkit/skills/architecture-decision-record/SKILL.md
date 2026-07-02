---
name: architecture-decision-record
description: Architecture Decision Records — Nygard templates, context/decision/consequences, lifecycle, and trade-off evaluation. Triggers on ADR, architecture decision, design decision, Nygard, record a decision, decision record, document a trade-off
effort: low
keep-coding-instructions: true
---

# Architecture Decision Record

## Overview

Architecture Decision Records (ADRs) are lightweight documents that capture important architectural decisions along with their context and consequences. This skill provides templates, examples, and best practices for creating and maintaining ADRs in your projects.

## Why ADRs Matter

ADRs serve as architectural memory for your team:
- **Context Preservation**: Capture why decisions were made, not just what was decided
- **Onboarding**: Help new team members understand architectural rationale
- **Prevent Revisiting**: Avoid endless debates about settled decisions
- **Track Evolution**: See how architecture evolved over time
- **Accountability**: Clear ownership and decision timeline

## ADR Format (Nygard Template)

Each ADR should follow this structure:

### 1. Title
Format: `ADR-####: [Decision Title]`
Example: `ADR-0001: Adopt Microservices Architecture`

### 2. Status
Current state of the decision:
- **Proposed**: Under consideration
- **Accepted**: Decision approved and being implemented
- **Superseded**: Replaced by a later decision (reference ADR number)
- **Deprecated**: No longer recommended but not yet replaced
- **Rejected**: Considered but not adopted (document why)

### 3. Context
**What to include:**
- Problem statement or opportunity
- Business/technical constraints
- Stakeholder requirements
- Current state of the system
- Forces at play (conflicting concerns)

Lead with the problem statement, then layer in business requirements and technical constraints. Quantify where possible (e.g., "45-minute build times", "10x traffic growth").

### 4. Decision
**What to include:**
- The choice being made
- Key principles or patterns to follow
- What will change as a result
- Who is responsible for implementation

Be specific and actionable. Break into technology stack, boundaries, migration strategy, and responsibility.
- "We will adopt microservices architecture using Node.js with Express"
- Not: "We will consider using microservices"

### 5. Consequences
**What to include:**
- Positive outcomes (benefits)
- Negative outcomes (costs, risks, trade-offs)
- Neutral outcomes (things that change but aren't clearly better/worse)

Be honest about trade-offs. Organize into Positive, Negative, and Neutral subsections. Include timeline impacts and quantified trade-offs where possible.

### 6. Alternatives Considered
Document at least 2 alternatives. For each, include a description, pros, cons, and why it was not chosen.

For detailed examples of each section, see [references/adr-writing-guide.md](${CLAUDE_SKILL_DIR}/references/adr-writing-guide.md).

### 7. References (Optional)
Links to relevant resources:
- Meeting notes or discussion threads
- Related ADRs
- External research or articles
- Proof of concept implementations

## ADR Lifecycle

```
Proposed → Accepted → [Implemented] → (Eventually) Superseded/Deprecated
          ↓
      Rejected
```

**State Transitions:**
1. **Proposed**: Draft created, under review
2. **Accepted**: Team agrees, implementation can begin
3. **Implemented**: Decision is live in production
4. **Superseded**: Replaced by new ADR (add reference)
5. **Deprecated**: No longer recommended (migration path documented)
6. **Rejected**: Not adopted (reasoning captured)

## Best Practices

### 1. **Keep ADRs Immutable**
Once accepted, don't edit ADRs. Create new ADRs that supersede old ones.
- ✅ Create ADR-0015 that supersedes ADR-0003
- ❌ Update ADR-0003 with new decisions

### 2. **Write in Present Tense**
ADRs are historical records written as if the decision is being made now.
- ✅ "We will adopt microservices"
- ❌ "We adopted microservices"

### 3. **Focus on 'Why', Not 'How'**
ADRs capture decisions, not implementation details.
- ✅ "We chose PostgreSQL for relational consistency"
- ❌ "Configure PostgreSQL with these specific settings..."

### 4. **Review ADRs as Team**
Get input from relevant stakeholders before accepting.
- Architects: Technical viability
- Developers: Implementation feasibility
- Product: Business alignment
- DevOps: Operational concerns

### 5. **Number Sequentially**
Use 4-digit zero-padded numbers: ADR-0001, ADR-0002, etc.
Maintain a single sequence even with multiple projects.

### 6. **Store in Git**
Keep ADRs in version control alongside code:
- **Location**: `/docs/adr/` or `/architecture/decisions/`
- **Format**: Markdown for easy reading
- **Branch**: Same branch as implementation

## Quick Start Checklist

- [ ] Copy ADR template from `${CLAUDE_SKILL_DIR}/templates/adr-template.md`
- [ ] Assign next sequential number (check existing ADRs)
- [ ] Fill in Context: problem, constraints, requirements
- [ ] Document Decision: what, why, how, who
- [ ] List Consequences: positive, negative, neutral
- [ ] Describe at least 2 Alternatives: what, pros/cons, why not chosen
- [ ] Add References: discussions, research, related ADRs
- [ ] Set Status to "Proposed"
- [ ] Review with team
- [ ] Update Status to "Accepted" after approval
- [ ] Link ADR in implementation PR
- [ ] Update Status to "Implemented" after deployment

## Reviewing an ADR

When reviewing a proposed ADR (your own or a teammate's), use the [ADR Review Checklist](${CLAUDE_SKILL_DIR}/checklists/adr-review-checklist.md) — per-section content-quality checks (context / decision / consequences / alternatives / references), architecture-review criteria (technical viability, business alignment, operational considerations, compliance), stakeholder sign-off, common review feedback, and ADR rejection criteria.

## Examples

See `${CLAUDE_SKILL_DIR}/examples/` for complete ADR samples:
- `adr-0001-adopt-microservices.md` - System architecture decision
- `adr-0002-choose-postgresql.md` - Database selection
- `adr-0003-api-versioning-strategy.md` - API design pattern

## Related Skills

- **api-design-framework**: Use when designing APIs referenced in ADRs
- **database-schema-designer**: Use when ADR involves database choices
- **security-checklist**: Consult when ADR has security implications

## Integration with Agents

### Backend System Architect
- Creates ADRs when designing major system components
- References ADRs when making related architectural decisions
- Reviews ADRs for consistency with overall architecture

### Code Quality Reviewer
- Validates that significant changes have corresponding ADRs
- Ensures implementation aligns with accepted ADRs
- Flags when ADR may need to be superseded

---

**Skill Version**: 1.0.0
**Last Updated**: 2025-10-31
**Maintained by**: Engineering Team
