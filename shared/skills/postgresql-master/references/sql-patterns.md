# Production SQL Patterns

Best practices, anti-patterns, and safe query patterns for PostgreSQL.

## Table of Contents
1. [Safe Query Patterns](#safe-query-patterns)
2. [Performance Patterns](#performance-patterns)
3. [Transaction Management](#transaction-management)
4. [Common Anti-Patterns](#common-anti-patterns)
5. [Date/Time Operations](#datetime-operations)
6. [JSON Operations](#json-operations)

---

## Safe Query Patterns

### ✅ Parameterized Queries (SQL Injection Prevention)

**ALWAYS use parameterized queries with SQLAlchemy:**

```python
# ✅ CORRECT: Parameterized query
from sqlalchemy import text

email = user_input  # User-provided value
result = session.execute(
    text("SELECT * FROM users WHERE email = :email"),
    {"email": email}
)

# ✅ CORRECT: ORM query (automatically parameterized)
user = session.query(User).filter(User.email == email).first()

# ❌ WRONG: String interpolation (SQL injection vulnerability!)
query = f"SELECT * FROM users WHERE email = '{email}'"  # NEVER DO THIS
result = session.execute(text(query))
```

### Handling NULL Values

```sql
-- ✅ CORRECT: Use IS NULL / IS NOT NULL
SELECT * FROM users WHERE active_goal_id IS NULL;

-- ❌ WRONG: NULL comparisons don't work with = or !=
SELECT * FROM users WHERE active_goal_id = NULL;  -- Returns no results!
```

### Case-Insensitive Search

```sql
-- ✅ CORRECT: Use ILIKE for case-insensitive LIKE
SELECT * FROM users WHERE email ILIKE '%@example.com';

-- ✅ CORRECT: Use LOWER() for exact case-insensitive matches
SELECT * FROM users WHERE LOWER(email) = LOWER(:email);

-- ⚠️ WARNING: LOWER() prevents index usage - add functional index if frequent:
CREATE INDEX idx_user_email_lower ON users (LOWER(email));
```

### Date Range Queries

```sql
-- ✅ CORRECT: Use >= and < for date ranges
SELECT * FROM events
WHERE created_at >= '2025-01-01'
  AND created_at < '2025-02-01';

-- ❌ WRONG: BETWEEN includes both endpoints (may include unwanted times)
SELECT * FROM events
WHERE created_at BETWEEN '2025-01-01' AND '2025-01-31';  -- Misses 23:59:59
```

---

## Performance Patterns

### Efficient Pagination

```sql
-- ✅ CORRECT: Keyset pagination (cursor-based)
SELECT * FROM users
WHERE id > :last_id
ORDER BY id
LIMIT 100;

-- ⚠️ ACCEPTABLE: Offset pagination (only for small offsets)
SELECT * FROM users
ORDER BY id
LIMIT 100 OFFSET 0;

-- ❌ WRONG: Large offset pagination (very slow for large offsets)
SELECT * FROM users
ORDER BY id
LIMIT 100 OFFSET 10000;  -- Scans 10,100 rows to return 100
```

### Selective Columns

```sql
-- ✅ CORRECT: Select only needed columns
SELECT id, email, first_name FROM users;

-- ❌ WRONG: SELECT * unnecessarily transfers large data
SELECT * FROM users;  -- Returns all columns even if not needed
```

### Batch Operations

```python
# ✅ CORRECT: Bulk insert
from sqlalchemy import insert

users_data = [
    {"email": "user1@example.com", "first_name": "User1"},
    {"email": "user2@example.com", "first_name": "User2"},
    # ... 1000 more
]

session.execute(insert(User), users_data)
session.commit()

# ❌ WRONG: Individual inserts in loop
for data in users_data:
    user = User(**data)
    session.add(user)
    session.commit()  # Commits after EACH insert (very slow!)
```

### Counting Efficiently

```sql
-- ✅ CORRECT: COUNT(*) with WHERE (uses index)
SELECT COUNT(*) FROM users WHERE status = 'active';

-- ✅ CORRECT: Approximate count for large tables (very fast)
SELECT reltuples::bigint AS estimate
FROM pg_class
WHERE relname = 'users';

-- ❌ WRONG: COUNT(*) on large table without WHERE (table scan)
SELECT COUNT(*) FROM events;  -- May take minutes on large tables
```

---

## Transaction Management

### Atomic Operations

```python
# ✅ CORRECT: Use transaction context for multi-step operations
from sqlalchemy.orm import Session

with Session(engine) as session:
    try:
        # Step 1: Update user
        user = session.query(User).filter(User.id == user_id).first()
        user.status = 'inactive'

        # Step 2: Cancel subscription
        subscription = user.subscriptions[0]
        subscription.status = 'cancelled'

        # Step 3: Log event
        event = Event(user_id=user_id, event_type='cancellation')
        session.add(event)

        # Commit all or nothing
        session.commit()
    except Exception as e:
        session.rollback()  # Rollback on error
        raise

# ❌ WRONG: Multiple commits (not atomic)
session.add(user)
session.commit()  # Committed, can't rollback

session.add(subscription)
session.commit()  # If this fails, user already changed!
```

### Isolation Levels

```python
# ✅ CORRECT: Use appropriate isolation level for concurrent operations
from sqlalchemy import create_engine

# Default: READ COMMITTED (sufficient for most operations)
engine = create_engine(db_url)

# Use SERIALIZABLE for critical operations (e.g., financial transactions)
with engine.connect().execution_options(
    isolation_level="SERIALIZABLE"
) as conn:
    # Transactions are fully isolated
    result = conn.execute(text("UPDATE subscription SET status = 'active'"))
```

---

## Common Anti-Patterns

### N+1 Query Problem

```python
# ❌ WRONG: N+1 queries (1 query + N queries for related data)
users = session.query(User).all()  # 1 query
for user in users:
    print(user.subscriptions)  # N queries (one per user)

# ✅ CORRECT: Eager loading with joinedload
from sqlalchemy.orm import joinedload

users = session.query(User).options(
    joinedload(User.subscriptions)
).all()  # Single query with JOIN

# ✅ CORRECT: Eager loading with selectinload (better for one-to-many)
from sqlalchemy.orm import selectinload

users = session.query(User).options(
    selectinload(User.subscriptions)
).all()  # 2 queries total (User + Subscriptions), no N+1
```

### Implicit Cartesian Products

```sql
-- ❌ WRONG: Missing JOIN condition (cartesian product!)
SELECT * FROM users, subscription;  -- Returns users x subscription rows

-- ✅ CORRECT: Explicit JOIN with ON condition
SELECT * FROM users
JOIN subscription ON users.id = subscription.user_id;
```

### Redundant Subqueries

```sql
-- ❌ WRONG: Redundant subquery
SELECT * FROM users
WHERE id IN (SELECT user_id FROM user_subscription WHERE status = 'active');

-- ✅ CORRECT: Direct JOIN (faster, clearer)
SELECT u.* FROM users u
JOIN user_subscription us ON u.id = us.user_id
WHERE us.status = 'active';
```

### Using OR with Different Columns

```sql
-- ⚠️ SLOW: OR prevents index usage
SELECT * FROM users
WHERE first_name = 'John' OR last_name = 'Doe';  -- Can't use index efficiently

-- ✅ BETTER: UNION (uses indexes on both columns)
SELECT * FROM users WHERE first_name = 'John'
UNION
SELECT * FROM users WHERE last_name = 'Doe';
```

---

## Date/Time Operations

### Current Timestamp

```sql
-- ✅ CORRECT: Use CURRENT_TIMESTAMP for server time
INSERT INTO events (event_type, created_at)
VALUES ('login', CURRENT_TIMESTAMP);

-- ✅ CORRECT: Use NOW() (equivalent to CURRENT_TIMESTAMP)
INSERT INTO events (event_type, created_at)
VALUES ('login', NOW());

-- ❌ WRONG: Using application time (timezone issues, clock skew)
-- Let database handle timestamps
```

### Date Arithmetic

```sql
-- ✅ CORRECT: INTERVAL for date calculations
SELECT * FROM appointments
WHERE scheduled_at > CURRENT_TIMESTAMP + INTERVAL '7 days';

SELECT * FROM user_subscription
WHERE end_date < CURRENT_DATE - INTERVAL '30 days';

-- ✅ CORRECT: Date truncation
SELECT DATE_TRUNC('month', created_at) AS month, COUNT(*)
FROM users
GROUP BY month
ORDER BY month DESC;
```

### Timezone Handling

```python
# ✅ CORRECT: Store timestamps in UTC
from datetime import datetime, timezone

now_utc = datetime.now(timezone.utc)
user.created_at = now_utc

# ✅ CORRECT: Convert to timezone for display
SELECT created_at AT TIME ZONE 'America/New_York' AS local_time
FROM users;
```

---

## JSON Operations

### Querying JSON Fields

```sql
-- ✅ CORRECT: Query JSON fields with ->  and ->>
-- -> returns JSON object
-- ->> returns text

SELECT event_data->>'action' AS action
FROM events
WHERE event_type = 'survey_completed'
  AND (event_data->>'score')::int > 80;

-- ✅ CORRECT: Index JSON fields for performance
CREATE INDEX idx_events_action ON events ((event_data->>'action'));
```

### Updating JSON Fields

```python
# ✅ CORRECT: Update JSON field with func.jsonb_set
from sqlalchemy import func

session.query(Event).filter(Event.id == event_id).update(
    {
        Event.event_data: func.jsonb_set(
            Event.event_data,
            ['status'],
            '"completed"',
            True
        )
    },
    synchronize_session=False
)
session.commit()
```

---

## Security Patterns

### Row-Level Security (RLS)

```sql
-- ✅ CORRECT: Enable RLS for multi-tenant tables
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- Create policy: staff can only see their own notes
CREATE POLICY staff_notes_policy ON notes
FOR SELECT
TO staff_role
USING (staff_id = current_setting('app.current_staff_id')::int);
```

### Audit Logging

```sql
-- ✅ CORRECT: Trigger-based audit logging
CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    table_name TEXT,
    operation TEXT,
    old_data JSONB,
    new_data JSONB,
    changed_by TEXT,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (table_name, operation, old_data, new_data, changed_by)
        VALUES (TG_TABLE_NAME, 'UPDATE', row_to_json(OLD), row_to_json(NEW), current_user);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_audit_trigger
AFTER UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
```

---

## Performance Monitoring

### Using EXPLAIN

```sql
-- ✅ CORRECT: Analyze slow queries with EXPLAIN
EXPLAIN ANALYZE
SELECT u.*, s.*
FROM users u
JOIN user_subscription us ON u.id = us.user_id
WHERE us.status = 'active';

-- Look for:
-- - Sequential Scans (should be Index Scans)
-- - High execution time
-- - Large row estimates vs actual rows
```

### Query Optimization Checklist

1. **Use EXPLAIN ANALYZE** to understand execution plan
2. **Check for sequential scans** on large tables → add indexes
3. **Verify indexes are used** → check WHERE and JOIN columns
4. **Reduce data transfer** → select only needed columns
5. **Use appropriate joins** → INNER vs LEFT vs RIGHT
6. **Avoid N+1 queries** → use eager loading
7. **Batch operations** → bulk inserts/updates
8. **Use connection pooling** → reuse connections (already configured in project)

---

## Additional Resources

- PostgreSQL Documentation: https://www.postgresql.org/docs/
- SQL Performance Explained: https://use-the-index-luke.com/
- SQLAlchemy ORM Tutorial: https://docs.sqlalchemy.org/en/20/orm/tutorial.html
- Project-specific patterns: See `references/orm-patterns.md`
