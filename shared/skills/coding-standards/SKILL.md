---
name: coding-standards
description: Code quality standards — function size, cyclomatic complexity, test coverage, naming conventions, biome/ruff enforcement
effort: medium
keep-coding-instructions: true
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.py"
  - "**/*.js"
  - "biome.json"
  - ".eslintrc*"
  - "ruff.toml"
disallowed-tools:
  - Edit
  - Write
  - NotebookEdit
---

# Coding Standards

## Overview

Single source of truth for code quality standards across TypeScript and Python in the platform. Defines limits for function size, complexity, test coverage, and naming conventions. Documents what tools actually enforce vs. what requires manual review.

---

## Quick Reference

### Function & Component Limits

| Metric | TypeScript | Python | Enforcement |
|--------|-----------|--------|-------------|
| **Function size** | < 50 lines | < 50 lines | ⚠️ Manual review only |
| **Component size** | < 300 lines (React) | N/A | ⚠️ Manual review only |
| **Cyclomatic complexity** | < 10 | < 10 | ❌ NOT enforced (gap!) |
| **Nesting depth** | < 4 levels | < 4 levels | ⚠️ Manual review only |

### Quality Metrics

| Standard | Target | Enforcement |
|----------|--------|-------------|
| **Test coverage** | > 80% | ❌ NOT enforced (gap!) |
| **Line length** | Not defined | ❌ NOT enforced (gap!) |
| **Import sorting** | Not defined | ❌ NOT enforced (gap!) |

### Naming Conventions

| Language | Variables/Functions | Classes/Interfaces | Constants |
|----------|-------------------|-------------------|-----------|
| **TypeScript** | `camelCase` | `PascalCase` | `SCREAMING_SNAKE_CASE` |
| **Python** | `snake_case` | `PascalCase` | `SCREAMING_SNAKE_CASE` |

See [references/naming-conventions.md](${CLAUDE_SKILL_DIR}/references/naming-conventions.md) for complete rules.

---

## Tool Enforcement Reality

### What's Actually Enforced Today

**biome.json** (TypeScript/React):
- ✅ **Formatting**: 2 spaces, double quotes, semicolons, LF line endings
- ✅ **Recommended rules**: Biome's default linting rules
- ⚠️ **Partial enforcement**: `useLiteralKeys` disabled
- ❌ **NOT enforced**: Complexity limits, line length, function size

**ruff** (Python):
- ❌ **CRITICAL GAP**: NO linting rules enabled (only exclusions configured)
- ❌ **NOT enforced**: Complexity, line length, naming, imports, docstrings

**tsconfig.json** (TypeScript):
- ✅ **Strict mode**: All TypeScript strict checks enabled
- ✅ **Unused code**: Flags unused locals and parameters
- ✅ **Type safety**: No unchecked side effect imports
- ❌ **NOT enforced**: Complexity, function size

See [tool-configs/actual-tool-configs.md](tool-configs/actual-tool-configs.md) for detailed analysis.

### Critical Gaps

See [tool-configs/gaps-and-recommendations.md](tool-configs/gaps-and-recommendations.md) for:
- What SHOULD be added to biome.json (complexity rules, naming conventions)
- What SHOULD be added to ruff (ALL linting rules currently missing)
- What SHOULD be added to coverage configs (enforce 80% thresholds)

---

## Language-Specific Standards

### TypeScript
Detailed standards including functions, types, React patterns, and error handling.

**Read**: [references/typescript-standards.md](${CLAUDE_SKILL_DIR}/references/typescript-standards.md)

**Quick checks:**
- Function size & complexity within the Quick Reference limits above
- No `any` types (use `unknown` or proper types)
- Proper error handling with try/catch
- Clear variable/function names

### Python
Detailed standards including functions, type hints, docstrings, and Lambda patterns.

**Read**: [references/python-standards.md](${CLAUDE_SKILL_DIR}/references/python-standards.md)

**Quick checks:**
- Function size & complexity within the Quick Reference limits above
- Type hints on all function signatures
- Pydantic models for validation
- No PII in logs

### React
Component architecture, hooks, props, and UI patterns.

**Read**: [references/react-standards.md](${CLAUDE_SKILL_DIR}/references/react-standards.md)

**Quick checks:**
- Component size within the Quick Reference limit above
- Proper hook usage (React 19 `use()` for data fetching)
- TanStack Query patterns
- data-testid for QA testing

### Naming Conventions
Cross-language naming rules with examples.

**Read**: [references/naming-conventions.md](${CLAUDE_SKILL_DIR}/references/naming-conventions.md)

**Summary:**
- **TypeScript**: camelCase (vars/functions), PascalCase (classes), SCREAMING_SNAKE_CASE (constants)
- **Python**: snake_case (vars/functions), PascalCase (classes), SCREAMING_SNAKE_CASE (constants)

---

## Integration with Other Skills

**code-review-playbook**: Use this skill to know WHAT standards to check during reviews

**quality-gates**: Task complexity scoring references these function size limits

**evidence-verification**: Coverage thresholds (>80%) defined here

**security-checklist**: Security standards (OWASP Top 10) separate

---

## Standards by Check Type

The numeric limits and their enforcement status (manual / tool-enforced / gap) are the **Enforcement** column of the [Quick Reference](#quick-reference) tables above (the single source) plus the [Tool Enforcement Reality](#tool-enforcement-reality) section. This section adds only the standards that carry no number and so aren't in those tables:

**Manual review only (not tool-checkable):**
- DRY principle (no unnecessary duplication)
- Clear variable/function names
- Comments where logic isn't self-evident

See [tool-configs/gaps-and-recommendations.md](tool-configs/gaps-and-recommendations.md) for remediation of the ❌ gaps.

---

## Usage Examples

### Example 1: Code Review

**Scenario**: Reviewing a PR with a new API endpoint

**Check against standards:**
1. Function size: Is `handleRequest()` < 50 lines? (manual)
2. Complexity: Does it have < 10 branches? (manual)
3. Types: Are all parameters properly typed? (tsconfig enforces)
4. Naming: Is function name `camelCase`? (manual, should be in biome)
5. Coverage: Does it have tests with >80% coverage? (manual, should be enforced)

**Reference**: Use [references/python-standards.md](${CLAUDE_SKILL_DIR}/references/python-standards.md) for Python-specific checks

### Example 2: Writing New Code

**Scenario**: Implementing a React component

**Follow standards:**
1. Component < 300 lines (see [references/react-standards.md](${CLAUDE_SKILL_DIR}/references/react-standards.md))
2. Use `PascalCase` for component name (see [references/naming-conventions.md](${CLAUDE_SKILL_DIR}/references/naming-conventions.md))
3. Functions < 50 lines, complexity < 10
4. Add data-testid for QA (see [references/react-standards.md](${CLAUDE_SKILL_DIR}/references/react-standards.md))
5. Use React 19 patterns (see [references/react-standards.md](${CLAUDE_SKILL_DIR}/references/react-standards.md))

### Example 3: Understanding Tool Reality

**Scenario**: Developer asks "Does biome enforce complexity limits?"

**Check tool configs:**
1. Read [tool-configs/actual-tool-configs.md](tool-configs/actual-tool-configs.md)
2. Answer: NO, biome.json does NOT have complexity rules configured
3. Alternative: Manual review required until gap is addressed
4. Long-term: See [tool-configs/gaps-and-recommendations.md](tool-configs/gaps-and-recommendations.md)

---

## Version History

**v1.0.0** - Initial release
- Core standards documented (function size, complexity, coverage, naming)
- Tool enforcement reality documented
- Critical gaps identified
- Progressive disclosure with 4 reference files + 2 tool-config files

---

**Token Optimization**: SKILL.md ~250 lines, detailed patterns in references/ (loaded as needed)
