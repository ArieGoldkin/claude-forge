# TypeScript Standards

Token-optimized reference for TypeScript code quality standards in platform.

---

## Function Standards

### Size & Complexity

| Rule | Target | Check Method |
|------|--------|--------------|
| Function length | < 50 lines | Manual count (excluding empty lines/comments) |
| Cyclomatic complexity | < 10 | Manual count (if/else, switch cases, loops, &&, \|\|) |
| Nesting depth | < 4 levels | Manual count |
| Parameters | ≤ 5 | Count function parameters |

### Examples

✅ **Good - Under 50 lines**:
```typescript
function fetchUserActivities(userId: string) {
  const { data, error } = useQuery({
    queryKey: ['user', userId, 'activities'],
    queryFn: () => apiClient.get(`/activities?user_id=${userId}`),
  });

  if (error) return <ErrorMessage error={error} />;
  if (!data) return <LoadingSpinner />;

  return data;
}
```

❌ **Bad - Over 50 lines, high complexity**:
```typescript
function processUserData(user: any) {  // 80+ lines with nested logic
  if (user) {
    if (user.email) {
      if (validateEmail(user.email)) {
        if (user.subscriptions) {
          for (const sub of user.subscriptions) {
            if (sub.active) {
              // ... 60 more lines
            }
          }
        }
      }
    }
  }
}
```

**Fix**: Extract to smaller functions:
```typescript
function processUserData(user: User) {
  validateUser(user);
  const activeSubs = getActiveSubscriptions(user);
  return processSubscriptions(activeSubs);
}
```

---

## Type Standards

### No `any` Types

✅ **Good**:
```typescript
function handleResponse(data: unknown) {
  if (isActivity(data)) {
    console.log(data.id);  // Type-safe
  }
}

function isActivity(data: unknown): data is Activity {
  return typeof data === 'object' && data !== null && 'id' in data;
}
```

❌ **Bad**:
```typescript
function handleResponse(data: any) {
  console.log(data.id);  // No type safety
}
```

### Use Specific Types

| Scenario | Use | Not |
|----------|-----|-----|
| Unknown data | `unknown` | `any` |
| Optional value | `T \| null \| undefined` | `any` |
| Function params | Interface/Type | `any` |
| API responses | Pydantic-generated types | `any` |

---

## Error Handling

### Try/Catch Required

✅ **Good**:
```typescript
async function saveActivity(data: ActivityRequest) {
  try {
    const response = await apiClient.post('/activities', data);
    return response.data;
  } catch (error) {
    if (error instanceof ApiError) {
      logger.error('API error', { code: error.code });
    }
    throw error;
  }
}
```

❌ **Bad**:
```typescript
async function saveActivity(data: ActivityRequest) {
  const response = await apiClient.post('/activities', data);  // No error handling
  return response.data;
}
```

### Specific Error Types

```typescript
class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Catch specific errors
try {
  validateActivity(data);
} catch (error) {
  if (error instanceof ValidationError) {
    showFieldError(error.field, error.message);
  } else {
    showGenericError();
  }
}
```

---

## Code Quality

### DRY Principle

❌ **Bad - Duplication**:
```typescript
function getUserActivities(userId: string) {
  const { data } = useQuery({
    queryKey: ['user', userId, 'activities'],
    queryFn: () => apiClient.get(`/activities?user_id=${userId}`),
  });
  return data;
}

function getUserGoals(userId: string) {
  const { data } = useQuery({
    queryKey: ['user', userId, 'goals'],
    queryFn: () => apiClient.get(`/goals?user_id=${userId}`),
  });
  return data;
}
```

✅ **Good - Extracted hook**:
```typescript
function useUserData<T>(userId: string, resource: string) {
  return useQuery({
    queryKey: ['user', userId, resource],
    queryFn: () => apiClient.get(`/${resource}?user_id=${userId}`),
  });
}

// Usage
const activities = useUserData(userId, 'activities');
const goals = useUserData(userId, 'goals');
```

### Clear Naming

| Type | Convention | Example |
|------|-----------|---------|
| Variables | `camelCase` | `userData`, `isLoading` |
| Functions | `camelCase` | `fetchActivities()`, `validateEmail()` |
| Classes/Interfaces | `PascalCase` | `ActivityList`, `UserProfile` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_RETRIES`, `API_BASE_URL` |
| Booleans | `is/has/should` prefix | `isActive`, `hasPermission`, `shouldRedirect` |

---

## Comments

### When to Comment

✅ **Good - Why, not what**:
```typescript
// Security: Don't log PII - use user_id only
logger.info('Activity created', { user_id: userId });

// Retry 3x due to upstream service instability (TICKET-123)
await retryOperation(fetchData, { maxRetries: 3 });
```

❌ **Bad - Obvious**:
```typescript
// Get user activities
const activities = await getUserActivities(userId);

// Check if user is logged in
if (isLoggedIn) {
  // ...
}
```

### Self-Documenting Code

✅ **Good - Clear without comments**:
```typescript
function isEligibleForRenewal(subscription: Subscription): boolean {
  const daysSinceStart = differenceInDays(new Date(), subscription.startDate);
  const isNearExpiration = daysSinceStart >= 350;
  const hasActiveStatus = subscription.status === 'active';

  return isNearExpiration && hasActiveStatus;
}
```

---

## Platform Specifics

### No PII in Code

❌ **Bad**:
```typescript
console.log(`User ${user.email} completed activity`);  // PII!
logger.info(`Processing for ${user.name}`);  // PII!
```

✅ **Good**:
```typescript
logger.info('Activity completed', {
  user_id: userId,
  activity_id: activityId
});
```

### Tenant Isolation

✅ **Good - Backend filters by user_id**:
```typescript
// Frontend trusts backend to filter
const { data } = useQuery({
  queryKey: ['user-activities'],
  queryFn: () => fetchUserActivities(),  // Backend adds user_id from JWT
});
```

❌ **Bad - Client-side filtering (insecure!)**:
```typescript
const allActivities = await fetchAllActivities();  // Cross-tenant leak!
const filtered = allActivities.filter(a => a.user_id === userId);
```

---

## Tool Enforcement

| Standard | Manual | Tool Enforced |
|----------|--------|---------------|
| Function < 50 lines | ✅ | ❌ |
| Complexity < 10 | ✅ | ❌ |
| No `any` types | ❌ | ✅ (tsconfig strict) |
| Unused variables | ❌ | ✅ (tsconfig) |
| Formatting | ❌ | ✅ (biome) |
| Naming conventions | ✅ | ❌ (biome gap) |

See `tool-configs/actual-tool-configs.md` for details.

---

## Quick Checklist

**Before submitting code:**

- [ ] Functions < 50 lines
- [ ] Complexity < 10 (count branches manually)
- [ ] No `any` types (use `unknown` or proper types)
- [ ] Try/catch for async operations
- [ ] Clear variable/function names (camelCase)
- [ ] No PII in logs (user_id only)
- [ ] No client-side tenant filtering
- [ ] No commented-out code
- [ ] No console.log (use logger)
- [ ] Comments explain "why", not "what"

**See also:**
- `react-standards.md` for component patterns
- `naming-conventions.md` for naming rules
- `python-standards.md` for backend patterns
