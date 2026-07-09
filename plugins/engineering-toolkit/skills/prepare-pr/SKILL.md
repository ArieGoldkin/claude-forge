---
name: prepare-pr
description: "Author a standardized, structured MR/PR description — Background (need / before / after / related flows), High-Level Design (API/Infra/Schema/UI/Data change table + mermaid sequence), Pitfalls & Regressions — from the branch diff, then open the MR/PR (draft-to-file, adoption-marked) and hand off to /etk:review-mr. Works on GitLab (glab) and GitHub (gh). Use when: opening a merge request or pull request, preparing an MR/PR, writing an MR/PR description, or wrapping a feature/fix before review. Triggers on: prepare-pr, prepare pr, prepare-mr, prepare mr, open PR, open MR, create pull request, create merge request, PR description, MR description, ready for review, ship it"
effort: xhigh
---

# Prepare PR

Authors a standardized MR/PR description from the current branch's changes and opens the merge request (GitLab) or pull request (GitHub). Composable: run it standalone when you are ready to open an MR/PR, or call it at the end of `/develop` or `/fix-bug`. It produces the description contract in `${CLAUDE_SKILL_DIR}/references/description-template.md`; it does **not** review the MR/PR — after opening, it hands off to the read-only/mutating review pair.

## What this does — and what it must not do

Keep this boundary; it is why the skill is safe to compose.

- **Does:** gather the diff / commits / ticket → author Background + High-Level Design (+ mermaid) + Pitfalls → draft the body to a file → open the MR/PR with it → suggest the review tail.
- **Does NOT:** run `/etk:review-mr` or `/etk:post-mr-comments` for you, post inline comments, merge the MR/PR, or carry `/fix-bug`'s bug-only assumptions (a hardcoded target branch, a fixed bug label, file caps, an auto-appended `Fixes <ticket>` line). The review→post pair is a separate, human-gated boundary — never absorb or auto-run it.
- **Never autonomous:** the drafted body must be human-approved before the MR/PR is created (the Step 3 gate); verify runs before authoring (Step 1) unless explicitly overridden. Never a single silent run.

## Flow

### Step 0 — Preflight
Run `git rev-parse --abbrev-ref HEAD` for the branch and `git status --porcelain` for tree state. Confirm this is **not** a protected branch (main/master/develop/dev/prod/staging). Resolve the target branch: the `--target` flag, else the repo default (`git symbolic-ref refs/remotes/origin/HEAD`), else ask. If invoked by `/develop` or `/fix-bug`, accept their passed context (verify evidence, ticket, change summary) instead of re-deriving it.

### Step 1 — Verify pre-gate
Never open an MR/PR on unverified code. Resolve verification in this order:
- **Complete green `/etk:verify` evidence already exists this session** (e.g. `/develop`'s Verify phase — a full verify, or `.develop/` evidence) → reuse it; do not re-run.
- **Partial evidence** (e.g. `/fix-bug` Phase 4 ran tests only, not lint/types) → run **only the checks not yet covered**; don't re-run what's already green.
- **Standalone, no evidence** → **run `/etk:verify` now** — do not merely offer, and do not trust an asserted "it's green". If it fails, **stop**: report the failures and do not author the MR/PR.
- **Overrides:** `--no-verify-gate`, or an explicit user instruction to skip, bypasses the run and records verification as not-confirmed (surfaces as `DONE_WITH_CONCERNS`). User instructions win.

### Step 2 — Gather change context
- Diff + files: `git diff --stat origin/$TARGET...HEAD` then `git diff origin/$TARGET...HEAD`.
- Commits: `git log origin/$TARGET..HEAD --format='%s%n%b'`.
- (Use the `origin/$TARGET` ref as the diff/log base — a bare local `$TARGET` ref may not exist in a fresh clone, worktree, or CI checkout; `origin/$TARGET` also matches the base the server computes for the MR/PR.)
- Classify changed paths into the **API / Infra / Schema / UI / Data** taxonomy (globs in `${CLAUDE_SKILL_DIR}/references/section-authoring.md`).
- Ticket: parse an `[A-Z]+-\d+` id from the branch name or commit trailers; if it resolves via Atlassian, pull the summary for Background context — never paste PHI.

### Step 3 — Author the description → draft to file
Fill every section of the template (`${CLAUDE_SKILL_DIR}/references/description-template.md`), deriving each per `section-authoring.md`; generate the mermaid sequence from the change shape. **Write the body to `.develop/prepare-pr/mr-body-<branch>.md`** — never stream a long body inline (output-token ceiling). Run the **redaction pass** (`create-pr-recipe.md` §Redaction): process/behavior only, no patient/user PII, no violation `file:line`.

**Gate (mandatory) — restate scope, then confirm:**
> "MR/PR: `<type>(<scope>): <title>` → `<target>`. Body drafted to `<file>`. Sections filled: Background ✓ · Design ✓ · Pitfalls ✓. Open it now? [yes / edit / dry-run / stop]"

Never proceed to Step 4 without an explicit **yes**. On **edit**, incorporate the change and re-show. On **dry-run**, stop here and report the body path.

### Step 4 — Commit + push
If the tree is dirty, commit with a conventional-commit message (`feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert` — matches the `git-validator` hook). **Then always push** so the MR/PR includes every local commit — `git push` (add `-u origin <branch>` when there's no upstream yet). Push even when the tree was already clean: earlier commits may be unpushed (common mid-`/develop`), and the MR/PR must not open missing them. If commits land **after** a prior `/etk:review-mr` run, the review is now stale (the review pair's SHA stale-check will refuse to anchor) — a re-review is required.

### Step 5 — Create the MR/PR
Detect the host with the same switch as `/etk:review-mr` Phase 0 (`command -v glab` else `command -v gh`), then call **`glab mr create`** (GitLab) or **`gh pr create`** (GitHub): pass `--title`, the drafted body (glab `--description "$(cat $BODY_FILE)"` / gh `--body-file $BODY_FILE`), the target (glab `--target-branch $TARGET` / gh `--base $TARGET`) as the bare branch name, `--label` for each label given, and `--draft` if requested. The adoption marker is already in the body (added in Step 3); so is the `Closes <ticket>` line if `--closes` was passed. Capture the returned number into `$MR_NUMBER`. Exact per-host invocation + flag mapping: `${CLAUDE_SKILL_DIR}/references/create-pr-recipe.md`.

### Step 6 — Hand off (do not auto-run)
Print the review tail for the user to run as deliberate, separate steps:
> "${VCS_ENTITY} ${VCS_PREFIX}$MR_NUMBER open. Next (separate, human-gated): `/etk:review-mr $MR_NUMBER` → edit the findings YAML → `/etk:post-mr-comments $MR_NUMBER`."

Stop. Report `STATUS: DONE` (or `DONE_WITH_CONCERNS` if verify was skipped or a section is thin).

## Flags

| Flag | Effect |
|---|---|
| `--dry-run` | Steps 0–3 only: author the body to a file and print it. No commit / push / create. |
| `--target <branch>` | Override the target branch (default = origin HEAD). |
| `--draft` | Create the MR/PR as a draft. |
| `--label <name>` | Add a label to the MR/PR (passed to `glab mr create --label` / `gh pr create --label`; comma-separate for multiple, e.g. `--label a,b`). |
| `--closes <ticket>` | Add a `Closes <ticket>` reference line to the body footer (links/closes the tracker item on merge, per the tracker's convention). |
| `--no-verify-gate` | Skip the Step-1 verify run (records verification as not-confirmed). |

## Completion criteria

Done only when **all** hold:
- [ ] Verification was green before authoring — complete `/etk:verify` evidence was reused, the uncovered checks were run green, or a fresh run passed — **unless** explicitly overridden (`--no-verify-gate` / user skip), in which case the MR/PR is reported `DONE_WITH_CONCERNS`.
- [ ] The body has all three sections with real content — Background's four parts, a change-by-area table listing **every** touched area, a mermaid sequence, an enumerated Pitfalls list — no placeholder text left.
- [ ] The body was drafted to a file, not streamed inline.
- [ ] The MR/PR was created against the resolved target branch (or, under `--dry-run`, the body file exists and was shown).
- [ ] The redaction pass ran: no patient/user PII, no violation `file:line`, process-only.
- [ ] The review tail was **suggested, not executed**.

## Safety

- **HIPAA / PHI:** the description describes *process and behavior only*. Never include patient/user PII, PHI identifiers, or a specific violation `file:line`. RBAC / audit-logging / least-privilege appear only as principles the change upholds. See `create-pr-recipe.md` §Redaction.
- **No auto-merge, ever.** This skill opens an MR/PR for review; it never approves or merges.
- **User instructions win.** If the user says skip a section or a gate, honor it — and note the omission in the body.

## Reference files
- `${CLAUDE_SKILL_DIR}/references/description-template.md` — the section contract (also the standalone template for hand-authoring).
- `${CLAUDE_SKILL_DIR}/references/section-authoring.md` — deriving each section from the diff; the change-taxonomy globs; mermaid generation.
- `${CLAUDE_SKILL_DIR}/references/create-pr-recipe.md` — the `glab mr create` / `gh pr create` invocation + per-host flag mapping, adoption marker, redaction pass, and conventional-commit title.
