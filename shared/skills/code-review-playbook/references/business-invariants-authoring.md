# Authoring `.claude/business-invariants.md`

> Audience: a Claude Code session in a project that wants to be reviewed by `/etk:review-mr`'s Business Context Reviewer (Agent #10), or a human author drafting/refactoring the file.
>
> Goal: produce a file the agent can mechanically consume — one rule per invariant, no audit residue, no open questions, no draft markers. **A guideline, not a report.**
>
> **Building this file collaboratively across a team?** See `business-invariants-aggregation.md` (the contribution + aggregation process) and `business-invariants-intake-template.md` (the relaxed contributor template). Teammates draft candidates in a separate staging file; the aggregation pass verifies and promotes vetted rules into the contract described here. Do not let the staging surface and this contract merge — `[UNVERIFIED]` content in this file produces false-positive review findings.

## What this file IS

A **contract**: the non-negotiable properties of the project's domain that any code change must preserve. Reviewers (human + Agent #10) cite violations of this file by ID. If a rule is in the file, the rule is the law for that project.

## What this file is NOT

| Not this | Why |
|----------|-----|
| An audit report | "We found 5 violations of V.1 on 2026-04-29" rots the moment they're fixed; nobody updates the table. Audit findings → **tickets**, not contract rows. |
| A research backlog | "Open question: does Cognito enforce TTL ≤ 1hr?" is a TODO, not a rule. Open questions → **tickets**, not contract rows. |
| A draft / brainstorming surface | `[UNVERIFIED]`, `[KNOWN GAP]`, `[NOTE]` annotations dilute every rule's authority. Either the rule is real (drop the annotation) or it isn't (drop the rule). |
| A style guide / best-practices doc | "Components should be under 200 lines" fails the 3-question test below. Style → CLAUDE.md / linter rules. |
| A roadmap or maturity doc | "We plan to add encryption in transit Q3" is not a current property of the system. The contract describes what IS, not what WILL BE. |

## The 3-question test

A rule earns a place ONLY by passing all three. If any answer is "no" or "I don't know yet," it does not belong in the file (yet).

1. **Specific failure mode**: Can you complete the sentence "If false, X is broken"? (No vague consequences. "Things might be slow" fails. "Connection-pool exhausts under load" passes.)
2. **Deploy-blocker on violation**: Would you halt a deploy on a confirmed violation? (No "soft preferences." If reasonable people would let it ship, it's not an invariant.)
3. **Project-wide truth**: Is the rule true across the whole codebase, not just one feature? (Feature-specific rules go in feature docs / ADRs, not here.)

If a rule fails any of the three but you suspect it's important: open a ticket. Do not park it in this file with `[UNVERIFIED]`.

## Required structure

The file MUST contain only:

1. **A short header** stating purpose, format, and the 3-question test.
2. **Numbered sections** grouped by domain (e.g., I. Privacy/Compliance, II. Auth, III. State Machines, IV. Data Modeling).
3. **Rules within each section**, identified `<Section>.<Number>` (e.g., I.1, II.3) — the ID is the citation handle the review agent uses.
4. **Optional final section "How `/review-mr` uses this file"** — keep it short; reviewers don't need internals.

**Minimum size**: aim for ≥5 rules across at least 2 domains. Below 5, the Business Context Reviewer flags the file as sparse and warns that coverage will be incomplete.

The file MUST NOT contain:

- `## IX. Active Violations Found` or any audit-results section
- `## X. Open Questions` or any unresolved-research section
- Status banners like `> Status: v0.1 draft. Generated from codebase audit.`
- `[VIOLATIONS FOUND]`, `[UNVERIFIED]`, `[KNOWN GAP]`, `[NOTE]` annotations on rules
- Commentary about how the file was generated, when it was last audited, or who owns it (this belongs in git log + CODEOWNERS)
- TODOs, "see open question N", or "verify with team"

## Per-rule schema

Every rule has exactly these fields. No more, no less.

```markdown
### I.1 — <One-sentence rule name>

<One-paragraph imperative statement of the rule. MUST / MUST NOT phrasing.>

- **Violation:** <one-sentence concrete consequence — what specifically breaks>
- **Enforcement:** <one or more tags from the vocabulary below>
- **Evidence:** <file:line citation(s) supporting the rule>
- **Exempt only with:** <if applicable, the documented escape hatch — comment marker, ADR reference, etc.>
```

That is the full schema. No `[STRONG]`, no `Applies to: ...`, no narrative footnotes. If the rule needs prose to explain, the rule is too vague.

### Enforcement vocabulary

Use these exact tags. They tell the reviewer what kind of violation to expect:

| Tag | Meaning |
|-----|---------|
| `[DB]` | Database constraint, trigger, CHECK, unique index. Strongest form. |
| `[Code]` | Application code path verified to enforce the rule (cite the path). |
| `[Hook/Grep]` | Caught automatically by `/review-mr` Phase 3 grep checks or a CI hook. |
| `[External]` | Enforced outside the codebase: cloud config, IaC, IDP, third-party platform. |
| `[Convention]` | Relies on developer discipline + reviewer catch. **Weakest form.** Goal: promote `[Convention]` to one of the others over time. |

A rule MAY carry multiple tags (e.g., `[Code] + [Hook/Grep]`). Order strongest → weakest.

### The promotion ladder

Every `[Convention]` is technical debt. When you can:

- promote to `[Hook/Grep]` (write a grep / lint rule), or
- promote to `[Code]` (add a runtime guard), or
- promote to `[DB]` (add a schema constraint),

do it, and update the tag. The contract gets stronger. Don't add new `[Convention]` rules without first asking "could this be a `[Hook/Grep]` instead?"

## What to do with audit findings

When you discover concrete violations (V.1 broken in 5 lambdas, VII.1 broken in `User.__repr__`):

1. **File a ticket per violation** with file:line + invariant ID + suggested fix.
2. **Do NOT** add a "violations found" table to the invariants file. The contract is forward-facing; tickets carry the backward-facing cleanup.
3. The ticket can reference the invariant ID in the title (e.g., "Fix V.1 violation in lifecycle-stage-handler:385").

This way: tickets get owners, dates, and a closeable state. The contract stays clean. Future audits find the next batch of violations without conflicting with last year's table.

## What to do with open questions

When you draft a rule but can't verify it from the codebase alone (e.g., "JWT TTL ≤ 1 hour" — depends on Cognito config you haven't inspected):

**Three options, in order of preference:**

1. **Verify before shipping.** Read the IaC / config / external system. Confirm or deny. Then either commit the rule with `[External]` tag OR drop it.
2. **File a ticket** ("Confirm Cognito Pool Access Token Validity ≤ 1h") and DO NOT include the rule in the contract until the ticket is resolved.
3. **Park in a separate file** like `docs/business-invariants-pending.md` if you want a visible TODO list. Keep it OUT of `business-invariants.md`.

Never ship `[UNVERIFIED]` rules. The Business Context Reviewer (Agent #10) treats every rule in the file as authoritative. An `[UNVERIFIED]` rule either makes the agent emit false positives ("the diff doesn't comply with a rule we're not sure exists") or trains the agent to ignore the annotation, weakening every other rule.

## Severity / blocking is per-violation, not per-rule

Rules are flat — every rule in the file is a non-negotiable property. The reviewer assigns severity per **finding**, based on the specific consequence in that diff context. Don't try to encode severity in the rule itself with markers like `[CRITICAL]` or `[BLOCKING]`. The `Violation:` line states the consequence; the reviewer uses that to decide blocking.

## Anti-patterns to avoid

Drawn from real first-draft invariants files, with the corrected shape next to each:

### Anti-pattern 1 — Audit findings inline with rules

```markdown
### V.1 — Database engine initialized at module level
...
- **Enforcement:** [Hook/Grep] + [Convention]
- **[VIOLATIONS FOUND]** — 5 active violations in production code (see Section IX)
```

**Fix:** drop the `[VIOLATIONS FOUND]` line. File 5 tickets. The rule itself stays.

### Anti-pattern 2 — Open questions inline with rules

```markdown
### IV.1 — Webhook events are idempotent by event_id
...
- **[UNVERIFIED]** — verify with team: where is the dedup key? Recommend a `unique` index.
```

**Fix:** the rule is unsafe to ship until the dedup mechanism is verified. Either inspect the code, confirm the dedup key, ship the rule, OR file a ticket and remove the rule from the file until ratified.

### Anti-pattern 3 — Status banner

```markdown
> Status: v0.1 draft (2026-04-29). Generated from codebase audit. Review and ratify before treating as authoritative.
```

**Fix:** remove. The file at any commit either is the contract or it isn't. Ratification happens in PRs; "the rule landed in main" = "the rule is authoritative."

### Anti-pattern 4 — Section "Active Violations Found"

A whole section listing concrete bugs with file:line citations.

**Fix:** delete the section. Migrate every entry to a ticket. The contract describes properties; the ticket tracker tracks bugs.

### Anti-pattern 5 — Section "Open Questions for team review"

A whole section with 9 numbered TODOs.

**Fix:** delete the section. Each open question is either (a) answerable now via code reading — answer it and update the rule, (b) a research ticket — file it, or (c) so unclear it shouldn't be a candidate rule yet.

### Anti-pattern 6 — Style / best-practices smuggled in as rules

```markdown
### VI.1 — Components should be under 200 lines
```

**Fix:** fails the 3-question test (would you block a deploy? no). Move to CLAUDE.md or a linter rule.

### Anti-pattern 7 — Vague rule prose

```markdown
### I.4 — Auth events are properly audited
```

**Fix:** "properly" is vague. Sharpen: "Every login, logout, token-issue, MFA event AND every sensitive-data read/write writes one row to `Event` with timestamp + actor + resource." Concreteness is non-negotiable; if you can't be concrete, file a ticket to figure out what concrete looks like first.

## Authoring checklist

Before you commit `business-invariants.md`, confirm:

- [ ] Every rule answers all 3 questions of the 3-question test
- [ ] No `[VIOLATIONS FOUND]`, `[UNVERIFIED]`, `[KNOWN GAP]`, `[NOTE]` markers anywhere
- [ ] No "Active Violations" section
- [ ] No "Open Questions" section
- [ ] No status banner / draft warning
- [ ] Every rule has the 4 required fields (Violation, Enforcement, Evidence, optional Exempt)
- [ ] Every Enforcement uses the exact vocabulary tags
- [ ] Every Evidence cites a real path:line that exists in the current codebase
- [ ] No vague qualifiers ("properly", "appropriately", "sensibly", "should")
- [ ] No feature-specific rules (test: would this rule still apply if we deleted feature X?)
- [ ] Audit findings have been filed as tickets, not parked in the file
- [ ] Open questions have been filed as tickets, not parked in the file

## How tooling consumes this file

The same file is loaded at two distinct moments in the development workflow.

**Review-time (Agent #10 in `/etk:review-mr`)** — reads the file once per review and:

1. For each rule: scans the diff for code paths in the rule's domain.
2. For each candidate hit: reads enough surrounding context to confirm violation vs. false positive.
3. Emits findings citing the rule ID (`Violates I.1: SELECT in order_lookup.py:42 does not filter by tenant_id`).

**Planning-time (`/etk:brainstorming`, `/etk:develop`, `/etk:fix-bug`)** — loads the file at the moment of design convergence (not session start) so invariants shape the work before code is written:

- `/etk:brainstorming` Phase 2 (Exploration / scoring matrix) — adds an "Invariants compliance" dimension when scoring approaches.
- `/etk:develop` between Phase 3 (Plan) and Phase 4 (Build) — quality gate. The plan is concrete, the code isn't written yet.
- `/etk:fix-bug` Step 2 (Hypothesize), after the hypothesis is generated — checks the proposed fix shape against rules before the ACT step.

If the file is missing, planning-time consumers prompt the user (Create now / Skip session / Skip project) — the create-or-skip fork is the user's choice. The shared loader logic lives at `references/load-business-invariants.md`.

In all cases, every rule in the file is authoritative. Garbage in = garbage findings (review) or garbage gates (planning). The cleaner this file is, the more useful both flows are.

**Planning consultation is additional, not a substitute** — the review-time check via Agent #10 stays mandatory regardless of what happened at planning time.

## Refactoring an existing file

If the file already exists in a non-conforming shape (audit-report style, draft markers, open-questions section):

1. **Make a list** of every audit finding currently in the file → these become tickets.
2. **Make a list** of every open question / `[UNVERIFIED]` rule → these become tickets OR get verified now.
3. **Strip** the audit-results section, the open-questions section, and all status annotations.
4. **For each rule with `[UNVERIFIED]`:** either verify it now (and drop the marker) or remove the rule entirely.
5. **Re-run the authoring checklist** above.
6. **Open a single MR** with the refactor. Body: list the tickets you filed for everything that came out of the file. Reviewers see a clean diff (file got smaller, less noisy) AND a complete trail of where the removed content went.

The file gets smaller. The contract gets sharper. The agent gets quieter and more accurate.
