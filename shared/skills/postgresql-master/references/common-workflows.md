# Common Workflows & Troubleshooting

## Table of Contents

- [Common Tasks](#common-tasks)
  - [Export Data](#export-data)
  - [Debug Data Issues](#debug-data-issues)
  - [Monitor Database Health](#monitor-database-health)
- [Troubleshooting](#troubleshooting)
  - [Connection Issues](#connection-issues)
  - [Query Issues](#query-issues)

---

## Common Tasks

### Export Data
```bash
# Export table to CSV
python scripts/query_builder.py --table user --export-csv user.csv

# Export with filters
python scripts/query_builder.py --table events \
  --where "created_at > '2025-01-01'" \
  --export-csv recent_events.csv
```

### Debug Data Issues
```bash
# Find orphaned records
python scripts/query_builder.py --query "
  SELECT * FROM user_activities ua
  LEFT JOIN users u ON ua.user_id = u.id
  WHERE u.id IS NULL
"

# Check for duplicates
python scripts/query_builder.py --query "
  SELECT email, COUNT(*)
  FROM users
  GROUP BY email
  HAVING COUNT(*) > 1
"
```

### Monitor Database Health
```bash
# Check table sizes
python scripts/inspect_schema.py --table-sizes

# Analyze index usage
python scripts/performance_analyzer.py --index-usage

# Find missing indexes
python scripts/performance_analyzer.py --suggest-indexes
```

---

## Troubleshooting

### Connection Issues

**"AccessDeniedException" from Secrets Manager:**
- Ensure `AWS_PROFILE=acme-dev` is set
- Run `aws sso login --profile acme-dev`
- Verify secret ARN matches account (123456789012)

**"Database does not exist":**
- Check `DB_NAME` matches actual database (typically "main", not "arie_dev")
- List available databases: `python scripts/inspect_schema.py --list-databases`

**"Connection timeout":**
- Verify RDS security group allows access from your IP
- Check VPN connection if database is private
- Verify `DB_HOST` endpoint is correct

### Query Issues

**"N+1 query problem" (performance):**
- Use eager loading: `selectinload()` or `joinedload()`
- Read `references/orm-patterns.md` for solutions

**"Deadlock detected":**
- Review transaction isolation levels
- Reduce transaction scope
- Read `references/performance-optimization.md` for patterns

**"SQL injection detected":**
- Always use parameterized queries
- Read `references/sql-patterns.md` for safe patterns
