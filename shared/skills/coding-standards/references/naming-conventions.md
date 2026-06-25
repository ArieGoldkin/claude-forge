# Naming Conventions

Cross-language naming standards.

---

## TypeScript/JavaScript

| Element | Convention | Examples |
|---------|-----------|----------|
| **Variables** | `camelCase` | `userData`, `isActive`, `totalCount` |
| **Functions** | `camelCase` | `fetchActivities()`, `validateEmail()`, `handleSubmit()` |
| **Classes** | `PascalCase` | `ActivityList`, `UserProfile`, `ApiClient` |
| **Interfaces** | `PascalCase` | `Activity`, `UserData`, `ApiResponse` |
| **Type Aliases** | `PascalCase` | `UserId`, `ActivityStatus`, `ApiCallback` |
| **Enums** | `PascalCase` | `UserRole`, `ActivityType`, `SubscriptionStatus` |
| **Enum Values** | `PascalCase` | `UserRole.Admin`, `ActivityType.Exercise` |
| **Constants** | `SCREAMING_SNAKE_CASE` | `MAX_RETRIES`, `API_BASE_URL`, `DEFAULT_TIMEOUT` |
| **Private** | `_leadingUnderscore` | `_internalHelper()`, `_cache` |
| **React Components** | `PascalCase` | `ActivityCard`, `UserProfile`, `LoadingSpinner` |
| **Custom Hooks** | `use` prefix + `camelCase` | `useActivities()`, `useUserData()`, `useAuth()` |
| **Event Handlers** | `handle` prefix + `camelCase` | `handleClick()`, `handleSubmit()`, `handleChange()` |
| **Boolean Variables** | `is/has/should` prefix | `isActive`, `hasPermission`, `shouldRedirect` |

### Examples

✅ **Good**:
```typescript
const userActivities = fetchUserActivities(userId);
const isActiveUser = checkUserStatus(user);
const MAX_ACTIVITIES = 100;

class ActivityManager {
  private _cache: Map<string, Activity>;

  handleActivityComplete(activityId: string) {
    // Implementation
  }
}

function useUserActivities(userId: string) {
  // Custom hook
}
```

❌ **Bad**:
```typescript
const UserActivities = fetchUserActivities(userId);  // Should be camelCase
const IsActiveUser = checkUserStatus(user);                 // Should be camelCase
const max_activities = 100;                                 // Should be SCREAMING_SNAKE_CASE

class activityManager {                                     // Should be PascalCase
  private cache: Map<string, Activity>;                     // Private should have _

  ActivityComplete(activityId: string) {                    // Should be camelCase
    // Implementation
  }
}
```

---

## Python

| Element | Convention | Examples |
|---------|-----------|----------|
| **Variables** | `snake_case` | `user_data`, `is_active`, `total_count` |
| **Functions** | `snake_case` | `fetch_activities()`, `validate_email()`, `handle_submit()` |
| **Classes** | `PascalCase` | `ActivityList`, `UserProfile`, `ApiClient` |
| **Constants** | `SCREAMING_SNAKE_CASE` | `MAX_RETRIES`, `API_BASE_URL`, `DEFAULT_TIMEOUT` |
| **Private** | `_leading_underscore` | `_internal_helper()`, `_cache` |
| **Protected** | `_leading_underscore` | `_validate()` |
| **Name Mangled** | `__double_underscore` | `__private_attr` (rarely used) |
| **Modules** | `snake_case` | `activity_service.py`, `user_utils.py` |
| **Packages** | `lowercase` | `activities`, `users`, `utils` |

### Examples

✅ **Good**:
```python
user_activities = fetch_user_activities(user_id)
is_active_user = check_user_status(user)
MAX_ACTIVITIES = 100

class ActivityManager:
    def __init__(self):
        self._cache: dict[str, Activity] = {}

    def handle_activity_complete(self, activity_id: str) -> None:
        # Implementation
        pass

    def _internal_validate(self) -> bool:
        # Private method
        pass
```

❌ **Bad**:
```python
UserActivities = fetch_user_activities(user_id)  # Should be snake_case
IsActiveUser = check_user_status(user)                 # Should be snake_case
max_activities = 100                                   # Should be SCREAMING_SNAKE_CASE

class activityManager:                                 # Should be PascalCase
    def __init__(self):
        self.cache: dict[str, Activity] = {}           # Private should have _

    def ActivityComplete(self, activity_id: str) -> None:  # Should be snake_case
        pass
```

---

## File Naming

| File Type | Convention | Examples |
|-----------|-----------|----------|
| **TypeScript/JS files** | `kebab-case.ts` | `activity-card.tsx`, `user-profile.ts`, `api-client.ts` |
| **Python files** | `snake_case.py` | `activity_service.py`, `user_utils.py`, `api_client.py` |
| **Test files (TS)** | `*.test.ts` or `*.spec.ts` | `activity-card.test.tsx`, `api-client.spec.ts` |
| **Test files (Python)** | `test_*.py` or `*_test.py` | `test_activity_service.py`, `api_client_test.py` |
| **React Components** | `PascalCase.tsx` OR `kebab-case.tsx` | `ActivityCard.tsx` OR `activity-card.tsx` |

**Note**: prefer one convention per project — e.g. `kebab-case.tsx` for React components (feature-based structure).

---

## Database Naming

| Element | Convention | Examples |
|---------|-----------|----------|
| **Tables** | `snake_case` | `orders`, `user_subscriptions`, `audit_notes` |
| **Columns** | `snake_case` | `user_id`, `created_at`, `is_active` |
| **Foreign Keys** | `{table}_id` | `user_id`, `order_id`, `product_id` |
| **Indexes** | `idx_{table}_{column}` | `idx_orders_user_id`, `idx_users_email` |
| **Constraints** | `{type}_{table}_{column}` | `pk_orders_id`, `fk_orders_user_id`, `uq_users_email` |

### SQLAlchemy Models

✅ **Good**:
```python
class Order(Base):
    __tablename__ = "orders"  # snake_case table name

    id = Column(String, primary_key=True)            # snake_case column
    user_id = Column(String, ForeignKey("users.id"))  # snake_case FK
    product_id = Column(String)                      # snake_case column
    completed_at = Column(DateTime)                  # snake_case column
    created_at = Column(DateTime)                    # snake_case column

    user = relationship("User", back_populates="orders")  # PascalCase class
```

---

## API Naming

| Element | Convention | Examples |
|---------|-----------|----------|
| **Endpoints** | `kebab-case` | `/order-items`, `/action-items`, `/audit-notes` |
| **Path Parameters** | `camelCase` OR `snake_case` | `/users/{userId}` OR `/users/{user_id}` |
| **Query Parameters** | `snake_case` | `?user_id=123&start_date=2024-01-01` |
| **JSON Keys** | `snake_case` | `{"user_id": "123", "created_at": "2024-01-01"}` |
| **HTTP Methods** | UPPERCASE | `GET`, `POST`, `PUT`, `DELETE`, `PATCH` |

✅ **Good**:
```
GET /api/v1/order-items?user_id=123&start_date=2024-01-01
POST /api/v1/orders

{
  "user_id": "123",
  "product_id": "456",
  "completed_at": "2024-01-01T10:00:00Z"
}
```

---

## Boolean Naming

### Prefixes for Clarity

| Prefix | Meaning | Examples |
|--------|---------|----------|
| **is** | State | `isActive`, `is_valid`, `isLoading` |
| **has** | Possession | `hasPermission`, `has_subscription`, `hasError` |
| **can** | Ability | `canEdit`, `can_delete`, `canAccess` |
| **should** | Recommendation | `shouldRedirect`, `should_notify`, `shouldValidate` |
| **will** | Future action | `willExpire`, `will_retry`, `willUpdate` |

✅ **Good**:
```typescript
const isActiveSubscription = subscription.status === 'active';
const hasAdminPermission = user.role === 'admin';
const canEditProfile = checkPermission(user, 'edit:profile');
const shouldShowBanner = !user.hasSeenWelcome;
```

❌ **Bad**:
```typescript
const activeSubscription = subscription.status === 'active';  // Unclear if boolean
const adminPermission = user.role === 'admin';                 // Unclear if boolean
const editProfile = checkPermission(user, 'edit:profile');     // Unclear if boolean
```

---

## Acronyms & Abbreviations

### Capitalization Rules

| Type | TypeScript/JS | Python | Example |
|------|--------------|--------|---------|
| **2-letter acronyms** | ALL CAPS | ALL CAPS | `apiURL`, `API_URL` |
| **3+ letter acronyms** | First letter caps only | ALL CAPS | `apiClient`, `API_CLIENT` |

✅ **Good**:
```typescript
const apiURL = 'https://api.example.com';  // 2-letter: ALL CAPS
const htmlContent = '<div>...</div>';      // 3+: First letter only
const httpClient = new HTTPClient();       // 3+: First letter only in var, class is special

class APIClient { }  // Class names: acronyms often all caps
```

```python
API_URL = 'https://api.example.com'  # ALL CAPS for constants
html_content = '<div>...</div>'      # snake_case
http_client = HTTPClient()           # snake_case var, PascalCase class
```

---

## Domain-Specific Conventions

Once your project settles on a domain vocabulary, use it consistently — pick one term per
concept and don't mix synonyms. The example below uses an e-commerce domain; substitute your
own terms.

| Element | Convention | Example |
|---------|-----------|---------|
| **User IDs** | `userId` / `user_id` | Not `customerId` |
| **Order IDs** | `orderId` / `order_id` | Not `purchaseId` |
| **Products** | `productId` / `product_id` | Domain-specific term, used consistently |
| **Line Items** | `lineItemId` / `line_item_id` | Items within an order |
| **Categories** | `categoryId` / `category_id` | Not `group` |

✅ **Good**:
```typescript
function fetchUserOrders(userId: string) {
  // Uses one consistent term per concept
}
```

❌ **Bad**:
```typescript
function fetchCustomerPurchases(customerId: string) {
  // Mixes synonyms (customer vs user, purchase vs order)
}
```

---

## Tool Enforcement

| Language | Manual | Tool Enforced |
|----------|--------|---------------|
| **TypeScript** | ✅ | ❌ (biome gap - should add useNamingConvention) |
| **Python** | ✅ | ❌ (ruff gap - should enable pep8-naming "N") |

See `tool-configs/gaps-and-recommendations.md` for how to enable tool enforcement.

---

## Quick Reference Card

```
TypeScript:
- Variables/Functions: camelCase
- Classes/Interfaces: PascalCase
- Constants: SCREAMING_SNAKE_CASE
- Components: PascalCase
- Hooks: useCamelCase
- Files: kebab-case.ts

Python:
- Variables/Functions: snake_case
- Classes: PascalCase
- Constants: SCREAMING_SNAKE_CASE
- Files: snake_case.py
- Private: _leading_underscore

Database:
- Tables: snake_case
- Columns: snake_case
- FKs: {table}_id

API:
- Endpoints: /kebab-case
- JSON keys: snake_case
```
