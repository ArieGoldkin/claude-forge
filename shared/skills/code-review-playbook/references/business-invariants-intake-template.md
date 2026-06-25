# Business Invariants — Contributor Intake Template

> **Copy this file** to your project's staging location (e.g. `docs/business-invariants-pending.md`) and have each teammate add candidate rules. This is a **draft / staging surface** — a workbench, not the contract.
>
> ⚠️ **This is NOT `.claude/business-invariants.md`.** Do not put this file at that path and do not point `/etk:review-mr` Agent #10 at it. Half-formed and `[UNVERIFIED]` rules here are expected; the same content in the real contract would produce false-positive review findings. Vetted rules are promoted into the contract by the **aggregation pass** (`business-invariants-aggregation.md`), never copied directly.

## How to contribute (read once, then fill)

1. Find the domain section your rule belongs to (add a new one if needed).
2. Add a candidate rule using the **relaxed schema** below. Don't worry about exact rule IDs — the aggregation pass assigns them.
3. Put your initials + date so the aggregator can follow up with you.
4. It's fine to submit a rule you can't fully verify yet — mark it `[UNVERIFIED]` and say what needs checking. That's what this file is for.

## The bar a rule must eventually clear (self-check)

A rule only reaches the contract if it passes the **3-question test**. Use it to sanity-check yours (a "no" doesn't mean don't submit — it means flag it):

1. **Specific failure mode** — can you complete "If false, X is broken" with a concrete consequence? (not "things get slow")
2. **Deploy-blocker** — would you halt a deploy on a confirmed violation? (not a soft preference)
3. **Project-wide truth** — true across the whole codebase, not just one feature?

If it's a style preference or a per-feature rule, it probably belongs in a linter rule / CLAUDE.md / a feature doc, not here.

## Relaxed candidate schema

```markdown
### [CANDIDATE] <domain>: <one-sentence rule name>

<Imperative statement — MUST / MUST NOT phrasing.>

- **Violation:** <what specifically breaks if this is false>
- **Proposed enforcement:** <[DB] | [Code] | [Hook/Grep] | [External] | [Convention]> (best guess is fine)
- **Proposed evidence:** <file:line if you know it — a guess, a TODO, or "[UNVERIFIED] — need to check X" is OK here>
- **3-question self-check:** <pass / borderline / not sure — one line>
- **Contributor:** <initials> · <YYYY-MM-DD>
```

> Enforcement tags (strongest → weakest): `[DB]` (constraint/trigger/unique index) · `[Code]` (verified code path) · `[Hook/Grep]` (CI/grep check) · `[External]` (cloud/IaC/IDP config) · `[Convention]` (developer discipline — weakest). Don't agonize over the tag; the aggregator confirms it.

## Worked example (delete before sharing, or keep as a guide)

```markdown
### [CANDIDATE] Privacy: User-scoped queries filter by user_id

Every DB query touching user-scoped tables MUST filter by `user_id` (or the
auth subject). Cross-user reads/writes are forbidden.

- **Violation:** cross-user data leak; HIPAA breach.
- **Proposed enforcement:** [Code] + [Hook/Grep]
- **Proposed evidence:** I think the canonical pattern is in the lifecycle handler
  (`User.id == user_id`) — exact file:line [UNVERIFIED], please confirm.
- **3-question self-check:** pass — concrete failure, deploy-blocker, project-wide.
- **Contributor:** AG · 2026-06-08
```

---

## Candidate rules (add yours below, grouped by domain)

### Privacy / Compliance

<!-- add [CANDIDATE] rules here -->

### Authentication / Authorization

<!-- add [CANDIDATE] rules here -->

### State Machines / Lifecycle

<!-- add [CANDIDATE] rules here -->

### Data Modeling / Persistence

<!-- add [CANDIDATE] rules here -->

### Architecture / Infrastructure

<!-- add [CANDIDATE] rules here -->

### <add domains as needed>

<!-- add [CANDIDATE] rules here -->

---

> **Next step (owner, not contributors):** when contributions accumulate, run the aggregation pass in `business-invariants-aggregation.md` to dedup, verify, and promote vetted rules into `.claude/business-invariants.md` via an MR.
