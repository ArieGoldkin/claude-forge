---
description: Investigate and fix a bug from a Jira ticket, a GitHub issue, or a free-text description. Finds root cause, proposes a fix, and opens the MR/PR.
---

# Fix Bug: $ARGUMENTS

Investigate and fix a bug from a Jira ticket, a GitHub issue, or a free-text description.

**Usage:**
```bash
/fix-bug PROJ-123                    # From a Jira ticket
/fix-bug 71                          # From a GitHub issue (bare number, #71, or a URL)
/fix-bug 71 --dry-run                # Investigate only, don't open a PR
/fix-bug "checkout 500 error"        # From a description (no tracker)
```

---

## Phase 1: Parse Input

Extract from `$ARGUMENTS`:
- **Jira key** (e.g., `PROJ-123`) - if provided
- **GitHub issue** (e.g., `#123`, a bare `123`, or an issue URL) - if provided
- **Flags**: `--dry-run` (investigate only, no code changes)
- **Free text** - if neither a Jira key nor a GitHub issue, treat as bug description

A bare number is a GitHub issue, not free text. Reading `123` as a bug description
silently drops the whole context-gathering step and leaves the model working from a
two-character string, with no error to signal it.

---

## Phase 2: Gather Context

### If Jira key provided:

Use the `/etk:atlassian-integration` skill for Jira MCP interaction.

```
Read the Jira ticket using the Atlassian MCP tools:
- mcp__atlassian__getJiraIssue for ticket details (summary, description, comments, priority, status)
- mcp__atlassian__getJiraIssueRemoteIssueLinks for linked issues or MRs
```

Extract from the ticket:
- **Summary**: one-line bug description
- **Description**: full context, steps to reproduce, expected vs actual behavior
- **Priority**: P0-P3 severity
- **Comments**: additional context from reporters or other engineers
- **Attachments/links**: screenshots, related tickets

### If GitHub issue provided:

Read the issue with the `gh` CLI — no MCP server is involved:

```bash
gh issue view <number-or-url> --json title,body,comments,labels,state,url
```

⚠ **If the user gave a URL, pass the URL through verbatim — never normalize it to a bare number.**
`gh issue view` accepts `{<number> | <url>}`, and a bare number always resolves against the
**current** repo. A cross-repo URL reduced to its number does not error; it reads a *different
issue of the same number in this repo* and returns exit 0, so the entire investigation proceeds
from the wrong bug report with nothing to signal it. Use `-R <owner>/<repo>` if you must pass a
number for another repo.

⚠ **Verify what came back is the issue you asked for.** GitHub gives issues and pull requests **one
shared number space**, so `gh issue view <n>` can return a *pull request*. Check that the returned
`url` matches the one you were given (and that it contains `/issues/`) before treating the body as
a bug report.

Extract the same fields the Jira branch does, from their GitHub equivalents:
- **Summary**: `title`
- **Description**: `body` — full context, steps to reproduce, expected vs actual
- **Priority**: `labels` (GitHub has no priority field; a `P0`-`P3` or `high`/`low` label is the
  closest equivalent, and there may be none — do not invent a severity)
- **Comments**: `comments` — later comments frequently amend or overturn the body, so read them
  before acting on the body alone
- **Links**: `url`, plus any issue or PR references in the body

If `gh` is unavailable or unauthenticated, say so and fall back to treating the argument as free
text — do not silently proceed as if the issue had been read.

### If free text provided:

Use the text directly as the bug description. Skip tracker enrichment, and skip the Phase-5
write-back entirely — there is nothing to report back to.

### For all three:

Collect from the codebase:
- **Recent deploys**: `git log --oneline --since="7 days ago" -- <affected_files>`
- **Related test files**: search for test files matching affected modules

---

## Phase 3: Investigate Root Cause

Use the `/etk:fix-bug` skill's **observation-driven debugging methodology** (OHAOI loop) to investigate systematically rather than guessing.

### Step 1: OBSERVE -- Gather full context

- Read the complete bug report (from Phase 2)
- Reproduce the issue if possible
- Capture: exact error message, full stack trace, actual vs expected behavior, when it started

### Step 2: HYPOTHESIZE -- Form a testable theory

Write down a specific hypothesis about the root cause before searching the codebase. Example: "The 500 error occurs because function X receives null when field Y is missing from the request."

### Step 3: ACT -- Targeted investigation

Make ONE focused search action to test the hypothesis:
1. **Error-based search**: If the bug report has error messages or stack traces, search for those strings
2. **Keyword search**: Search for domain terms from the bug description (e.g., "checkout", "cart", "payment")
3. **File identification**: Narrow down to 1-5 most likely affected files
4. **Code reading**: Read the affected files and trace the logic
5. **Git blame**: Check who last modified the affected lines and when

### Step 4: OBSERVE -- Check results

Did the investigation confirm or disprove the hypothesis? Record what was found.

### Step 5: ITERATE

If disproven, form a new hypothesis based on combined evidence. If confirmed, proceed to fix.

**Escalation**: If stuck after 3 hypothesis cycles, widen the search, check assumptions, or use `git bisect` to find the introducing commit.

**Output an investigation summary:**
```markdown
## Investigation: [Bug Summary]

**Hypotheses tested**:
1. [Theory] -> [Confirmed/Disproven: what was found]

**Root cause**: [explanation]
**Affected files**:
- `src/path/to/file.py:45` - [what's wrong here]
- `src/path/to/other.ts:112` - [what's wrong here]

**Recent changes**:
- `abc123` by @author (2 days ago) - "commit message"

**Confidence**: [low/medium/high]
**Complexity**: [simple/moderate/complex]
```

### If `--dry-run` flag is set:

Stop here. Present the investigation to the user and exit.

### If confidence is low or complexity is complex:

Present findings and ask the user whether to proceed with a fix attempt.

---

## Phase 4: Fix the Bug

1. **Create a branch**: `git checkout -b fix/<slug>` from the current branch (or the repo's integration branch if in a consuming repo)
2. **Write a regression test**: Create a test that reproduces the bug (should fail before the fix, pass after)
3. **Edit the affected files**: Make the minimum changes needed to fix the root cause identified in Phase 3
4. **Run relevant tests**:
   - Frontend: `npm test -- --related <files>` or `mise run test-frontend`
   - Backend: `cd lambdas/{service} && uv run pytest tests/ -v`
4. **If tests fail**: Iterate on the fix (up to 3 attempts), then ask the user

**Guardrails:**
- Maximum 5 files changed per fix
- No changes to database migrations
- No changes to infrastructure/Terraform
- No dependency version changes
- Changes must pass local tests before proceeding

---

## Phase 5: Commit and Create MR

### Commit

```bash
git add <changed_files>
git commit -m "fix: <summary from investigation> [<ref>]

Co-Authored-By: Claude <noreply@anthropic.com>"
```

`<ref>` renders per tracker: `PROJ-123` for Jira, `#71` for a GitHub issue. Omit the brackets
entirely for free-text bugs rather than emitting an empty `[]`.

### Create the MR — delegate to `/etk:prepare-pr`

Route MR authoring + creation through **`/etk:prepare-pr`** so the bug MR carries the standardized description (Background / High-Level Design / Pitfalls) instead of an ad-hoc format. prepare-pr pushes the branch, drafts the body to a file (with a HIPAA redaction pass), opens the MR on the detected VCS (`gh` or `glab`), and hands off to `/review-mr`:

```bash
/etk:prepare-pr --closes <ref>
```

`prepare-pr` detects the VCS itself, but `<ref>` still renders per tracker: `PROJ-123` for Jira,
`#71` for a GitHub issue. On GitHub this is what produces the `Closes #71` keyword that closes the
issue on merge — which is why the write-back step below does **not** close it a second time.

(Add `--target <branch>` and `--label <name>` if the project uses a fixed integration branch or a bug label.)

Give prepare-pr the Phase-3 investigation context so it fills the sections from the bug:
- **Background** — *need*: the bug's user/system impact; *how it worked before*: the buggy behavior; *how it should work now*: the fixed behavior (root cause from Phase 3); *related flows*: what the bug touched.
- **High-Level Design** — the changed files by area + a sequence of the corrected flow.
- **Pitfalls & Regressions** — the regression test written in Phase 4 + the edge cases it guards.

Notes:
- The **Commit** step above already ran, so prepare-pr finds a clean tree and goes straight to push → create.
- The Phase-4 tests already ran, so pass that context to prepare-pr's Step-1 gate; it treats that as partial evidence and **runs the lint/typecheck** that Phase 4 didn't cover (Phase 4 runs tests only, not a full `/etk:verify`).
- Do **not** also hand-write the MR-create command; prepare-pr owns the description contract now.

### Update the tracker (if a ticket or issue was provided)

Write back to whichever tracker Phase 1 identified. **Report to the tracker you read from** —
reading a GitHub issue and then commenting on Jira is the defect this step exists to avoid.

#### If a Jira key was provided

Use the Atlassian MCP to update the ticket:

```
Use mcp__atlassian__addCommentToJiraIssue to add a comment:
"Fix proposed in MR !<mr_number>. Root cause: <one-line explanation>"

Use mcp__atlassian__transitionJiraIssue to move to "In Progress" (if currently in Draft/To Do)
```

#### If a GitHub issue was provided

Comment with the `gh` CLI — no MCP server is involved:

```bash
gh issue comment <number-or-url> --body "Fix proposed in #<pr_number>. Root cause: <one-line explanation>"
```

⚠ **Use the same identifier Phase 2 read from — the URL if that is what you were given.** A bare
number resolves against the **current** repo, so a cross-repo issue normalized to its number posts
the comment on a *different* issue, successfully and silently. That is precisely the
"report to a tracker you did not read from" failure this step exists to prevent, in a narrower
form: right tracker, wrong issue.

Then **stop**. Two things that look like the Jira branch's other steps are deliberately absent:

- **No status transition.** GitHub has no status field, and the closest analogues both cost more
  than they give: an `in-progress` label errors unless the label already exists in that repo, and
  an assignee signals ownership rather than progress. The PR that references the issue already
  appears on its timeline, so **the PR is the in-progress signal**. Do not invent one.
- **No explicit close.** The `Closes #<number>` keyword in the PR body closes the issue when the
  fix actually *lands*. Closing here would close it when the PR *opens*, which is not the same
  event. ⚠ This command exists because of that exact failure: PR #70 carried `Closes #69` while
  its own body said the change was read-path-only, so #69 auto-closed and took its pinned
  remainder with it — re-filed as #71. **The lesson was to check what a PR actually completes
  before writing the keyword, not to add a second closing path.** Adding one here would race the
  first.

If `gh` is unavailable or unauthenticated, say so and skip the write-back — do not report success
for a comment that was never posted.

---

## Phase 6: Report Results

Present a summary to the user:

```markdown
## Fix Applied: [Bug Summary]

**Tracker**: PROJ-123 (Jira) | #71 (GitHub) | none (free text)
**Branch**: fix/<slug>
**MR/PR**: !<mr_number> | #<pr_number>

**Root cause**: [explanation]
**Changes**:
- `file1.py:45` - [what changed]
- `file2.ts:112` - [what changed]

**Tests**: [passed/failed]
**Confidence**: [low/medium/high]

**Next steps**:
- [ ] Review the MR
- [ ] Run `/review-mr <mr_number>` for a comprehensive review
```

---

## Skills and Tools Used

| Tool | Purpose |
|------|---------|
| `/etk:fix-bug` (skill) | Observation-driven debugging methodology (OHAOI loop) |
| `/etk:atlassian-integration` | Jira MCP interaction (read tickets, add comments, transition status) |
| `mcp__atlassian__getJiraIssue` | Read bug ticket details (Jira) |
| `mcp__atlassian__addCommentToJiraIssue` | Post fix comment to ticket (Jira) |
| `mcp__atlassian__transitionJiraIssue` | Move ticket to In Progress (Jira only — GitHub has no analogue) |
| `gh issue view` | Read bug issue details (GitHub) |
| `gh issue comment` | Post fix comment to issue (GitHub) |
| `/etk:prepare-pr` | Author the standardized MR/PR description + open it (Phase 5) |
| `glab mr view` / `gh pr view` | View MR/PR details |
| Glob, Grep, Read | Search and read codebase |
| Edit, Write | Apply code fixes |
| Bash | Run tests, git operations |

## Complementary Commands

| Command | When to use |
|---------|-------------|
| `/fix-bug PROJ-123` | Investigate and fix a bug from a Jira ticket (this command) |
| `/fix-bug 71` | Investigate and fix a bug from a GitHub issue (this command) |
| `/review-mr 567` | Review the MR/PR created by fix-bug |
| `/etk:atlassian-integration` | Direct Jira/Confluence interaction |
