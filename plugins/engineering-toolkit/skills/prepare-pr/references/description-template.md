# MR Description Template (the contract)

This is the standardized MR-description contract `/etk:prepare-pr` authors. It is also usable **standalone** — copy the skeleton into an MR by hand when you are not running the skill.

Fill every section. If a section genuinely does not apply, write `—` and a one-line reason rather than deleting it (a reviewer should see it was considered, not skipped). Keep everything **process/behavior only** — no patient/user PII, no violation `file:line` (see the redaction pass in `create-pr-recipe.md`).

---

## Skeleton

```markdown
# <type>(<scope>): <concise title>
<!-- <type> ∈ feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert — matches the git-validator hook -->

## Background
**What is the need** — the problem, user need, or system requirement this MR serves.
**How it worked before** — the prior behavior (or "net-new; no prior behavior").
**How it should work now** — the target behavior after this change.
**Related flows** — the upstream/downstream flows and features this touches.

## High-Level Design
**Changes by area**

| Area   | Change |
|--------|--------|
| API    | <endpoints / contracts changed, or —> |
| Infra  | <terraform / IAM / queues / pipelines, or —> |
| Schema | <migrations / models / indexes, or —> |
| UI     | <screens / components / state, or —> |
| Data   | <backfills / ETL / seeds, or —> |

**Sequence**

​```mermaid
sequenceDiagram
  actor User
  User->>API: <request>
  API->>Service: <call>
  Service->>DB: <query — parameterized>
  DB-->>Service: <result>
  Service-->>User: <response>
​```

## Pitfalls & Potential Regressions
- **<edge case>** — how it is handled / tested.
- **<regression risk>** — blast radius + mitigation.
- **<rollout / migration ordering>** — if any (feature flag, backfill order, deploy sequence).

---
Closes <ticket>   <!-- only when --closes <ticket> is passed; links/closes the tracker item on merge -->
Prepared with /etk:prepare-pr via Claude Code
<!-- prepare-pr:v1 -->  <!-- adoption marker: counted via the VCS API (GitLab / GitHub); do not remove -->
```

> The `Closes <ticket>` line appears only when the caller passes `--closes` (e.g. `/fix-bug` passes its Jira id). On a GitLab-native issue (`Closes #123`) or a GitHub issue (`Closes #123` in the PR body) merge auto-closes it; for an external tracker (e.g. Jira `PROJ-123`) it is a reference the tracker integration links.

## Field guidance

- **Title** — conventional-commit shape so it passes the `git-validator` hook and reads consistently in the MR list. Scope is the touched module/area.
- **Background is the highest-value section.** The before/after contrast is what a reviewer (and future archaeologist) actually needs. "How it worked before = net-new" is a valid answer for greenfield.
- **Changes-by-area** — one row per touched area; drop rows that are genuinely untouched (do not invent Schema/Infra rows for a UI-only change). The path→area globs are in `section-authoring.md`.
- **Sequence** — diagram the *one* primary flow the change affects, not the whole system. UI-only change → component→state→render. Data pipeline → source→transform→sink. Keep it under ~8 nodes; the reviewer should grasp it at a glance.
- **Pitfalls** — enumerate real edge cases and regression risks, each with a mitigation. This is not the test list (that lives in the code/CI) — it is the "what could break and why it won't" analysis.

## The adoption marker

The trailing `<!-- prepare-pr:v1 -->` HTML comment is the org-level adoption metric: count MRs/PRs carrying it via the VCS API (GitLab / GitHub) (`review-stats` is per-user-local and cannot measure team uptake). Keep it stable; bump the version suffix only if the template's shape changes.
