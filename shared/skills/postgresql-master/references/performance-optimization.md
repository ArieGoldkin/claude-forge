# Performance Optimization Guide

## Table of Contents

- [Quick Reference](#quick-reference)
- [Indexing Strategy](#indexing-strategy)
  - [When to Add Indexes](#when-to-add-indexes)
  - [Index Types](#index-types)
  - [Index Maintenance](#index-maintenance)
- [Query Optimization](#query-optimization)
  - [Use EXPLAIN ANALYZE](#use-explain-analyze)
  - [Optimization Techniques](#optimization-techniques)
- [Connection Pooling](#connection-pooling)
  - [Lambda Configuration (Already Configured)](#lambda-configuration-already-configured)
  - [Connection Best Practices](#connection-best-practices)
- [Caching Strategies](#caching-strategies)
  - [Application-Level Caching](#application-level-caching)
  - [Database Query Result Caching](#database-query-result-caching)
- [Monitoring and Alerts](#monitoring-and-alerts)
  - [Key Metrics to Monitor](#key-metrics-to-monitor)
  - [Slow Query Logging](#slow-query-logging)
- [Lambda-Specific Optimizations](#lambda-specific-optimizations)
  - [Cold Start Mitigation](#cold-start-mitigation)
  - [Reduce Lambda Package Size](#reduce-lambda-package-size)
- [Performance Checklist](#performance-checklist)
- [Troubleshooting Slow Queries](#troubleshooting-slow-queries)

Query optimization, indexing strategies, and caching patterns for PostgreSQL.

## Quick Reference

**Performance Issues**:
- Slow queries → EXPLAIN ANALYZE, add indexes
- High database CPU → Optimize queries, connection pooling
- N+1 queries → Eager loading (selectinload/joinedload)
- Large result sets → Pagination, selective columns
- Lock contention → Reduce transaction scope

---

## Indexing Strategy

### When to Add Indexes

**Add indexes for:**
- Foreign keys (always)
- WHERE clause columns (frequent queries)
- JOIN columns
- ORDER BY columns
- Columns in GROUP BY

**Avoid indexes for:**
- Small tables (<1000 rows)
- Columns with low cardinality (few distinct values)
- Frequently updated columns (write overhead)

### Index Types

```sql
-- B-tree index (default, most common)
CREATE INDEX idx_user_email ON users(email);

-- Partial index (only index subset of rows)
CREATE INDEX idx_active_user_subscription ON user_subscription(user_id)
WHERE status = 'active';

-- Composite index (multi-column)
CREATE INDEX idx_events_user_type ON events(user_id, event_type);

-- Functional index (for computed values)
CREATE INDEX idx_user_email_lower ON users(LOWER(email));

-- GIN index (for JSON/array columns)
CREATE INDEX idx_events_data_gin ON events USING GIN (event_data);
```

### Index Maintenance

```sql
-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;

-- Rebuild bloated indexes
REINDEX INDEX idx_user_email;

-- Analyze table statistics (helps query planner)
ANALYZE users;
```

---

## Query Optimization

### Use EXPLAIN ANALYZE

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT u.* FROM users u
JOIN user_subscription us ON u.id = us.user_id
WHERE us.status = 'active';
```

**Key metrics to watch:**
- Execution Time < 100ms (good), < 500ms (acceptable), >1s (needs optimization)
- Sequential Scan on large tables → add index
- High buffer reads → add/improve indexes
- Nested Loop on large datasets → verify join strategy

### Optimization Techniques

**1. Reduce data scanned**:
```sql
-- Bad: Scans entire table
SELECT * FROM events WHERE EXTRACT(YEAR FROM created_at) = 2025;

-- Good: Uses index on created_at
SELECT * FROM events
WHERE created_at >= '2025-01-01' AND created_at < '2026-01-01';
```

**2. Use covering indexes**:
```sql
-- Query needs: id, email, created_at
CREATE INDEX idx_user_covering ON users(status, created_at)
INCLUDE (id, email);

-- Query can be satisfied entirely from index (no table lookup)
SELECT id, email, created_at FROM users
WHERE status = 'active'
ORDER BY created_at DESC
LIMIT 100;
```

**3. Optimize aggregations**:
```sql
-- Bad: Counts all rows
SELECT COUNT(*) FROM events;

-- Good: Use estimate for approximate counts
SELECT reltuples::bigint FROM pg_class WHERE relname = 'events';

-- Good: Add filter to reduce rows counted
SELECT COUNT(*) FROM events
WHERE created_at > CURRENT_DATE - INTERVAL '30 days';
```

---

## Connection Pooling

### Lambda Configuration (Already Configured)

```python
# Project's connection pooling (utils/database/db_utils.py)
engine = create_engine(
    database_url,
    poolclass=QueuePool,
    pool_size=2,              # Small pool for Lambda
    max_overflow=0,           # No overflow in Lambda
    pool_pre_ping=True,       # Verify connection health
    pool_recycle=3600,        # Recycle after 1 hour
)
```

### Connection Best Practices

- **Reuse connections**: Lambda caches engine globally
- **Close sessions**: Always use context managers
- **Avoid long transactions**: Keep transactions short
- **Use read replicas**: For read-heavy workloads (if configured)

---

## Caching Strategies

### Application-Level Caching

```python
# Cache frequently accessed static data
from functools import lru_cache

@lru_cache(maxsize=100)
def get_categories():
    """Cache categories (rarely change)"""
    return session.query(Category).all()

# Cache with TTL using external cache (Redis)
import redis
cache = redis.Redis(host='localhost', port=6379)

def get_user_stats(user_id):
    cache_key = f"user_stats:{user_id}"
    cached = cache.get(cache_key)

    if cached:
        return json.loads(cached)

    # Query database
    stats = calculate_user_stats(user_id)

    # Cache for 1 hour
    cache.setex(cache_key, 3600, json.dumps(stats))

    return stats
```

### Database Query Result Caching

```sql
-- Use materialized views for expensive aggregations
CREATE MATERIALIZED VIEW user_stats_mv AS
SELECT
    user_id,
    COUNT(DISTINCT activity_id) AS actions_started,
    COUNT(first_completion_at) AS actions_completed,
    MAX(start_at) AS last_activity
FROM user_activities
GROUP BY user_id;

-- Refresh periodically (e.g., nightly)
REFRESH MATERIALIZED VIEW user_stats_mv;

-- Query is instant
SELECT * FROM user_stats_mv WHERE user_id = 123;
```

---

## Monitoring and Alerts

### Key Metrics to Monitor

**Database metrics (CloudWatch RDS)**:
- CPU Utilization < 70%
- Connection count < max_connections * 0.8
- Read/Write latency < 10ms
- Freeable memory > 20%

**Query metrics (application logs)**:
- 95th percentile query time < 500ms
- Slow query count (>1s) = 0
- N+1 query detection

### Slow Query Logging

```sql
-- Enable slow query logging (RDS parameter group)
log_min_duration_statement = 1000  -- Log queries >1s

-- Query slow query logs
SELECT
    query,
    calls,
    mean_exec_time,
    total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

---

## Lambda-Specific Optimizations

### Cold Start Mitigation

```python
# Initialize engine outside handler (Lambda reuses)
engine = None

def get_engine():
    global engine
    if engine is None:
        engine = get_db_engine(...)
    return engine

def lambda_handler(event, context):
    engine = get_engine()  # Reused across warm invocations
    # ... query database
```

### Reduce Lambda Package Size

- Use Lambda layers for dependencies
- Exclude unnecessary files from deployment
- Use minimal database drivers (psycopg2-binary)

---

## Performance Checklist

**Before deploying queries:**
- [ ] Run EXPLAIN ANALYZE on production-like data
- [ ] Verify indexes exist on WHERE/JOIN columns
- [ ] Check for N+1 queries in ORM code
- [ ] Test with realistic data volumes
- [ ] Add pagination for large result sets
- [ ] Use parameterized queries (security + performance)
- [ ] Monitor query execution time in logs
- [ ] Set up alerts for slow queries

**After deployment:**
- [ ] Monitor database CPU and memory
- [ ] Check slow query logs
- [ ] Review index usage statistics
- [ ] Validate connection pool metrics
- [ ] Test query performance under load

---

## Troubleshooting Slow Queries

1. **Get query execution plan**: `EXPLAIN ANALYZE`
2. **Identify bottleneck**: Sequential scan? Nested loop? Sort?
3. **Add missing indexes**: Foreign keys, WHERE columns
4. **Rewrite query**: Join order, subquery elimination
5. **Reduce data**: Add WHERE filters, SELECT specific columns
6. **Test improvements**: Compare execution times
7. **Deploy and monitor**: Watch metrics in production
