---
description: Investigate and fix a bug from a Jira ticket. Reads ticket context, searches the codebase, proposes a fix, and creates an MR.
---

# Fix Bug: $ARGUMENTS

Investigate and fix a bug from a Jira ticket or free-text description.

**Usage:**
```bash
/fix-bug PROJ-123                    # From Jira ticket
/fix-bug PROJ-123 --dry-run          # Investigate only, don't create MR
/fix-bug "checkout 500 error"        # From description (no Jira)
```

---

## Phase 1: Parse Input

Extract from `$ARGUMENTS`:
- **Jira key** (e.g., `PROJ-123`) - if provided
- **Flags**: `--dry-run` (investigate only, no code changes)
- **Free text** - if no Jira key, treat as bug description

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

### If free text provided:

Use the text directly as the bug description. Skip Jira enrichment.

### For both:

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
1. **Error-based search**: If the ticket has error messages or stack traces, search for those strings
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
git commit -m "fix: <summary from investigation> [<ticket>]

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Create the MR — delegate to `/etk:prepare-mr`

Route MR authoring + creation through **`/etk:prepare-mr`** so the bug MR carries the standardized description (Background / High-Level Design / Pitfalls) instead of an ad-hoc format. prepare-mr pushes the branch, drafts the body to a file (with a HIPAA redaction pass), opens the MR on the detected VCS (`gh` or `glab`), and hands off to `/review-mr`:

```bash
/etk:prepare-mr --closes <ticket>
```

(Add `--target <branch>` and `--label <name>` if the project uses a fixed integration branch or a bug label.)

Give prepare-mr the Phase-3 investigation context so it fills the sections from the bug:
- **Background** — *need*: the bug's user/system impact; *how it worked before*: the buggy behavior; *how it should work now*: the fixed behavior (root cause from Phase 3); *related flows*: what the bug touched.
- **High-Level Design** — the changed files by area + a sequence of the corrected flow.
- **Pitfalls & Regressions** — the regression test written in Phase 4 + the edge cases it guards.

Notes:
- The **Commit** step above already ran, so prepare-mr finds a clean tree and goes straight to push → create.
- The Phase-4 tests already ran, so pass that context to prepare-mr's Step-1 gate; it treats that as partial evidence and **runs the lint/typecheck** that Phase 4 didn't cover (Phase 4 runs tests only, not a full `/etk:verify`).
- Do **not** also hand-write the MR-create command; prepare-mr owns the description contract now.

### Update Jira (if ticket provided)

Use the Atlassian MCP to update the ticket:

```
Use mcp__atlassian__addCommentToJiraIssue to add a comment:
"Fix proposed in MR !<mr_number>. Root cause: <one-line explanation>"

Use mcp__atlassian__transitionJiraIssue to move to "In Progress" (if currently in Draft/To Do)
```

---

## Phase 6: Report Results

Present a summary to the user:

```markdown
## Fix Applied: [Bug Summary]

**Jira**: PROJ-123
**Branch**: fix/<slug>
**MR**: !<mr_number>

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
| `mcp__atlassian__getJiraIssue` | Read bug ticket details |
| `mcp__atlassian__addCommentToJiraIssue` | Post fix comment to ticket |
| `mcp__atlassian__transitionJiraIssue` | Move ticket to In Progress |
| `/etk:prepare-mr` | Author the standardized MR description + open the MR (Phase 5) |
| `glab mr view` | View MR details |
| Glob, Grep, Read | Search and read codebase |
| Edit, Write | Apply code fixes |
| Bash | Run tests, git operations |

## Complementary Commands

| Command | When to use |
|---------|-------------|
| `/fix-bug PROJ-123` | Investigate and fix a bug (this command) |
| `/review-mr 567` | Review the MR created by fix-bug |
| `/etk:atlassian-integration` | Direct Jira/Confluence interaction |
