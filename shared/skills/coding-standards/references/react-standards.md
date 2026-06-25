# React Standards

Token-optimized reference for React 19 component standards in platform.

---

## Component Standards

### Size Limits

| Type | Max Lines | Rationale |
|------|-----------|-----------|
| **Components** | 300 lines | Maintainability, testability |
| **Functions inside components** | 50 lines | Same as general functions |
| **Custom hooks** | 100 lines | Reusable logic should be focused |

✅ **Good - Focused component**:
```tsx
function ActivityCard({ activity }: { activity: Activity }) {
  const handleComplete = useActivityCompletion(activity.id);

  return (
    <Card data-testid="activity-card">
      <CardHeader title={activity.name} />
      <CardContent>{activity.description}</CardContent>
      <CardActions>
        <Button onClick={handleComplete}>Mark Complete</Button>
      </CardActions>
    </Card>
  );
}
```

❌ **Bad - Too large (350+ lines)**:
```tsx
function ActivityPage() {
  // 100 lines of state management
  // 80 lines of API logic
  // 70 lines of validation
  // 100 lines of JSX
  // Total: 350+ lines - SPLIT THIS!
}
```

**Fix**: Extract to smaller components and hooks:
```tsx
function ActivityPage() {
  const { activities, isLoading } = useActivities();  // Custom hook
  const { handleSubmit } = useActivityForm();        // Custom hook

  if (isLoading) return <LoadingState />;

  return (
    <PageLayout>
      <ActivityHeader />
      <ActivityList activities={activities} />
      <ActivityForm onSubmit={handleSubmit} />
    </PageLayout>
  );
}
```

---

## React 19 Patterns

### Data Fetching with `use()` Hook

✅ **Good - React 19 pattern**:
```tsx
import { use } from 'react';

function UserProfile({ userPromise }: { userPromise: Promise<User> }) {
  const user = use(userPromise);  // Suspends until ready

  return <div>{user.name}</div>;
}

// Parent with Suspense
function App() {
  const userPromise = fetchUser(userId);

  return (
    <Suspense fallback={<LoadingSpinner />}>
      <UserProfile userPromise={userPromise} />
    </Suspense>
  );
}
```

❌ **Bad - Old useEffect pattern**:
```tsx
function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetchUser(userId).then(setUser);  // Don't use useEffect for data
  }, [userId]);

  return <div>{user?.name}</div>;
}
```

### TanStack Query (Primary Pattern)

✅ **Good - TanStack Query with proper keys**:
```tsx
function useActivities(userId: string) {
  return useQuery({
    queryKey: ['user', userId, 'activities'],  // Hierarchical key
    queryFn: () => fetchUserActivities(userId),
  });
}

function ActivityList() {
  const { data: activities, error, isLoading } = useActivities(userId);

  if (error) return <ErrorMessage error={error} />;
  if (isLoading) return <LoadingSpinner />;

  return activities.map(activity => <ActivityCard key={activity.id} activity={activity} />);
}
```

### Cache Invalidation

✅ **Good - Precise invalidation**:
```tsx
const createActivity = useMutation({
  mutationFn: (data: ActivityRequest) => apiClient.createActivity(data),
  onSuccess: () => {
    // Invalidate specific query
    queryClient.invalidateQueries({
      queryKey: ['user', userId, 'activities']
    });
  },
});
```

---

## Component Patterns

### Props Validation

✅ **Good - TypeScript interfaces**:
```tsx
interface ActivityCardProps {
  activity: Activity;
  onComplete: (id: string) => void;
  isDisabled?: boolean;
}

function ActivityCard({ activity, onComplete, isDisabled = false }: ActivityCardProps) {
  // Implementation
}
```

### Default Props

✅ **Good - Destructuring with defaults**:
```tsx
function Button({ variant = 'primary', size = 'medium', children }: ButtonProps) {
  return <button className={`btn-${variant}-${size}`}>{children}</button>;
}
```

❌ **Bad - Old defaultProps (deprecated in React 19)**:
```tsx
Button.defaultProps = {  // Don't use this!
  variant: 'primary',
  size: 'medium',
};
```

---

## Testing Standards

### data-testid for QA

✅ **Good - Semantic test IDs**:
```tsx
function ActivityCard({ activity }: ActivityCardProps) {
  return (
    <Card data-testid="activity-card" data-activity-id={activity.id}>
      <CardHeader data-testid="activity-card-title">
        {activity.name}
      </CardHeader>
      <Button data-testid="activity-complete-btn" onClick={handleComplete}>
        Mark Complete
      </Button>
    </Card>
  );
}
```

**Naming convention for data-testid:**
- Pattern: `{component}-{element}-{type}`
- Examples:
  - `activity-card` (container)
  - `activity-card-title` (element within card)
  - `activity-complete-btn` (button action)
  - `user-profile-form` (form)
  - `user-profile-submit-btn` (form submit)

See `.claude/instructions/test-selectors.md` for complete patterns.

### Test Coverage

```tsx
// Good test structure
describe('ActivityCard', () => {
  it('renders activity name', () => {
    render(<ActivityCard activity={mockActivity} />);
    expect(screen.getByTestId('activity-card-title')).toHaveTextContent(mockActivity.name);
  });

  it('calls onComplete when button clicked', () => {
    const onComplete = vi.fn();
    render(<ActivityCard activity={mockActivity} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('activity-complete-btn'));
    expect(onComplete).toHaveBeenCalledWith(mockActivity.id);
  });
});
```

---

## Hooks Best Practices

### Custom Hooks

✅ **Good - Focused hook**:
```tsx
function useActivityCompletion(activityId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.completeActivity(activityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

// Usage
function ActivityCard({ activity }: ActivityCardProps) {
  const { mutate: completeActivity } = useActivityCompletion(activity.id);

  return <Button onClick={() => completeActivity()}>Complete</Button>;
}
```

### Hook Dependencies

✅ **Good - Exhaustive deps**:
```tsx
useEffect(() => {
  const interval = setInterval(() => {
    refreshData(userId);
  }, 5000);

  return () => clearInterval(interval);
}, [userId, refreshData]);  // All dependencies listed
```

❌ **Bad - Missing deps**:
```tsx
useEffect(() => {
  refreshData(userId);  // userId not in deps!
}, []);  // Empty deps
```

---

## Performance Patterns

### Memoization

✅ **Good - Expensive calculations**:
```tsx
function UserStats({ activities }: { activities: Activity[] }) {
  const stats = useMemo(() => {
    // Expensive calculation
    return calculateDetailedStats(activities);
  }, [activities]);

  return <StatsDisplay stats={stats} />;
}
```

❌ **Bad - Over-memoization**:
```tsx
function SimpleComponent({ count }: { count: number }) {
  const doubled = useMemo(() => count * 2, [count]);  // Unnecessary!
  return <div>{doubled}</div>;
}
```

### useCallback

✅ **Good - Prevent re-renders**:
```tsx
function Parent() {
  const handleClick = useCallback((id: string) => {
    updateActivity(id);
  }, []);  // Stable reference

  return <ChildComponent onClick={handleClick} />;
}

const ChildComponent = React.memo(({ onClick }: { onClick: (id: string) => void }) => {
  // Won't re-render if onClick ref stable
});
```

---

## Styling Standards

### Tailwind CSS (V2 - shadcn/ui)

✅ **Good - Semantic classes**:
```tsx
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      {children}
    </div>
  );
}
```

### Material-UI (V1 - Legacy)

✅ **Good - Consistent with V1 patterns**:
```tsx
import { Card, CardContent, Button } from '@mui/material';

function ActivityCard({ activity }: ActivityCardProps) {
  return (
    <Card>
      <CardContent>
        {activity.name}
      </CardContent>
      <Button variant="contained">Complete</Button>
    </Card>
  );
}
```

**Note**: V2 migration uses shadcn/ui + Tailwind. See architecture docs.

---

## Platform Specifics

### No PII in Frontend State

❌ **Bad - PII in local storage**:
```tsx
localStorage.setItem('userEmail', user.email);  // PII!
```

✅ **Good - Only IDs**:
```tsx
localStorage.setItem('userId', user.id);  // Not PII
```

### Feature-Based Structure

✅ **Good - Organized by feature**:
```
src/features/actions/
├── api/
│   ├── queries.ts          # TanStack Query hooks
│   └── mutations.ts
├── components/
│   ├── activity-card/
│   │   ├── activity-card.tsx
│   │   └── activity-card.test.tsx
│   └── activity-list/
├── pages/
│   └── action-page.tsx     # Page component
└── types/
    └── activity.ts          # TypeScript types
```

---

## Tool Enforcement

| Standard | Manual | Tool Enforced |
|----------|--------|---------------|
| Component < 300 lines | ✅ | ❌ |
| Function < 50 lines | ✅ | ❌ |
| Props typed | ❌ | ✅ (tsconfig) |
| data-testid present | ✅ | ❌ |
| Hook deps exhaustive | ⚠️ | ⚠️ (partial - biome) |
| Naming conventions | ✅ | ❌ |

---

## Quick Checklist

**Before submitting component:**

- [ ] Component < 300 lines (split if larger)
- [ ] Functions < 50 lines
- [ ] Props properly typed (TypeScript interface)
- [ ] data-testid on interactive elements
- [ ] React 19 patterns (use() for data, not useEffect)
- [ ] TanStack Query with hierarchical keys
- [ ] Error boundaries for error handling
- [ ] Suspense for loading states
- [ ] No PII in localStorage/state
- [ ] Proper memoization (useMemo/useCallback when needed)
- [ ] Tests with >80% coverage

**See also:**
- `typescript-standards.md` for TypeScript rules
- `naming-conventions.md` for naming patterns
- `.claude/instructions/test-selectors.md` for data-testid patterns
