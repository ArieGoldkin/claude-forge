---
name: fix-bug
description: "Observation-driven debugging loop (OHAOI): Observe, Hypothesize, Act, Iterate. Investigates root cause before fixing. Integrates with Jira tickets and MR creation. Use when: debugging a bug report, fixing a failing test, tracing unexpected behavior, diagnosing production errors. Triggers on: fix bug, debug, failing test, broken, error, crash, regression, flaky, investigate, root cause, stack trace, reproduce"
effort: xhigh
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.py"
  - "**/*.js"
context: fork
---

# Fix Bug

## Overview

This skill provides a structured, observation-driven methodology for investigating and fixing bugs. Rather than jumping to guesses, it enforces a disciplined loop that builds understanding before making changes.

**When to use this skill:**
- Investigating a bug report or error
- Debugging a failing test
- Tracing unexpected behavior in production
- Any situation where something is broken and the cause is not immediately obvious

**Core principle: Never guess a fix without first understanding the root cause.**

---

## Phase 0: Scope Check (when ticket-driven)

If the bug is linked to a ticket (Jira / GitHub), delegate to the `scope-check` skill — auto-loaded by description match on the ticket ID — to enumerate the ticket's acceptance criteria into a checklist BEFORE the observation loop begins. The checklist bounds the fix: it tells you what counts as "done" and what's out of scope. Skip if the bug is reported informally without a ticket.

## Observation-Driven Debugging

Effective debugging is not about guessing -- it is about systematically narrowing down the problem space through observation and hypothesis testing. Each cycle brings you closer to the root cause, and even failed hypotheses are valuable data.

### The OHAOI Loop

```
  OBSERVE ──► HYPOTHESIZE ──► ACT ──► OBSERVE ──► ITERATE
     ▲                                                │
     └────────────────────────────────────────────────┘
                   (if hypothesis disproven)
```

#### Step 1: OBSERVE -- Gather the Full Picture

Before forming any theory, collect all available information. Each observation step should capture FULL context: error message + stack trace + relevant state + reproduction steps.

**Checklist:**
- [ ] Read the error/bug report completely (Jira ticket, Slack thread, user report)
- [ ] Reproduce the issue (or confirm reproduction steps)
- [ ] Capture the exact error message and full stack trace
- [ ] Note actual behavior vs expected behavior
- [ ] Check relevant logs (application logs, browser console, server logs)
- [ ] Identify when the issue started (recent deploy? recent config change?)
- [ ] Check if the issue is consistent or intermittent

**Tip — unfamiliar code region?** If the bug touches a part of the codebase you don't already understand at a glance, suggest the user invoke [`/etk:zoom-out`](../zoom-out/SKILL.md) before forming hypotheses. Higher-level context (module map, caller graph, glossary terms) prevents you from chasing surface symptoms inside a region whose invariants you don't yet know. `zoom-out` is user-invoked (`disable-model-invocation: true`) — surface the suggestion, don't auto-fire.

**Record your observations:**
```markdown
## Observation Log

**Error**: [exact error message]
**Stack trace**: [full trace, not truncated]
**Reproduction**: [steps to reproduce]
**Actual behavior**: [what happens]
**Expected behavior**: [what should happen]
**Frequency**: [always / intermittent / specific conditions]
**First seen**: [when / what changed]
**Relevant state**: [environment, config, data, user context]
```

#### Step 2: HYPOTHESIZE -- Form a Specific, Testable Theory

Based on observations, form a concrete hypothesis about the root cause. Write it down explicitly before acting. A good hypothesis is:

- **Specific**: Points to a particular piece of code, configuration, or data condition
- **Testable**: Can be confirmed or disproven with a single targeted action
- **Falsifiable**: You know what result would disprove it

**Template:**
```markdown
## Hypothesis #[N]

**Theory**: [specific statement about what is causing the bug]
**Evidence for**: [observations that support this theory]
**Evidence against**: [observations that weaken this theory, if any]
**Test**: [what single action will confirm or disprove this]
**Expected result if correct**: [what you expect to see]
**Expected result if wrong**: [what you expect to see]
```

**Common hypothesis patterns:**
- "The error occurs because function X receives null when it expects a string, due to missing validation at the API boundary"
- "The race condition happens because operations A and B are not serialized, and B sometimes completes before A"
- "The regression was introduced in commit abc123, which changed the sort order of results"

**Pre-ACT business-invariants check:**

Before proceeding to Step 3 (ACT), follow the shared loader at `skills/code-review-playbook/references/load-business-invariants.md` with `mode: planning`. The loader handles file present / missing / sparse / user-skipped cases including the create-or-skip prompt.

If `status: loaded`: ask "does this hypothesis's *fix shape* (not just the diagnosis) risk violating any rule?" For example, a hypothesis that says "we need to query records without filtering by tenant_id" would touch invariant **I.1** (tenant isolation). Surface any matches as a one-liner before ACT:

> "Hypothesis touches **I.X** ([rule]). Verify the planned action preserves the rule before proceeding to ACT."

If `status: skipped` or `status: absent`: skip the check and proceed to ACT. Agent #10 in `/etk:review-mr` remains the authoritative gate — this check is additional, not a substitute.

#### Step 3: ACT -- Make ONE Targeted Change

Make a single, focused action to test your hypothesis. Do not combine multiple changes -- that makes it impossible to know which change produced the result.

**Valid actions:**
- Add a log statement or breakpoint to inspect a variable
- Run a test with specific input that should trigger the bug
- Check a condition or value at a particular point in the code
- Read a specific section of code that your hypothesis points to
- Run `git bisect` to find the introducing commit
- Check a configuration value or environment variable
- Query the database for the state of relevant records

**Invalid actions (at this stage):**
- Changing code to "try a fix"
- Modifying multiple files at once
- Refactoring code while debugging
- Applying a solution from Stack Overflow without understanding it

#### Step 4: OBSERVE -- Check the Result

Examine what your action revealed. Did the result match what your hypothesis predicted?

- **Hypothesis confirmed**: The root cause is identified. Proceed to fix.
- **Hypothesis partially confirmed**: You are on the right track but need to refine. The root cause is in this area but more specific.
- **Hypothesis disproven**: You learned something valuable. This eliminates a possibility and narrows the search space.

**Record the result:**
```markdown
## Hypothesis #[N] -- Result

**Action taken**: [what you did]
**Observed result**: [what happened]
**Conclusion**: [confirmed / partially confirmed / disproven]
**What this tells us**: [insight gained]
```

#### Step 5: ITERATE -- Refine or Pivot

If the hypothesis was disproven, use what you learned to form a better one. Each iteration should be informed by all previous results.

**If disproven**: Form a new hypothesis based on the combined evidence from all cycles so far. The new hypothesis should be consistent with ALL observations, including the ones that disproved the previous theory.

**If partially confirmed**: Narrow the hypothesis. You know the general area -- now get more specific.

**If confirmed**: Move on to the fix phase. You have identified the root cause.

### The 3-Cycle Escalation Rule

If stuck after 3 hypothesis cycles without converging on a root cause, escalate:

1. **Widen the search**: Step back and question your assumptions. Are you looking in the right subsystem? Is the bug where you think it is?
2. **Check assumptions**: Verify things you assumed were working correctly. Check configuration, environment, dependencies, data.
3. **Use different tools**: Switch debugging approaches -- use interactive debugging, add comprehensive logging, use `git bisect`, try binary search on the code path.
4. **Get a second perspective**: Describe what you have found and ruled out. Fresh eyes often spot the missed assumption.

Document each hypothesis and its outcome -- failed hypotheses are valuable data. They narrow the search space and prevent re-exploring dead ends.

---

## Bug Fix Workflow

Once the root cause is identified through the OHAOI loop, proceed with the fix.

### 1. Verify Root Cause Understanding

Before writing any fix, state the root cause clearly:

```markdown
## Root Cause

**What**: [precise description of the defect]
**Where**: [file(s) and line(s)]
**Why**: [why the code is wrong -- logic error, missing check, race condition, etc.]
**When introduced**: [commit or timeframe if known]
```

### 2. Write a Regression Test First

Write a test that reproduces the bug BEFORE fixing it. This test should:
- Fail with the current (buggy) code
- Pass after the fix is applied
- Cover the specific scenario described in the bug report

This ensures the bug is truly fixed and cannot silently regress.

### 3. Apply the Minimum Fix

Make the smallest change that addresses the root cause. Avoid the temptation to refactor or "improve" adjacent code during a bug fix -- that introduces risk and muddies the intent of the change.

### 4. Verify the Fix

- Confirm the regression test passes
- Run the full relevant test suite
- Manually verify the reproduction steps no longer trigger the bug
- Check for side effects in related functionality

### 5. Document the Fix

The commit message and MR description should explain the root cause and why the fix is correct, not just what code changed. Include the hypothesis log if the investigation was non-trivial.

---

## Integration with /fix-bug Command

This skill provides the debugging methodology used by the `/fix-bug` command. The command handles the operational workflow (Jira integration, branch creation, MR creation), while this skill provides the investigation discipline.

**Command phases that use this skill:**
- **Phase 3 (Investigate Root Cause)**: Apply the OHAOI loop instead of ad-hoc searching
- **Phase 4 (Fix the Bug)**: Follow the regression-test-first approach

---

## Quick Reference: Debugging Checklist

- [ ] **OBSERVE**: Read the full bug report and reproduce the issue
- [ ] **OBSERVE**: Capture error message, stack trace, actual vs expected, relevant state
- [ ] **HYPOTHESIZE**: Write down a specific, testable theory about the root cause
- [ ] **ACT**: Make ONE targeted action to test the hypothesis
- [ ] **OBSERVE**: Check if hypothesis was confirmed or disproven
- [ ] **ITERATE**: Refine hypothesis based on results, or proceed to fix if confirmed
- [ ] **ESCALATE** (if needed): After 3 cycles, widen search / check assumptions / change tools
- [ ] **FIX**: Write regression test, apply minimum fix, verify, document

---

## Reference Files

- `${CLAUDE_SKILL_DIR}/references/debugging-methodology.md` -- Detailed debugging methodology with examples and advanced techniques

---

**Skill Version**: 1.0.0
**Last Updated**: 2026-03-09

## Compliance

### Iron Laws

Violating the letter of these rules is violating the spirit of the rules.

**IRON LAW: NEVER APPLY A FIX WITHOUT FIRST REPRODUCING THE BUG**

**IRON LAW: NEVER CLOSE A BUG WITHOUT A REGRESSION TEST**

### Red Flags

| If You're Thinking... | Required Action |
|---|---|
| "I think I know what the bug is" | STOP. Thinking is not knowing. Follow the OHAOI loop — observe first. |
| "Let me try this quick fix" | STOP. Quick fixes that skip diagnosis create hidden regressions. Observe, then hypothesize. |
| "I can't reproduce it, but my fix should work" | STOP. A fix for an unreproduced bug is a guess. Reproduce it first or document why reproduction is impossible. |
| "The fix works, I don't need a test for this" | STOP. Every bug fix MUST have a regression test. Otherwise the same bug will return. |

### Common Rationalizations

| Rationalization | Why It's Wrong |
|---|---|
| "This is obviously a typo/simple error" | 'Obvious' bugs often have non-obvious root causes. The typo may be a symptom, not the disease. |
| "I can't reproduce it in development" | Environment differences matter. Document the reproduction gap and test in the closest available environment. |
| "Adding a regression test is overkill for this fix" | The bug existed because there was no test covering this case. Not adding one guarantees it can regress silently. |
