# Create-MR Recipe

The mechanics of Steps 4–5: commit, push, and open the MR/PR with the drafted body. Works on both GitLab (`glab`) and GitHub (`gh`) — the same host switch as `/etk:review-mr` Phase 0 and `/etk:post-mr-comments` Phase 0. Our review→post pair already supports inline anchoring on both hosts, so there is no GitHub TODO here.

## Conventional-commit title

The MR/PR title and any commit created in Step 4 use the conventional-commit shape the `git-validator` hook enforces:

```
<type>(<scope>): <description>
# type ∈ feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert
# scope = touched module/area; description ≥ 3 chars, imperative mood
```

Derive `<type>` from the change (new capability → `feat`; bug → `fix`; docs/skill authoring → `docs`; etc.). The title is the MR/PR title *and* the seed for a Step-4 commit if the tree is dirty.

## Target branch resolution

1. `--target <branch>` if passed.
2. Else the repo default: `git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'`.
3. Else ask the user.

**Do not** hardcode a target (that was `/fix-bug`'s bug-only assumption). Never target a protected branch you are currently *on*.

`$TARGET` is the **bare** branch name (e.g. `main`) — pass it to `--target-branch` (glab) / `--base` (gh). For the Step-2 diff/log base use the remote ref `origin/$TARGET` instead (a bare local ref may be absent in a fresh clone / worktree / CI checkout).

## Commit + push (Step 4)

```bash
# commit ONLY if the tree is dirty
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "<type>(<scope>): <description>"
fi
# ALWAYS push (even if nothing was committed just now) — the branch may carry
# unpushed commits from earlier, e.g. mid-/develop, and the MR/PR must include them.
git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1 || PUSH_FLAGS="-u origin $(git rev-parse --abbrev-ref HEAD)"
git push $PUSH_FLAGS
```

If a `/etk:review-mr` run already happened and you push new commits here, the recorded `generated_from_sha` no longer matches `head_sha` — the review pair will refuse to anchor stale findings. Tell the user a re-review is required; do not try to bypass the stale-check.

## Create the MR/PR (Step 5)

Detect the host the same way `/etk:review-mr` and `/etk:post-mr-comments` do, then open on whichever CLI is present:

```bash
# Detect VCS host (mirror of review-mr Phase 0)
if command -v glab &>/dev/null; then VCS_CLI=glab; VCS_PREFIX='!'
elif command -v gh &>/dev/null; then VCS_CLI=gh; VCS_PREFIX='#'
else echo "ERROR: No VCS CLI found. Install glab (GitLab) or gh (GitHub)."; exit 1; fi

BODY_FILE=".develop/prepare-pr/mr-body-$(git rev-parse --abbrev-ref HEAD | tr '/' '-').md"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ "$VCS_CLI" = glab ]; then
  glab mr create \
    --title "<type>(<scope>): <title>" \
    --description "$(cat "$BODY_FILE")" \
    --target-branch "$TARGET" \
    --source-branch "$BRANCH" \
    ${LABEL:+--label "$LABEL"} \
    ${DRAFT:+--draft}
else
  gh pr create \
    --title "<type>(<scope>): <title>" \
    --body-file "$BODY_FILE" \
    --base "$TARGET" \
    --head "$BRANCH" \
    ${LABEL:+--label "$LABEL"} \
    ${DRAFT:+--draft}
fi
```

- `--label <name>` → passed straight to `--label` on both hosts (comma-separate for multiple: `--label a,b`, which `$LABEL` holds as one value). `--closes <ticket>` is **not** a CLI flag — it is rendered as a `Closes <ticket>` line in the drafted body (Step 3), so it lands in the description the tracker integration reads.
- The body comes from the **file** drafted in Step 3 — never inline a long body into the command (output-token ceiling; also avoids shell-quoting breakage). glab reads it via `--description "$(cat …)"`; gh reads it directly via `--body-file` (which also sidesteps the quoting issue — pass both `--base` and `--head` so `gh` runs non-interactively).
- Capture the number into `$MR_NUMBER` from the returned URL — glab ends in `/merge_requests/<N>`, gh ends in `/pull/<N>` (or fetch it back with `gh pr view --json number -q .number`).
- `--draft` only when the `--draft` flag was passed.
- This skill only ever runs `glab mr create` / `gh pr create`. It never posts inline comments — that is `/etk:post-mr-comments`, which needs a JSON `--input` body (a separate, human-gated step this skill does not perform).

## §Redaction — run before Step 5 (and before showing the body at the Step-3 gate)

The MR/PR body lands in a thread readable by the whole team. Scan the drafted body and strip:

- **Patient/user PII** — names, emails, phones, DOBs, account/patient identifiers, free-text notes.
- **Specific violation `file:line`** — describe the *class* of issue and the principle upheld, not "the leak at `patient.py:186`".
- **Secrets / tokens / internal URLs** with credentials.

Keep RBAC / least-privilege / audit-logging as *principles the change upholds*. If the diff itself contains PHI-shaped strings, describe the behavior generically and flag to the user that the diff may need sanitizing. **No auto-merge, ever** — this skill opens the MR/PR for human review only.

## Dry-run

Under `--dry-run`, stop after Step 3: the body file exists and is printed; no commit, push, or create call is made. This is the safe rehearsal path (and how the skill is tested).
