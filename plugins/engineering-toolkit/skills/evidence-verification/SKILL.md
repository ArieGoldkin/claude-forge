---
name: evidence-verification
description: Evidence-based verification — test results, coverage metrics, build artifacts, deployment health checks before marking tasks done. Triggers on evidence, verify done, proof of completion, definition of done, is it actually done, mark complete
effort: low
keep-coding-instructions: true
---

# Evidence-Based Verification Skill

## Overview

This skill teaches agents how to collect and verify evidence before marking tasks complete. Inspired by production-grade development practices, it ensures all claims are backed by executable proof: test results, coverage metrics, build success, and deployment verification.

**Key Principle:** Show, don't tell. No task is complete without verifiable evidence.

---

## Core Concepts

### 1. Evidence Types

**Test Evidence**
- Exit code (must be 0 for success)
- Test suite results (passed/failed/skipped)
- Coverage percentage (if available)
- Test duration

**Build Evidence**
- Build exit code (0 = success)
- Compilation errors/warnings
- Build artifacts created
- Build duration

**Deployment Evidence**
- Deployment status (success/failed)
- Environment deployed to
- Health check results
- Rollback capability verified

**Code Quality Evidence**
- Linter results (errors/warnings)
- Type checker results
- Security scan results
- Accessibility audit results

### 2. Evidence Collection Protocol

```markdown
## Evidence Collection Steps

1. **Identify Verification Points**
   - What needs to be proven?
   - What could go wrong?
   - What does "complete" mean?

2. **Execute Verification**
   - Run tests
   - Run build
   - Run linters
   - Check deployments

3. **Capture Results**
   - Record exit codes
   - Save output snippets
   - Note timestamps
   - Document environment

4. **Store Evidence**
   - Add to shared context
   - Reference in task completion
   - Link to artifacts
```

### 3. Verification Standards

**Minimum Evidence Requirements:**
- At least ONE verification type executed
- Exit code captured (0 = pass, non-zero = fail)
- Timestamp recorded
- Evidence stored in context

**Production-Grade Requirements:**
- Tests pass (exit code 0)
- Coverage >70% (or project standard)
- Build succeeds (exit code 0)
- No critical linter errors
- Security scan passes

---

## Evidence Collection Templates

For evidence collection templates (test, build, code quality, combined), see [references/evidence-templates.md](${CLAUDE_SKILL_DIR}/references/evidence-templates.md) and the [templates/](/templates/) directory.

The `${CLAUDE_SKILL_DIR}/templates/` directory contains fill-in-the-blank templates with worked examples:
- `test-evidence.md` -- test execution evidence with pass/fail examples
- `build-evidence.md` -- build execution evidence with success/failure examples
- `evidence-checklist.md` -- comprehensive checklist for all evidence types

---

## Workflows

See [references/workflows.md](${CLAUDE_SKILL_DIR}/references/workflows.md) for detailed step-by-step workflows:
- Code Implementation Verification
- Code Review Verification
- Production Deployment Verification
- Evidence Storage guidelines

---

## Quality Standards

See [references/quality-standards.md](${CLAUDE_SKILL_DIR}/references/quality-standards.md) for:
- Minimum, Production-Grade, and Gold Standard requirements
- Common pitfalls and how to avoid them
- Evidence requirements by task type

---

## Integration with Other Systems

See [references/integration.md](${CLAUDE_SKILL_DIR}/references/integration.md) for how evidence verification integrates with:
- **Context System** -- automatic tracking in shared context (`quality_evidence`)
- **Quality Gates** -- blocking task completion when evidence is missing
- **Squad Mode** -- parallel evidence collection and orchestrator validation

---

## Examples

See [examples/](${CLAUDE_SKILL_DIR}/examples/) for:
- Sample evidence reports
- Real-world verification scenarios
- Integration examples

---

**Remember:** Evidence-first development prevents hallucinations, ensures production quality, and builds confidence. When in doubt, collect more evidence, not less.
