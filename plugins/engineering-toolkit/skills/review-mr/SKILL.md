---
name: review-mr
description: "Comprehensive MR/PR review with quality checks, domain-aware parallel agents, structured confidence scoring, evidence gating, composite grading, and YAML+MD findings artifacts handed to /etk:post-mr-comments for inline-anchored posting. Use when: reviewing a GitLab MR or GitHub PR, auditing a teammate's diff before merge, gating CI on review quality, or generating draft inline comments for a large multi-domain change. Triggers on: review-mr, review pr, code review, MR review, audit MR, gate this MR, find blockers, deep review, security review of MR"
effort: xhigh
context: fork
keep-coding-instructions: true
---

# Review MR

Merge request review with tiered depth, domain-aware agent selection, structured confidence scoring, evidence gating, and composite grading. Produces YAML + Markdown artifacts; never posts to the MR directly. Posting is delegated to the companion skill `/etk:post-mr-comments`.

## /review-mr vs CC built-in /ultrareview

CC v2.1.111+ includes `/ultrareview` — parallel multi-agent cloud code review for GitHub PRs. Different strengths:

| Feature | `/review-mr` (this skill) | `/ultrareview` (CC built-in) |
|---------|---------------------------|------------------------------|
| VCS | GitLab (glab) **and** GitHub (gh): full review **+ inline posting** on both (`/etk:post-mr-comments` supports `glab` discussions and `gh` PR review comments) | GitHub only |
| Execution | Local via subagents | Cloud-based parallel agents |
| Modes | Quick / standard / deep / incremental | Single mode |
| Customization | Policy-driven, domain-aware agent selection, spec compliance | Fixed critique pipeline |
| Integration | Conventional comments, CI gates, review-logger hook, YAML→post pipeline | Standalone |

**Use `/review-mr`** for GitLab MRs or GitHub PRs, policy-controlled workflows, incremental re-reviews, when you need audit trails via `review-logger`, or when you need the inline-anchored post workflow via `/etk:post-mr-comments`. **Use `/ultrareview`** for quick external GitHub PR reviews where cloud parallelism beats local depth.

## Modes

- **Default (Quick)**: Quality checks + concise inline review (5-10 min, no agents)
- **`--standard`**: Quality checks + 3-7 domain-selected agents (10-15 min)
- **`--deep`**: Quality checks + 3-10 agents incl. conditional security/DB specialists (15-25 min)
- **`--incremental`**: Combine with any mode — re-review only changes since last Claude Code review comment
- **`--spec`**: Combine with `--standard` or `--deep` — run spec compliance review BEFORE code quality
- **`--dry-run`**: Display review plan without executing
- **`--ci`**: Non-interactive, **review-only** mode for CI — defaults pipeline-ack to gating, fail-closed on SHA drift, writes `findings.yaml` + emits a machine-readable JSON summary (`{grade, blocking_count, gate}`) to stdout, and exits nonzero on blocking findings. **Never posts** (posting stays a separate, explicit step). See [`references/ci-integration.md`](references/ci-integration.md).

## Security-focused review

For a fast **security-only** pass on a working-tree diff — without spinning the full 7-phase pipeline or computing a composite grade — use CC's built-in local **`/security-review`** (vuln scan for injection, authn/authz, insecure data handling, dependency vulns; VCS-agnostic, so it works in our GitLab flow). It complements this skill: reach for `/security-review` when the question is just "is this diff safe to merge?", and `/review-mr --deep` when you want the full review. Deep mode's **#7 Security Auditor** does the deeper in-pipeline pass when `HAS_SENSITIVE_DATA` (its prompt lives at `code-review-playbook/references/agent-prompts/security-auditor.md`). Note: automated dependency scanning (`npm audit`/`pip-audit`) is **not yet** wired into the pipeline — the auditor flags suspicious added deps for manual audit.

### Preloading via `--from-pr` (CC v2.1.119+)

```bash
claude --from-pr https://gitlab.com/.../merge_requests/132   # preload diff + description
# Then inside the session:
/review-mr --standard
```

## The phase pipeline

The review runs as a 7-phase pipeline. Each phase has a dedicated reference file with the full bash, prompts, and templates — load only the references you need for the active mode.

| Phase | Purpose | Reference file | Always runs? |
|-------|---------|----------------|--------------|
| **0** | VCS detection, mode parsing, policy + tool config, dry-run | [`references/phase-0-mode-policy.md`](references/phase-0-mode-policy.md) | yes |
| **1** | MR info fetch, pipeline ack, risk score, PR description, domain class, scope-leak, incremental, spec — **delegates to `scope-check` for any linked ticket** to bound the review against the ticket's AC. If the MR touches a code region the reviewer doesn't already understand at a glance, suggest the user invoke [`/etk:zoom-out`](../zoom-out/SKILL.md) before Phase 4 dispatch — agent prompts benefit from higher-level context. `zoom-out` is user-invoked; surface the suggestion, don't auto-fire. | [`references/phase-1-mr-info.md`](references/phase-1-mr-info.md) | yes |
| **2** | Auto-fix formatting (`$FMT_FRONTEND`, `$FMT_BACKEND`) | inline below | yes |
| **3** | Quality checks: secrets, lint, typecheck, tests, security greps, evidence gate | [`references/phase-3-quality-checks.md`](references/phase-3-quality-checks.md) | yes |
| **4** | Mode dispatch (Quick = inline review; Standard/Deep = agent fan-out) | inline below | yes |
| **5** | Per-agent prompts + structured-finding contract | [`references/phase-5-agent-prompts.md`](references/phase-5-agent-prompts.md) | Standard/Deep only |
| **6** | Aggregation, evidence gate, composite score, in-session report | [`references/phase-6-synthesis.md`](references/phase-6-synthesis.md) + [`references/final-report-template.md`](references/final-report-template.md) | yes |
| **7** | Write `.claude/reviews/mr-${N}-findings.{yaml,md}` and exit (no MR post) | [`references/phase-7-artifacts.md`](references/phase-7-artifacts.md) | yes |

## Phase 2: Auto-Fix Formatting (Pre-Review)

Run auto-fix commands to clean up formatting issues before any review work:

```bash
$FMT_FRONTEND   # biome
$FMT_BACKEND    # ruff

git status --short

if [ -n "$(git status --porcelain)" ]; then
  echo "Auto-fixed formatting issues. Review the changes:"
  git diff --stat
fi
```

## Phase 4: Mode Dispatch

### Quick Mode (Default)

Generate concise review inline without agents. Use the Phase 6d Final Report template (see `references/final-report-template.md`) but skip per-agent sections (Code Quality, Security, Database & Architecture, Testing). Just: Title + Risk + Quality Checks table + Strengths + Concerns + Suggestions + Recommendation.

5-10 minutes total.

### Standard Mode (`--standard`)

Load the `code-review-playbook` skill, then dispatch domain-selected agents per the [agent dispatch table](references/phase-5-agent-prompts.md#agent-dispatch-table):

- **Always launch**: #1 Code Quality, #3 Security, #10 Business Context Reviewer
- **If HAS_FRONTEND**: also #2 Type Safety, #4 Test Coverage, #6 Frontend Developer
- **If HAS_BACKEND**: also #2 Type Safety, #4 Test Coverage, #5 Backend Architect
- **If full-stack**: all 7
- **If infra-only**: only #1, #3, #10

The Business Context Reviewer (#10) is always launched because it self-skips gracefully when the project has no `.claude/business-invariants.md` file.

**Parallel fan-out (required on Opus 4.7)**: Dispatch all selected agents in a single response by emitting multiple `Agent` tool calls in the same message. Wait for all agents to return before synthesizing findings. Soft phrasing serializes by default and costs 3-5× wall-clock time.

10-15 minutes.

### Deep Mode (`--deep`)

Standard agents PLUS conditional specialists, all in the same single-response fan-out (do NOT phase the dispatch):

- **#7 Security Auditor**: if `HAS_SENSITIVE_DATA`
- **#8 Database Architect**: if `HAS_DATABASE`

15-25 minutes. See [`references/phase-5-agent-prompts.md`](references/phase-5-agent-prompts.md) for the full dispatch table and structured-finding contract.

## Anti-Patterns to Avoid

Distilled from running deep reviews on real multi-domain MRs — guardrails the skill enforces:

- **Don't post one giant summary comment.** Long top-level notes get scrolled past. Anchored comments stay in context where the work happens. Top-level notes belong to ≤5 lines (TL;DR + pointer to inline anchors), not the full review. Phase 7's hard-exit-without-posting closes this hole at the skill level.
- **Don't blast 30+ comments without showing a draft first.** The YAML+MD artifacts ARE the draft. The reviewer reads/edits before `/etk:post-mr-comments` runs. Posting is always a deliberate second action.
- **Don't gate on a known-flaky pipeline.** Phase 1 ack loop confirms with the author before letting CI failure become a blocker. Silent gating destroys trust.
- **Don't review an unfamiliar domain alone.** Pull in domain skills (`atk:*` for LLM features, `etk:hipaa-compliance-checker` for sensitive data). A generic-quality review on domain code misses domain-shaped bugs.
- **Don't mistake a single pass for a review.** First pass finds loud problems; second pass finds structural ones; some MRs need a third domain-specialization pass. Single-pass is fine for low-risk; assume multi-pass for risk ≥ 7.
- **Don't bury blockers under "shoulds".** A 60-line review with 3 blockers and 50 nits hides the real signal. List blockers first; everything else can be a backlog ticket.
- **Don't review the entire 1000-line diff yourself.** Fan out to agents in parallel. The main thread synthesizes; agents read.

These are guardrails, not absolutes. If a specific MR genuinely warrants breaking one, document why in the working doc.

## Output

- **In-session**: synthesized report from Phase 6 (printed for human visibility, not posted).
- **Persisted artifacts** (Phase 7) at `.claude/reviews/mr-${N}-findings.{yaml,md}`:
  - YAML = canonical source of truth, parseable by `/etk:post-mr-comments`
  - Markdown = human-readable, table of contents, severity-grouped, posted-status badges
- **No auto-post.** Posting is delegated to `/etk:post-mr-comments` as a deliberate second action.

## Posting workflow (companion skill `/etk:post-mr-comments`)

```bash
/review-mr ${N} --deep              # generates YAML + MD, exits without posting
$EDITOR .claude/reviews/mr-${N}-findings.yaml   # human review / edit / drop
/etk:post-mr-comments ${N} --dry-run            # preview the post plan + payload
/etk:post-mr-comments ${N} --severity blocking,issue   # post filtered subset
```

YAML is updated in-place with `posted: true`, `discussion_id`, `note_id`, and `anchored` (false when an out-of-hunk finding was posted as a top-level note fallback rather than inline) for each posted finding. Re-running `/etk:post-mr-comments` with `--skip {posted_ids}` resumes after a partial batch.

> **Backlog (deferred — G4, CC-alignment audit 2026-06-01):** a finding-usefulness feedback loop (which findings get accepted vs dismissed, to tune `confidence_threshold`/agent selection) is not yet wired. `review-logger` only matches `glab mr note/approve`, so it never fires for the `discussions` posting path `/etk:post-mr-comments` actually uses. Revisit at posting volume; discussion resolution-state is a noisy usefulness proxy.

## References

Per-phase deep dives (load on demand):

- [`references/phase-0-mode-policy.md`](references/phase-0-mode-policy.md) — VCS detection, mode parsing, policy loading, dry-run
- [`references/phase-1-mr-info.md`](references/phase-1-mr-info.md) — MR fetch, pipeline ack, risk + PR description + domain + scope-leak + incremental + spec
- [`references/phase-3-quality-checks.md`](references/phase-3-quality-checks.md) — secrets, lint, typecheck, tests, security greps, evidence gate
- [`references/phase-5-agent-prompts.md`](references/phase-5-agent-prompts.md) — agent dispatch table, structured finding contract, FP filters, parallel fan-out language
- [`references/phase-6-synthesis.md`](references/phase-6-synthesis.md) — aggregation, bundling, composite score, letter grade
- [`references/final-report-template.md`](references/final-report-template.md) — full markdown template for the in-session Phase 6d report
- [`references/phase-7-artifacts.md`](references/phase-7-artifacts.md) — YAML + MD writing, hand-off message, `.claude/reviews/` setup
- [`references/ci-integration.md`](references/ci-integration.md) — `--ci` non-interactive review-only mode + GitLab CI recipe (opt-in; needs an `ANTHROPIC_API_KEY`/OIDC CI secret)

Cross-references in `skills/code-review-playbook/references/`:

- `agent-review-templates.md` — conventional comment format, length budget, footer
- `false-positive-filtering.md` — confidence-tier rules
- `agent-prompts/*.md` — per-agent prompt files (loaded by Phase 5)
- `inline-comment-yaml-schema.md` — full YAML schema (Phase 7 + post skill contract)
- `glab-inline-comments-recipe.md` — `glab api .../discussions` patterns (used by `/etk:post-mr-comments` on GitLab)
- `gh-inline-comments-recipe.md` — `gh api .../pulls/{N}/comments` patterns (used by `/etk:post-mr-comments` on GitHub)

## Skills used

- `code-review-playbook` (shared) — conventional comments, structured finding format, FP filtering, agent prompts
- `quality-gates` — MR risk scoring (5 dimensions). (PR-description completeness is graded in Phase 1b against the `/etk:prepare-mr` contract, not here.)

## VCS CLI commands (auto-detected: glab/gh)

Set in Phase 0 (see [`references/phase-0-mode-policy.md`](references/phase-0-mode-policy.md)):

- `$VCS_MR_VIEW`, `$VCS_MR_DIFF`, `$VCS_MR_CI`, `$VCS_MR_APPROVE`, `$VCS_MR_NOTE`, `$VCS_MR_NOTE_LIST`, `$VCS_MR_UNAPPROVE`
- `$VCS_ENTITY` (MR | PR), `$VCS_PREFIX` (! | #)

## Configurable via `.claude/policies/review-policy.json`

- Confidence threshold, risk-to-mode escalation, evidence gate behavior, output preferences, composite score weights, grade thresholds, tool commands. Defaults documented in [`references/phase-0-mode-policy.md`](references/phase-0-mode-policy.md).
