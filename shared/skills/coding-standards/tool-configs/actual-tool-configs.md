# Actual Tool Configurations

**Purpose**: Document what linting/formatting tools ACTUALLY enforce today in the platform.

**Last Updated**: 2026-01-12

---

## biome.json (Frontend - TypeScript/React)

**Location**: `/biome.json`

**Scope**: Applies to `**/frontend/**/*.ts*`, `**/frontend/**/*.js`, `**/frontend/**/*.*css`

### Formatting (Enforced ✅)

```json
{
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  },
  "javascript": {
    "formatter": {
      "semicolons": "always",
      "quoteStyle": "double"
    }
  },
  "css": {
    "formatter": {
      "indentStyle": "space",
      "indentWidth": 2,
      "lineEnding": "lf",
      "quoteStyle": "double"
    }
  }
}
```

**What this enforces:**
- ✅ Indentation: 2 spaces (not tabs)
- ✅ Semicolons: Always required
- ✅ Quotes: Double quotes only
- ✅ Line endings: LF (Unix-style)

### Linting (Partial ✅)

```json
{
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": {
        "useLiteralKeys": "off"
      }
    }
  }
}
```

**What this enforces:**
- ✅ Biome's recommended rule set (various code quality checks)
- ⚠️ Complexity checks: `useLiteralKeys` explicitly disabled

**What this does NOT enforce:**
- ❌ Function size limits (< 50 lines)
- ❌ Cyclomatic complexity thresholds (< 10)
- ❌ Line length limits
- ❌ Naming conventions (camelCase, PascalCase)
- ❌ Import sorting

### Available But Not Configured

Biome supports these rules but they are NOT enabled:

**Complexity rules:**
- `noExcessiveCognitiveComplexity` - Could enforce complexity < 15
- `noForEach` - Enforce modern .map() over .forEach()

**Style rules:**
- `useNamingConvention` - Enforce camelCase/PascalCase
- `useImportType` - Enforce type-only imports

**Performance rules:**
- `noAccumulatingSpread` - Prevent performance issues

---

## ruff (Backend - Python)

**Location**: `/pyproject.toml`

**Scope**: Entire Python workspace (lambdas/users/*, lambdas/admin/*, lambdas/core/*)

### Current Configuration (❌ CRITICAL GAP)

```toml
[tool.ruff]
exclude = [
    ".claude", ".mise", ".npm", ".git",
    # ... many exclusions
]
```

**What this enforces:**
- ❌ **NOTHING** - No linting rules enabled
- ❌ **NOTHING** - No formatting rules enabled
- ❌ **NOTHING** - Only file exclusions configured

### Critical Gaps

**What ruff SHOULD enforce but doesn't:**

1. **Line length**: No limit (typically 88-120)
2. **Complexity**: No McCabe complexity checks
3. **Code style**: No pycodestyle (E, W) checks
4. **Code quality**: No pyflakes (F) checks
5. **Import sorting**: No isort (I) checks
6. **Naming**: No pep8-naming (N) checks
7. **Docstrings**: No pydocstyle (D) checks
8. **Security**: No flake8-bandit (S) checks
9. **Best practices**: No flake8-bugbear (B) checks
10. **Type annotations**: No type hint checks

### What Ruff COULD Enforce

Ruff supports comprehensive Python linting via rule selection:

```toml
# NOT CURRENTLY CONFIGURED - Example only
[tool.ruff.lint]
select = [
    "E",      # pycodestyle errors
    "F",      # pyflakes
    "C90",    # mccabe complexity
    "I",      # isort
    "N",      # pep8-naming
    "D",      # pydocstyle (docstrings)
    "UP",     # pyupgrade
    "B",      # flake8-bugbear
    "S",      # flake8-bandit (security)
    "A",      # flake8-builtins
    "PT",     # flake8-pytest-style
]

[tool.ruff.lint.mccabe]
max-complexity = 10
```

**Result**: Python code quality is entirely manual review with ZERO automated enforcement.

---

## tsconfig.json (Frontend - TypeScript Type Checking)

**Location**: `/frontend/web/tsconfig.app.json` (also admin, reports)

**Scope**: TypeScript compilation and type checking

### Type Safety (Enforced ✅)

```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  }
}
```

**What this enforces:**
- ✅ **Strict mode**: All TypeScript strict checks
  - `noImplicitAny` - No implicit `any` types
  - `strictNullChecks` - Null/undefined checking
  - `strictFunctionTypes` - Function type checking
  - `strictBindCallApply` - Strict bind/call/apply
  - `strictPropertyInitialization` - Class property initialization
  - `alwaysStrict` - ES strict mode
- ✅ **Unused code**: Flags unused variables and parameters
- ✅ **Switch statements**: Requires explicit break/return
- ✅ **Side effects**: Validates side-effect imports

**What this does NOT enforce:**
- ❌ Complexity limits
- ❌ Function size limits
- ❌ Naming conventions (camelCase, PascalCase)
- ❌ Comment requirements

### Build Configuration

```json
{
  "target": "ES2022",
  "lib": ["ES2023", "DOM", "DOM.Iterable"],
  "module": "ESNext",
  "moduleResolution": "bundler",
  "jsx": "react-jsx"
}
```

**Enforces**: React 19 + modern ES2022+ syntax

---

## Test Coverage (Vitest/Pytest)

### Vitest (Frontend)

**Location**: `/vitest.config.ts`

**Current configuration**: NO coverage thresholds configured

**Gap**: Should enforce:
```typescript
// NOT CURRENTLY CONFIGURED
export default defineConfig({
  test: {
    coverage: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80
    }
  }
});
```

### Pytest (Backend)

**Location**: Various `pyproject.toml` files

**Current configuration**: NO coverage thresholds configured

**Gap**: Should enforce:
```toml
# NOT CURRENTLY CONFIGURED
[tool.coverage.report]
fail_under = 80
```

---

## Summary Table

| Tool | Purpose | Enforcement Level |
|------|---------|------------------|
| **biome.json** | TS/React formatting + linting | ⚠️ Partial (formatting ✅, limited linting) |
| **ruff** | Python linting | ❌ None (critical gap!) |
| **tsconfig.json** | TypeScript type safety | ✅ Strong (strict mode) |
| **vitest** | Frontend test coverage | ❌ None (gap) |
| **pytest** | Backend test coverage | ❌ None (gap) |

---

## Commands to Check Tool Compliance

### Frontend (TypeScript/React)

```bash
# Run formatting check
npx biome check frontend/

# Run formatting with auto-fix
npx biome check --fix frontend/

# TypeScript type checking
cd frontend/web && npm run typecheck

# Run tests
cd frontend/web && npm test
```

### Backend (Python)

```bash
# Run ruff (currently does nothing)
uv run ruff check .

# Python type checking (not configured)
# mypy not currently used

# Run tests
cd lambdas/users/get-user-data && uv run pytest
```

---

## Reality Check

**What agents think is enforced vs. reality:**

| Standard | Agent Expectation | Tool Reality |
|----------|------------------|--------------|
| Function < 50 lines | Manual review | ✅ Correct - manual only |
| Complexity < 10 | Tool enforced | ❌ FALSE - manual only |
| Coverage > 80% | Tool enforced | ❌ FALSE - manual only |
| Line length | Defined | ❌ FALSE - not defined |
| Import sorting | Tool enforced | ❌ FALSE - manual only |
| Python linting | Tool enforced | ❌ FALSE - ruff has NO rules |

**Implication**: Most quality standards require manual review because tools lack configuration.
