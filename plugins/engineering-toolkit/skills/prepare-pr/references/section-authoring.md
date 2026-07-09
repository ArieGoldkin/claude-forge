# Section Authoring — deriving the description from the diff

How to fill each template section from the branch's changes. Inputs gathered in SKILL Step 2: the diff (`git diff $TARGET...HEAD`), the commit log (`git log $TARGET..HEAD`), the changed-file list, and the linked ticket (if any).

## Background

Reconstruct the before/after from evidence, not guesswork:

- **What is the need** — from the ticket summary (if resolved) and the commit-message bodies. If neither exists, ask the user one question rather than inventing intent.
- **How it worked before** — read the *pre-change* side of the diff (removed/`-` lines and the functions they lived in). If the touched files are new, state "net-new; no prior behavior."
- **How it should work now** — the *post-change* side (added/`+` lines): the new behavior the diff implements.
- **Related flows** — callers of the changed symbols (a quick `grep`/Grep for the changed function/route/component names across the repo) and anything downstream that consumes their output.

Keep it factual and short. Background is prose, not a changelog — the change list belongs in the next section.

## High-Level Design — change taxonomy

Classify each changed path into one area. Generic globs (tune per repo; do not hardcode one project's layout):

| Area | Path signals |
|---|---|
| **API** | `**/routes/**`, `**/controllers/**`, `**/handlers/**`, `**/*api*`, `**/endpoints/**`, OpenAPI/`*.proto` |
| **Infra** | `*.tf`, `terraform/**`, `**/k8s/**`, `Dockerfile*`, `**/.gitlab-ci*`, `**/.github/workflows/**`, `**/serverless*`, IAM/policy files |
| **Schema** | `**/migrations/**`, `**/alembic/**`, `**/models.py`, `**/schema.*`, `prisma/**`, `**/*.sql` |
| **UI** | `**/*.tsx`, `**/*.jsx`, `**/*.vue`, `**/components/**`, `**/*.css`, `**/*.scss` |
| **Data** | `**/pipelines/**`, `**/etl/**`, `**/jobs/**`, `**/seeds/**`, `**/fixtures/**`, notebooks |

Emit one table row per area that has at least one changed file; describe *what* changed in that area (not a file list). Drop untouched areas. If a change spans several areas, that is a signal to note the cross-cutting risk in Pitfalls.

## Sequence diagram

Diagram the single primary flow the change affects. Choose the shape by dominant area:

- **API / backend** — `sequenceDiagram`: actor → API → service → datastore → back. Mark any parameterized query / auth check inline (it doubles as a HIPAA/security signal).
- **UI-only** — `sequenceDiagram` or `flowchart`: user action → component → state/store → render, or the request the component fires.
- **Data pipeline** — `flowchart LR`: source → transform(s) → sink, with the trigger.

Rules: keep it to the touched flow, ≤ ~8 nodes; label edges with the actual call/verb; never put patient/user PII or real identifiers in node text. If the change is trivial (e.g. a copy tweak) and a diagram would be noise, write `— (no flow change)` under **Sequence** rather than forcing one.

## Pitfalls & Potential Regressions

Derive candidates, then keep the real ones:

- **Blast radius** — the callers found under Background/Related-flows: what breaks if the new behavior is wrong?
- **Edge cases** — boundaries visible in the diff (empty/null inputs, pagination limits, concurrency, timezones, large payloads, the `total == 0` class of false-green).
- **Migration / rollout ordering** — if Schema or Infra changed: backfill order, feature-flag state, deploy sequence, backward compatibility during rollout.
- **Data integrity / security** — if Schema or API touched auth/PHI tables: parameterized queries, row-level security, audit logging (state the principle upheld, never a violation `file:line`).

Each pitfall gets a one-line mitigation. Omit categories that genuinely do not apply rather than listing "N/A" noise — but do not omit a category just because analyzing it is work.
