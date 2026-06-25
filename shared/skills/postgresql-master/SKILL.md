---
name: postgresql-master
description: PostgreSQL database operations, schema inspection, Alembic migrations, query optimization, SQLAlchemy 2.0 ORM patterns, and AWS RDS management. For querying, migrations, EXPLAIN analysis, N+1 prevention, and production database work.
effort: low
paths:
  - "**/migrations/**"
  - "**/models/**"
  - "alembic/**"
  - "alembic.ini"
  - "**/*sqlalchemy*"
---

# PostgreSQL Master

## Overview

This skill provides comprehensive PostgreSQL database expertise for the platform, covering database inspection, querying, migration management, performance optimization, and production debugging. Integrates with the project's SQLAlchemy ORM, Alembic migrations, and AWS RDS infrastructure.

**Bundled Resources:**
- `scripts/inspect_schema.py` - Inspect table schemas, columns, relationships, indexes
- `scripts/query_builder.py` - Build and execute safe, parameterized queries
- `scripts/migration_helper.py` - Generate and validate Alembic migrations
- `scripts/performance_analyzer.py` - Analyze query performance and suggest optimizations
- `${CLAUDE_SKILL_DIR}/references/sql-patterns.md` - Production-grade SQL patterns and anti-patterns
- `${CLAUDE_SKILL_DIR}/references/performance-optimization.md` - Query optimization, indexing, and caching strategies
- `${CLAUDE_SKILL_DIR}/references/orm-patterns.md` - SQLAlchemy ORM best practices and common pitfalls
- `${CLAUDE_SKILL_DIR}/templates/migration-template.py` - Standard Alembic migration template
- `${CLAUDE_SKILL_DIR}/templates/query-templates.sql` - Common queries for reuse
- `checklists/migration-checklist.md` - Pre-deployment migration validation checklist

---

## Quick Start

### 1. Database Connection

```python
from utils.database.db_utils import get_db_engine, get_session

engine = get_db_engine(db_secret="arn:aws:secretsmanager:...", db_name="main",
                       db_host="acme-db.rds.amazonaws.com", db_port="5432")
SessionLocal = get_session(db_secret, db_name, db_host, db_port)
session = SessionLocal()
```

**Environment variables (`.env.db`):** `DB_HOST` (RDS endpoint), `DB_NAME` ("main"), `DB_PORT` (5432), `DB_SECRET_NAME` (Secrets Manager ARN), `AWS_PROFILE` ("acme-dev")

**Connection test:** `source .env.db && python scripts/inspect_schema.py`

### 2. Inspect Database Schema

```bash
python scripts/inspect_schema.py --list-tables
python scripts/inspect_schema.py --table user --details
python scripts/inspect_schema.py --table user --relationships
python scripts/inspect_schema.py --export-schema
```

### 3. Query Data Safely

```bash
python scripts/query_builder.py --table user --where "created_at > '2025-01-01'" --limit 10
python scripts/query_builder.py --query "SELECT u.*, s.* FROM users u JOIN subscription s ON u.id = s.user_id"
python scripts/query_builder.py --table events --where "event_type = 'login'" --export-csv
```

### 4. Create Migrations

```bash
python scripts/migration_helper.py --auto-generate "Add last_login_at to user"
python scripts/migration_helper.py --create "Add index on user_activities"
python scripts/migration_helper.py --validate
python scripts/migration_helper.py --dry-run
```

### 5. Analyze Performance

```bash
python scripts/performance_analyzer.py --query "SELECT * FROM users WHERE email LIKE '%@example.com'"
python scripts/performance_analyzer.py --suggest-indexes --table user
python scripts/performance_analyzer.py --analyze-file queries.sql
```

---

## Core Database Workflows

### Schema Exploration

**Before making changes, understand the schema:**
1. **List tables**: `scripts/inspect_schema.py --list-tables`
2. **Examine structure**: `scripts/inspect_schema.py --table <name> --details`
3. **Check relationships**: Review foreign keys and indexes
4. **Read project docs**: check the project's own schema reference (ER diagrams, domain glossary) for business context

### Safe Query Execution

**Always use parameterized queries to prevent SQL injection:**
```python
# ✅ GOOD: Parameterized query
from sqlalchemy import text
result = session.execute(
    text("SELECT * FROM users WHERE email = :email"),
    {"email": user_email}
)

# ❌ BAD: String interpolation (SQL injection risk!)
query = f"SELECT * FROM users WHERE email = '{user_email}'"
```

**Read `${CLAUDE_SKILL_DIR}/references/sql-patterns.md` for production-grade patterns.**

### Migration Management

**Standard migration workflow:**
1. **Modify ORM models** in `utils/database/models/`
2. **Generate migration**: `python scripts/migration_helper.py --auto-generate "Description"`
3. **Review SQL**: Check generated migration in `alembic/versions/`
4. **Validate**: `python scripts/migration_helper.py --validate`
5. **Test locally**: `alembic upgrade head` in dev environment
6. **Apply to production**: After testing and code review

**Read `checklists/migration-checklist.md` before deploying.**

### Performance Optimization

**Optimization workflow:**
1. **Identify slow queries**: Use CloudWatch RDS metrics or application logs
2. **Analyze with EXPLAIN**: `scripts/performance_analyzer.py --query "<sql>"`
3. **Review indexes**: Check if appropriate indexes exist
4. **Test improvements**: Compare execution plans before/after
5. **Monitor impact**: Track query performance post-deployment

**Read `${CLAUDE_SKILL_DIR}/references/performance-optimization.md` for detailed strategies.**

---

## Schema Discovery Workflow

For any project, understand the schema before making changes:

1. Use `scripts/inspect_schema.py --list-tables` to enumerate tables
2. Inspect structure per table with `--table <name> --details`
3. Map relationships via foreign keys and junction tables
4. Document findings in the project's own schema reference (not here — keep domain-specific docs with the project)
5. For immutable audit tables, verify DB triggers prevent UPDATE/DELETE and use JSONB for flexible payload shapes

---

## SQLAlchemy ORM Patterns

**Project uses SQLAlchemy 2.0+ with declarative models:**

```python
from utils.database.models.acme_models import User, Subscription
from sqlalchemy import select

# Modern SQLAlchemy 2.0 query style
stmt = select(User).where(User.email == "user@example.com")
user = session.scalars(stmt).first()

# Relationships
user.subscriptions  # Access related subscriptions
user.events  # Access user events
```

**Read `${CLAUDE_SKILL_DIR}/references/orm-patterns.md` for:*
- Eager loading and N+1 query prevention
- Bulk operations and performance
- Transaction management
- Common ORM pitfalls and solutions

---

## Production Best Practices

### Connection Management
- **Reuse connections**: Lambda uses cached engine from `_engine_cache`
- **Small pool size**: 2 connections for Lambda (single-threaded)
- **Health checks**: `pool_pre_ping=True` detects stale connections
- **Connection recycling**: 1-hour recycling prevents timeouts

### Security
- **Never log passwords**: Redact credentials in logs
- **Use AWS Secrets Manager**: Don't hardcode database credentials
- **Parameterized queries only**: Prevent SQL injection
- **Least privilege**: Use read-only connections where possible

### Performance
- **Index strategically**: Balance query speed vs write overhead
- **Batch operations**: Use bulk inserts/updates for large datasets
- **Connection pooling**: Reuse connections across Lambda invocations
- **Query optimization**: Use EXPLAIN ANALYZE for slow queries

**Read `${CLAUDE_SKILL_DIR}/references/performance-optimization.md` for detailed optimization strategies.**

---

## Common Tasks

For data export, debugging, and monitoring workflows, see [references/common-workflows.md](${CLAUDE_SKILL_DIR}/references/common-workflows.md).

---

## Reference Documentation

**Detailed guides (read as needed):**

- **`${CLAUDE_SKILL_DIR}/references/sql-patterns.md`** - Production SQL patterns, anti-patterns, and best practices
- **`${CLAUDE_SKILL_DIR}/references/performance-optimization.md`** - Query optimization, indexing strategies, caching patterns
- **`${CLAUDE_SKILL_DIR}/references/orm-patterns.md`** - SQLAlchemy 2.0 patterns, eager loading, transaction management

**Templates:**

- **`${CLAUDE_SKILL_DIR}/templates/migration-template.py`** - Standard Alembic migration structure
- **`${CLAUDE_SKILL_DIR}/templates/query-templates.sql`** - Common query templates for reuse

**Checklists:**

- **`checklists/migration-checklist.md`** - Pre-deployment validation for database migrations

---

## Troubleshooting

For troubleshooting connection issues, migration errors, and performance, see [references/common-workflows.md](${CLAUDE_SKILL_DIR}/references/common-workflows.md#troubleshooting).

---

## Integration with Acme Platform

This skill integrates seamlessly with the platform infrastructure:

- **Uses project's database utilities**: `utils/database/db_utils.py`
- **Follows Alembic migration patterns**: Compatible with `alembic/` directory structure
- **Respects ORM models**: Works with models in `utils/database/models/`
- **AWS Lambda optimized**: Scripts work in both local and Lambda contexts
- **Security compliant**: Follows HIPAA-aligned patterns from `hipaa-compliance-checker` skill

**For health data operations, also consult the `hipaa-compliance-checker` skill to ensure compliance.**
