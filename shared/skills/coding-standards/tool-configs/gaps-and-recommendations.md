# Tool Configuration Gaps & Recommendations

**Purpose**: Document what SHOULD be added to tool configs to enforce documented standards.

**Note**: This file documents recommended configurations WITHOUT actually changing project config files. Use for awareness and future improvements.

---

## Priority 1: Critical Gaps (🔴 High Impact)

### 1. Enable Ruff Python Linting (CRITICAL)

**Current state**: Ruff configured but NO linting rules enabled

**Impact**: Python code has ZERO automated quality checks

**Recommended configuration** (`pyproject.toml`):

```toml
[tool.ruff]
line-length = 100
target-version = "py312"
exclude = [".claude", ".mise", ".npm", ".git", "node_modules", "venv"]

[tool.ruff.lint]
select = [
    "E",      # pycodestyle errors
    "F",      # pyflakes
    "C90",    # mccabe complexity
    "I",      # isort (import sorting)
    "N",      # pep8-naming
    "B",      # flake8-bugbear
    "S",      # flake8-bandit (security)
    "A",      # flake8-builtins
    "PT",     # flake8-pytest-style
]
ignore = ["D203", "D213"]  # Conflicting docstring rules

[tool.ruff.lint.mccabe]
max-complexity = 10  # Enforce complexity < 10

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S101"]  # Allow assert in tests
"lambdas/**/test_*.py" = ["S101"]
```

**What this enables:**
- ✅ Cyclomatic complexity < 10 (matches documented standard)
- ✅ Line length limit (100 chars)
- ✅ Import sorting
- ✅ Naming conventions (snake_case, PascalCase)
- ✅ Security checks (bandit)
- ✅ Bug detection (bugbear)
- ✅ Basic quality (pycodestyle, pyflakes)

**Impact**: Automates 7 manual review checks

---

### 2. Add Complexity Rules to Biome

**Current state**: Biome has NO complexity enforcement

**Impact**: TypeScript/React complexity not checked automatically

**Recommended configuration** (`biome.json`):

```json
{
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": {
        "useLiteralKeys": "off",
        "noExcessiveCognitiveComplexity": {
          "level": "error",
          "options": { "maxComplexity": 15 }
        }
      }
    }
  }
}
```

**What this enables:**
- ✅ Cognitive complexity < 15 (approximates cyclomatic < 10)

**Note**: Biome uses "cognitive complexity" (not McCabe cyclomatic). Threshold 15 ≈ cyclomatic 10.

**Impact**: Automates complexity checking for TypeScript

---

### 3. Enforce Test Coverage Thresholds

**Current state**: Coverage runs but doesn't fail builds

**Impact**: Tests can pass with 0% coverage

#### Frontend (Vitest)

**Recommended configuration** (`vitest.config.ts`):

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
      // Fail build if coverage below thresholds
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80
      }
    }
  }
});
```

#### Backend (Pytest)

**Recommended configuration** (each lambda's `pyproject.toml`):

```toml
[tool.coverage.run]
source = ["."]
omit = ["tests/*", "test_*.py"]

[tool.coverage.report]
fail_under = 80  # Fail if coverage < 80%
show_missing = true
```

**What this enables:**
- ✅ Build fails if coverage < 80%
- ✅ Matches documented standard

**Impact**: Automates coverage enforcement

---

## Priority 2: Important Gaps (🟡 Medium Impact)

### 4. Add Naming Convention Rules

**Current state**: No automated naming checks

**Impact**: Inconsistent naming (camelCase vs snake_case)

#### TypeScript (Biome)

**Recommended addition** (`biome.json`):

```json
{
  "linter": {
    "rules": {
      "style": {
        "useNamingConvention": {
          "level": "error",
          "options": {
            "conventions": [
              {
                "selector": { "kind": "function" },
                "formats": ["camelCase", "PascalCase"]
              },
              {
                "selector": { "kind": "variable" },
                "formats": ["camelCase", "PascalCase", "CONSTANT_CASE"]
              },
              {
                "selector": { "kind": "typeLike" },
                "formats": ["PascalCase"]
              }
            ]
          }
        }
      }
    }
  }
}
```

#### Python (Ruff)

**Already included in Priority 1** - Ruff's "N" (pep8-naming) rules enforce Python naming

**What this enables:**
- ✅ TypeScript: Enforce camelCase (functions), PascalCase (classes)
- ✅ Python: Enforce snake_case (functions), PascalCase (classes)

**Impact**: Automates naming convention checks

---

### 5. Add Line Length Limits

**Current state**: No line length limits

**Impact**: Inconsistent line lengths, hard-to-read code

**Recommended:**
- **TypeScript**: Add to `biome.json`: `"lineWidth": 100`
- **Python**: Already in Priority 1 ruff config (`line-length = 100`)

**Configuration** (`biome.json`):

```json
{
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100  // ADD THIS
  }
}
```

**What this enables:**
- ✅ Consistent line length across codebase
- ✅ Better code readability

**Impact**: Improves consistency and readability

---

### 6. Add Import Sorting

**Current state**: No import sorting

**Impact**: Inconsistent import order

**Recommended:**
- **TypeScript**: Biome doesn't have import sorting yet (as of v1.9.4)
- **Python**: Already in Priority 1 ruff config ("I" = isort)

**Python**: Automatically sorted with Priority 1 ruff config

**TypeScript**: Use external tool or wait for Biome support

**Impact**: Automates import organization (Python only currently)

---

## Priority 3: Nice-to-Have (🟢 Low Impact)

### 7. Add Docstring Requirements

**Current state**: No docstring enforcement

**Impact**: Missing documentation

**Recommended** (Python only - add to ruff config):

```toml
[tool.ruff.lint]
select = [
    # ... existing rules
    "D",      # pydocstyle (docstrings)
]

[tool.ruff.lint.pydocstyle]
convention = "google"  # or "numpy", "pep257"
```

**What this enables:**
- ✅ Requires docstrings for public functions/classes
- ✅ Enforces docstring format

**Impact**: Improves code documentation

---

### 8. Add React-Specific Linting

**Current state**: Biome has basic React support

**Enhancement**: Add React-specific rules

**Recommended** (`biome.json`):

```json
{
  "linter": {
    "rules": {
      "correctness": {
        "useExhaustiveDependencies": "error",  // Enforce hook deps
        "useHookAtTopLevel": "error"            // Hooks at top level
      },
      "suspicious": {
        "noArrayIndexKey": "warn"  // Don't use array index as key
      }
    }
  }
}
```

**What this enables:**
- ✅ React hooks dependency checking
- ✅ React best practices

**Impact**: Prevents common React bugs

---

## Summary: Gap Impact Analysis

| Gap | Priority | Enforcement Gap | Recommendation |
|-----|----------|----------------|----------------|
| **Ruff linting** | 🔴 Critical | Python: ZERO rules | Add comprehensive rule set |
| **Biome complexity** | 🔴 Critical | TS: No complexity checks | Add cognitive complexity rule |
| **Coverage thresholds** | 🔴 Critical | No build failures | Add coverage.thresholds |
| **Naming conventions** | 🟡 Important | Manual review only | Add Biome useNamingConvention + Ruff N |
| **Line length** | 🟡 Important | No limit | Add lineWidth: 100 |
| **Import sorting** | 🟡 Important | Manual review only | Ruff isort (I) rule |
| **Docstrings** | 🟢 Nice-to-have | No requirement | Add Ruff pydocstyle (D) |
| **React linting** | 🟢 Nice-to-have | Basic only | Add React-specific rules |

---

## Implementation Strategy

**If implementing gaps (user decision, not automatic):**

### Phase 1: Critical (Immediate)
1. Enable ruff linting with comprehensive rules (~30 min)
2. Add biome complexity rules (~5 min)
3. Add coverage thresholds to vitest/pytest (~15 min)

**Expected impact**: 60-70% of manual reviews automated

### Phase 2: Important (Short-term)
4. Add naming convention rules (~15 min)
5. Add line length limits (~5 min)

**Expected impact**: 80-85% of manual reviews automated

### Phase 3: Nice-to-have (Long-term)
6. Add docstring requirements
7. Enhanced React rules

**Expected impact**: 90%+ of manual reviews automated

---

## Testing Recommendations After Changes

**If configurations are updated**, test with:

### Frontend
```bash
# Check for new errors introduced by stricter rules
npx biome check frontend/ --diagnostic-level=error

# Fix auto-fixable issues
npx biome check frontend/ --fix

# Verify TypeScript still compiles
cd frontend/web && npm run build
```

### Backend
```bash
# Check for new errors
uv run ruff check . --output-format=github

# Fix auto-fixable issues
uv run ruff check . --fix

# Verify tests still pass
uv run pytest
```

### Coverage
```bash
# Verify coverage thresholds work
cd frontend/web && npm run test:coverage
cd lambdas/users/get-user-data && uv run pytest --cov --cov-fail-under=80
```

---

## Why Gaps Exist

**Likely reasons for current minimal configuration:**

1. **Gradual adoption**: Team may plan to incrementally add rules
2. **Legacy code**: Existing code may not pass stricter rules
3. **Developer preference**: Team may prefer manual review flexibility
4. **Migration in progress**: Configs may be undergoing transition

**This documentation helps**: Agents understand current reality vs. ideal state, enabling informed code review decisions.

---

**Note**: This file is FOR AWARENESS ONLY. Do not automatically apply these configurations. They are recommendations for future consideration by the development team.
