---
name: quality-gates
description: Complexity assessment and quality gates for task planning — 1-5 scoring, information gathering, escalation triggers. Triggers on quality gate, complexity assessment, task scoring, escalation, planning gate, readiness check, how complex is this
effort: low
keep-coding-instructions: true
---

# Quality Gates Skill

## Overview

This skill teaches agents how to assess task complexity, enforce quality gates, and prevent wasted work on incomplete or poorly-defined tasks. Inspired by production-grade development practices, quality gates ensure agents have sufficient context before proceeding and automatically escalate when stuck or blocked.

**Key Principle:** Stop and clarify before proceeding with incomplete information. Better to ask questions than to waste cycles on the wrong solution.

---

## Core Concepts

### 1. Complexity Scoring (1-5 Scale)

Assess every task on a 1-5 complexity scale:

**Level 1: Trivial**
- Single file change
- Simple variable rename
- Documentation update
- CSS styling tweak
- < 50 lines of code
- < 30 minutes estimated
- No dependencies
- No unknowns

**Level 2: Simple**
- 1-3 file changes
- Basic function implementation
- Simple API endpoint (CRUD)
- Straightforward component
- 50-200 lines of code
- 30 minutes - 2 hours estimated
- 0-1 dependencies
- Minimal unknowns

**Level 3: Moderate**
- 3-10 file changes
- Multiple component coordination
- API with validation and error handling
- State management integration
- Database schema changes
- 200-500 lines of code
- 2-8 hours estimated
- 2-3 dependencies
- Some unknowns that need research

**Level 4: Complex**
- 10-25 file changes
- Cross-cutting concerns
- Authentication/authorization
- Real-time features (WebSockets)
- Payment integration
- Database migrations with data
- 500-1500 lines of code
- 8-24 hours (1-3 days) estimated
- 4-6 dependencies
- Significant unknowns
- Multiple decision points

**Level 5: Very Complex**
- 25+ file changes
- Architectural changes
- New service/microservice
- Complete feature subsystem
- Third-party API integration
- Performance optimization
- 1500+ lines of code
- 24+ hours (3+ days) estimated
- 7+ dependencies
- Many unknowns
- Requires research and prototyping
- High risk of scope creep

### 2. Quality Gate Thresholds

**BLOCKING Conditions** (MUST resolve before proceeding):

1. **Incomplete Requirements** (>3 critical questions)
   - If you have more than 3 unanswered critical questions, STOP
   - Examples of critical questions:
     - "What should happen when X fails?"
     - "What data structure should I use?"
     - "What's the expected behavior for edge case Y?"
     - "Which API should I call?"
     - "What authentication method?"

2. **Missing Dependencies** (blocked by another task)
   - Task depends on incomplete work
   - Required API endpoint doesn't exist
   - Database schema not ready
   - External service not configured

3. **Stuck Detection** (3 attempts at same task)
   - Tried 3 different approaches, all failed
   - Keep encountering the same error
   - Can't find necessary information
   - Solution keeps breaking other things

4. **Evidence Failure** (tests/builds failing)
   - Tests fail after 2 fix attempts
   - Build breaks after changes
   - Type errors persist
   - Integration tests failing

5. **Complexity Overflow** (Level 4-5 tasks without breakdown)
   - Complex task not broken into subtasks
   - No clear implementation plan
   - Too many unknowns
   - Scope unclear

**WARNING Conditions** (Can proceed with caution):

1. **Moderate Complexity** (Level 3)
   - Can proceed but should verify approach first
   - Document assumptions
   - Plan for checkpoints

2. **1-2 Unanswered Questions**
   - Document assumptions
   - Proceed with best guess
   - Note for review later

3. **1-2 Failed Attempts**
   - Try alternative approach
   - Document what didn't work
   - Consider asking for help

### 3. Gate Validation Process

```markdown
## Quality Gate Check

**Task:** [Task description]
**Complexity:** [1-5 scale]
**Dependencies:** [List dependencies]

### Critical Questions (Must answer before proceeding)
1. [Question 1] - ✅ Answered / ❌ Unknown
2. [Question 2] - ✅ Answered / ❌ Unknown
3. [Question 3] - ✅ Answered / ❌ Unknown

**Unanswered Critical Questions:** [Count]

### Dependency Check
- [ ] All required APIs exist
- [ ] Database schema ready
- [ ] Required services running
- [ ] External APIs accessible
- [ ] Authentication configured

**Blocked Dependencies:** [List]

### Attempt History
- Attempt 1: [What was tried, outcome]
- Attempt 2: [What was tried, outcome]
- Attempt 3: [What was tried, outcome]

**Failed Attempts:** [Count]

### Gate Status
- ✅ **PASS** - Can proceed
- ⚠️ **WARNING** - Proceed with caution
- ❌ **BLOCKED** - Must resolve before proceeding

### Blocking Reasons (if blocked)
- [ ] >3 critical questions unanswered
- [ ] Missing dependencies
- [ ] 3+ failed attempts (stuck)
- [ ] Evidence shows failures
- [ ] Complexity too high without plan

### Actions Required
[List actions needed to unblock]
```

### Stuck Escalation Path

When stuck detection triggers (3+ failed attempts at the same problem):

1. **Stop and document** — Write down what you've tried and why each attempt failed
2. **Check assumptions** — Are your assumptions about inputs, state, or environment correct?
3. **Narrow the scope** — Can you isolate the failure to a smaller reproducible case?
4. **Escalate to debugger** — If `debug-skill` is installed, use interactive debugging:
   - Set a breakpoint at the failure point
   - Reproduce the failing scenario step by step
   - Observe actual runtime state vs expected state
   - Form a new hypothesis based on real data
5. **Ask for help** — If still stuck, present findings to the user with specific questions

---

## Workflows

See [references/workflows.md](${CLAUDE_SKILL_DIR}/references/workflows.md) for detailed workflow procedures:
- Pre-Task Gate Validation
- Stuck Detection & Escalation
- Complexity Breakdown (Level 4-5)
- Requirements Completeness Check

---

## Templates

See [references/templates.md](${CLAUDE_SKILL_DIR}/references/templates.md) for:
- Pre-Task Gate Check template
- Stuck Escalation template
- Complexity Breakdown template

---

## Integration with Context System

Quality gates integrate with the context system for tracking:

```javascript
// Add gate check to context
context.quality_gates = context.quality_gates || [];
context.quality_gates.push({
  task_id: taskId,
  timestamp: new Date().toISOString(),
  complexity_score: 3,
  gate_status: 'pass', // pass, warning, blocked
  critical_questions_count: 1,
  unanswered_questions: 1,
  dependencies_blocked: 0,
  attempt_count: 0,
  can_proceed: true
});
```

## Integration with Evidence System

Quality gates check for evidence before allowing completion:

```javascript
// Before marking task complete
const evidence = context.quality_evidence;
const hasPassingEvidence = (
  evidence?.tests?.exit_code === 0 ||
  evidence?.build?.exit_code === 0
);

if (!hasPassingEvidence) {
  return {
    gate_status: 'blocked',
    reason: 'no_passing_evidence',
    action: 'collect_evidence_first'
  };
}
```

---

## Best Practices

See [references/best-practices.md](${CLAUDE_SKILL_DIR}/references/best-practices.md) for detailed guidelines and common pitfalls.

**Key principles:**
- Always run gate check before starting (even for "simple" tasks)
- Document all assumptions when proceeding with warnings
- Track attempts for stuck detection (escalate after 3)
- Break down Level 4-5 tasks proactively

---

## Quick Reference

### Complexity Quick Check
- 1-3 files, < 200 lines, < 2 hours → **Level 1-2**
- 3-10 files, 200-500 lines, 2-8 hours → **Level 3**
- 10-25 files, 500-1500 lines, 8-24 hours → **Level 4**
- 25+ files, 1500+ lines, 24+ hours → **Level 5**

### Blocking Threshold Quick Check
- >3 critical questions unanswered → **BLOCK**
- Missing dependencies → **BLOCK**
- 3+ failed attempts → **BLOCK & ESCALATE**
- Level 4-5 without breakdown → **BLOCK**

### Gate Decision Quick Flow
```
1. Assess complexity (1-5)
2. Count critical questions unanswered
3. Check dependencies blocked
4. Check attempt count

if (questions > 3 || dependencies blocked || attempts >= 3) → BLOCK
else if (complexity >= 4 && no plan) → BLOCK
else if (complexity == 3 || questions 1-2) → WARNING
else → PASS
```

---

## Version History

**v1.0.0** - Initial release
- Complexity scoring (1-5 scale)
- Blocking thresholds
- Stuck detection and escalation
- Requirements completeness checks
- Context integration
- Templates and workflows

---

**Remember:** Quality gates prevent wasted work. Better to ask questions upfront than to build the wrong solution. When in doubt, BLOCK and escalate.
