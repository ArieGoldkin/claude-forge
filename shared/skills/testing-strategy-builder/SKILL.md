---
name: testing-strategy-builder
description: Testing strategy — unit/integration/E2E/performance planning with Jest, Vitest, Playwright, pytest. Coverage targets and CI/CD gates
effort: medium
keep-coding-instructions: true
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "tests/**"
  - "vitest.config.*"
  - "jest.config.*"
  - "pytest.ini"
disallowed-tools:
  - Edit
  - Write
  - NotebookEdit
---

# Testing Strategy Builder

## Overview

This skill provides comprehensive guidance for building effective testing strategies that ensure software quality, reliability, and maintainability. Whether starting from scratch or improving existing test coverage, this framework helps teams design robust testing approaches.

**When to use this skill:**
- Planning testing strategy for new projects
- Improving test coverage
- Establishing quality gates
- Designing test automation
- Creating test plans
- Implementing continuous testing

---

## Testing Philosophy

### The Testing Trophy 🏆

Modern testing follows the "Testing Trophy" model:

```
         🏆
       /    \
      /  E2E  \         ← Few (critical journeys)
     /----------\
    / Integration\      ← Many (component interactions)
   /--------------\
  /     Unit       \    ← Most (business logic)
 /------------------\
/  Static Analysis   \  ← Foundation (linting, types)
```

**Balance:** 70% integration, 20% unit, 10% E2E (adjust based on context)

---

## Coverage Targets

**Recommended Targets:**
- **Overall Code Coverage**: 80% minimum
- **Critical Paths**: 95-100% (payment, auth, data mutations)
- **New Features**: 100% requirement
- **Business Logic**: 90%+
- **UI Components**: 70%+

**Coverage Types:**
- **Line Coverage**: % of lines executed
- **Branch Coverage**: % of decision branches taken
- **Function Coverage**: % of functions called

**Important:** Coverage is a metric, not a goal. 100% coverage ≠ bug-free code.

---

## Test Types Quick Reference

### Static Analysis
**Purpose**: Catch errors before runtime
**Tools**: ESLint, TypeScript, Pylint, mypy
**When**: Pre-commit hooks, CI pipeline

### Unit Tests
**Purpose**: Test isolated business logic
**Tools**: Jest, Vitest, pytest
**Characteristics:**
- Fast (< 100ms per test)
- No external dependencies
- Deterministic
- Single responsibility

**Coverage Target:** 90%+ for business logic

**For detailed examples:** See [`references/code-examples.md` → Unit Test Examples](${CLAUDE_SKILL_DIR}/references/code-examples.md)

### Integration Tests
**Purpose**: Test component interactions
**Tools**: Testing Library, Supertest, pytest fixtures
**Characteristics:**
- Multiple units together
- Test databases or mocked services
- Moderate execution (< 1s)

**Coverage Target:** 70%+ for API endpoints

**For detailed examples:** See [`references/code-examples.md` → Integration Test Examples](${CLAUDE_SKILL_DIR}/references/code-examples.md)

### End-to-End (E2E) Tests
**Purpose**: Validate critical user journeys
**Tools**: Playwright, Cypress, Selenium
**Characteristics:**
- Full stack (frontend + backend + database)
- Slow (5-30s per test)
- Production-like environment

**Coverage Target:** 5-10 critical journeys

**For detailed examples:** See [`references/code-examples.md` → End-to-End Test Examples](${CLAUDE_SKILL_DIR}/references/code-examples.md)

### Performance Tests
**Purpose**: Validate system under load
**Tools**: k6, Artillery, Locust
**Types:**
- Load testing (expected load)
- Stress testing (breaking point)
- Spike testing (traffic surges)
- Soak testing (sustained load)

**For detailed examples:** See [`references/code-examples.md` → Performance Test Examples](${CLAUDE_SKILL_DIR}/references/code-examples.md)

---

## Testing Patterns

### AAA Pattern (Arrange-Act-Assert)

```typescript
test('calculates total price', () => {
  // Arrange
  const items = [{ price: 10 }, { price: 20 }];

  // Act
  const total = calculateTotal(items);

  // Assert
  expect(total).toBe(30);
});
```

### Given-When-Then Pattern

```
Given [initial context]
When [action occurs]
Then [expected outcome]
```

### Test Isolation

**Each test should be independent:**
- Fresh test database per test
- Clean up resources after
- No execution order dependency

### Mocking vs Real Dependencies

**When to Mock:**
- External APIs (payment gateways, third-party)
- Slow operations (file I/O, network)
- Non-deterministic behavior (time, random)
- Hard-to-test scenarios (errors, edge cases)

**When to Use Real:**
- Fast, deterministic operations
- Critical business logic
- Database operations (test DB)
- Internal service interactions

**For complete patterns:** See [`references/code-examples.md` → Mocking / Snapshot / Parameterized / Test Isolation](${CLAUDE_SKILL_DIR}/references/code-examples.md)

---

## Risk-Based Testing

Prioritize by risk:

**High Risk (100% coverage):**
- Payment processing
- Authentication/authorization
- Data mutations
- Security operations
- Compliance features

**Medium Risk (80% coverage):**
- Business logic
- Data transformations
- API integrations

**Low Risk (50% coverage):**
- UI styling
- Static content
- Read-only operations

---

## CI/CD Integration

### Pipeline Stages (Quick Pattern)

```yaml
# GitHub Actions example
name: Test Pipeline
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v3
      - run: npm run test:e2e
```

### Quality Gates

**Block merges if:**
- Coverage drops below threshold (80%)
- Any tests fail
- Linting errors exist
- Performance regression > 10%
- Security vulnerabilities found

### Test Execution Strategy

**On Every Commit:**
- Static analysis (lint, type check)
- Unit tests
- Fast integration tests (< 5 min)

**On Pull Request:**
- All tests (unit + integration + E2E)
- Coverage report
- Performance benchmarks

**On Deploy to Staging:**
- Full E2E suite
- Load testing

**On Production:**
- Smoke tests (critical paths)
- Health checks

The pipeline pattern and quality gates above are the CI/CD guidance shipped with this skill.

---

## Testing Tools

### JavaScript/TypeScript

| Category | Tool | Use Case |
|----------|------|----------|
| **Unit/Integration** | Vitest | Vite-native, fast |
| **Unit/Integration** | Jest | Mature ecosystem |
| **E2E** | Playwright | Cross-browser, reliable |
| **E2E** | Cypress | Visual debugging |
| **Component** | Testing Library | User-centric |
| **API** | Supertest | HTTP assertions |
| **Performance** | k6 | Load testing |

### Python

| Category | Tool | Use Case |
|----------|------|----------|
| **Unit/Integration** | pytest | Powerful, fixtures |
| **API** | httpx + pytest | Async support |
| **E2E** | Playwright (Python) | Browser automation |
| **Performance** | Locust | Python-based load testing |

---

## Common Anti-Patterns

### ❌ Testing Implementation Details
```typescript
// Bad: Testing internal state
expect(component.state.isLoading).toBe(false);

// Good: Testing user-visible behavior
expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
```

### ❌ Tests Too Coupled to Code
```typescript
// Bad: Breaks when implementation changes
expect(userService.save).toHaveBeenCalledTimes(1);

// Good: Test behavior, not implementation
const user = await db.users.findOne({ email: 'test@example.com' });
expect(user).toBeTruthy();
```

### ❌ Flaky Tests
```typescript
// Bad: Non-deterministic timeout
await waitFor(() => {
  expect(screen.getByText('Success')).toBeInTheDocument();
}, { timeout: 1000 }); // Might fail on slow CI

// Good: Explicit waits with longer timeout
await screen.findByText('Success', {}, { timeout: 5000 });
```

### ❌ Giant Test Cases
```typescript
// Bad: One test does too much
test('user workflow', async () => {
  // 100 lines testing signup, login, profile, logout...
});

// Good: Focused tests
test('user can sign up', async () => { /* ... */ });
test('user can login', async () => { /* ... */ });
```

The anti-patterns above are the complete set shipped with this skill.

---

## Quick Start Checklist

When starting a new project or feature:

- [ ] Define coverage targets (overall, critical, new code)
- [ ] Choose testing framework (Jest/Vitest, Playwright)
- [ ] Set up test infrastructure (test DB, fixtures)
- [ ] Implement static analysis (ESLint, TypeScript)
- [ ] Write unit tests for business logic (90%+)
- [ ] Write integration tests for APIs (70%+)
- [ ] Write E2E tests for critical journeys (5-10 flows)
- [ ] Configure CI/CD pipeline with quality gates
- [ ] Set up coverage reporting (Codecov)
- [ ] Document testing conventions in README

---

## Detailed References

- [Testing Code Examples](${CLAUDE_SKILL_DIR}/references/code-examples.md) — worked examples for every tier: unit (AAA / Given-When-Then), integration (API + test DB), E2E (full user journey + **test-selector / data-testid best practices**), performance (k6 load tests), plus test-data factories/fixtures, mocking, snapshot, parameterized, and test-isolation patterns.

---

**Skill Version**: 2.0.1
**Last Updated**: 2026-07-02
