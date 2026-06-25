# Database Migration Checklist

## Table of Contents

- [Pre-Development](#pre-development)
- [Development](#development)
  - [1. Model Changes](#1-model-changes)
  - [2. Migration Generation](#2-migration-generation)
  - [3. Migration Review](#3-migration-review)
  - [4. Safety Checks](#4-safety-checks)
- [Testing](#testing)
  - [1. Local Testing](#1-local-testing)
  - [2. Data Validation](#2-data-validation)
  - [3. Performance Testing](#3-performance-testing)
- [Deployment Planning](#deployment-planning)
  - [1. Rollout Strategy](#1-rollout-strategy)
  - [2. Rollback Plan](#2-rollback-plan)
  - [3. Communication](#3-communication)
- [Deployment](#deployment)
  - [1. Pre-Deployment](#1-pre-deployment)
  - [2. Execute Migration](#2-execute-migration)
  - [3. Post-Deployment Validation](#3-post-deployment-validation)
- [Post-Deployment](#post-deployment)
  - [1. Monitoring](#1-monitoring)
  - [2. Documentation](#2-documentation)
  - [3. Cleanup](#3-cleanup)
- [Red Flags (Abort Deployment)](#red-flags-abort-deployment)
- [Emergency Rollback](#emergency-rollback)
- [Zero-Downtime Patterns](#zero-downtime-patterns)
  - [1. Adding Columns](#1-adding-columns)
  - [2. Removing Columns](#2-removing-columns)
  - [3. Renaming Columns](#3-renaming-columns)
- [Additional Resources](#additional-resources)

Pre-deployment validation checklist for Alembic migrations.

## Pre-Development

- [ ] **Review requirements** - Understand what schema changes are needed
- [ ] **Check existing schema** - Use `inspect_schema.py` to understand current state
- [ ] **Plan backwards compatibility** - Will this break existing code?
- [ ] **Estimate downtime** - Is this a zero-downtime migration?

## Development

### 1. Model Changes

- [ ] **Update ORM models** in `utils/database/models/acme_models/`
- [ ] **Add/update relationships** if needed
- [ ] **Add validation** (nullable, defaults, constraints)
- [ ] **Update docstrings** to document changes

### 2. Migration Generation

- [ ] **Generate migration**: `python scripts/migration_helper.py --auto-generate "Description"`
- [ ] **Review generated SQL** in `alembic/versions/`
- [ ] **Verify migration filename** includes descriptive slug
- [ ] **Check revision ordering** (down_revision points to correct parent)

### 3. Migration Review

- [ ] **Upgrade logic is correct** - Schema changes match intent
- [ ] **Downgrade logic is complete** - Can reverse all changes
- [ ] **Default values are set** for NOT NULL columns on existing tables
- [ ] **Indexes are added** for foreign keys and frequently queried columns
- [ ] **Data migrations are safe** - Won't corrupt existing data
- [ ] **No hardcoded values** - Use parameters for data migrations

### 4. Safety Checks

- [ ] **Validate migration**: `python scripts/migration_helper.py --validate`
- [ ] **Preview SQL**: `python scripts/migration_helper.py --dry-run`
- [ ] **Check for breaking changes**:
  - Dropping columns that are still in use
  - Changing column types that might fail
  - Adding NOT NULL without default on existing tables
  - Renaming columns/tables without code updates
- [ ] **Verify index names** follow convention: `idx_<table>_<column>`

## Testing

### 1. Local Testing

- [ ] **Apply migration**: `alembic upgrade head`
- [ ] **Verify schema**: Use `inspect_schema.py --table <name> --details`
- [ ] **Test ORM queries** - Ensure relationships work
- [ ] **Test downgrade**: `alembic downgrade -1`
- [ ] **Re-apply upgrade**: `alembic upgrade head`
- [ ] **Run application tests** - Ensure no regressions

### 2. Data Validation

- [ ] **Check row counts** before and after
- [ ] **Verify foreign key integrity**
- [ ] **Test with realistic data volumes**
- [ ] **Validate default values** are applied correctly
- [ ] **Check for data truncation** (e.g., VARCHAR length changes)

### 3. Performance Testing

- [ ] **Run EXPLAIN on queries** using new schema
- [ ] **Verify indexes are used** for common queries
- [ ] **Test query performance** on production-sized dataset
- [ ] **Measure migration execution time**

## Deployment Planning

### 1. Rollout Strategy

- [ ] **Determine deployment window** - Off-peak hours?
- [ ] **Estimate migration time** - Based on table size and operations
- [ ] **Plan for downtime** - Zero-downtime or maintenance window?
- [ ] **Coordinate with stakeholders** - Notify team of deployment

### 2. Rollback Plan

- [ ] **Document rollback procedure**
  ```bash
  # If migration fails or causes issues
  alembic downgrade -1
  ```
- [ ] **Test rollback locally** before deployment
- [ ] **Verify code rollback** - Can application run on old schema?
- [ ] **Backup database** before deployment (if critical migration)

### 3. Communication

- [ ] **Create deployment ticket** with:
  - Migration description
  - Estimated time and downtime
  - Rollback procedure
  - Testing evidence
- [ ] **Code review** - Get approval from senior engineer
- [ ] **Notify team** of deployment schedule

## Deployment

### 1. Pre-Deployment

- [ ] **Backup database** (if critical migration)
  ```bash
  # AWS RDS automatic snapshots enabled
  # Manual snapshot if needed
  ```
- [ ] **Verify AWS credentials** - `aws sso login --profile acme-dev`
- [ ] **Set environment variables** - `source .env.db`
- [ ] **Check database connectivity** - `python scripts/migration_helper.py --current`

### 2. Execute Migration

- [ ] **Run migration**: `alembic upgrade head`
- [ ] **Monitor execution** - Watch for errors or warnings
- [ ] **Verify completion** - Check migration completed successfully
  ```bash
  python scripts/migration_helper.py --current
  ```

### 3. Post-Deployment Validation

- [ ] **Check application logs** - No database errors
- [ ] **Verify schema changes** - Use `inspect_schema.py`
- [ ] **Test critical flows** - User creation, login, activity tracking
- [ ] **Monitor database metrics** - CPU, connections, query performance
- [ ] **Check for slow queries** - CloudWatch RDS metrics

## Post-Deployment

### 1. Monitoring

- [ ] **Monitor for 24 hours** - Watch for issues
- [ ] **Check error rates** - Application and database logs
- [ ] **Review query performance** - Use `performance_analyzer.py`
- [ ] **Verify data integrity** - Run validation queries

### 2. Documentation

- [ ] **Update schema documentation** if needed
- [ ] **Document any manual steps** taken
- [ ] **Note any issues** encountered and resolutions
- [ ] **Update team** on deployment status

### 3. Cleanup

- [ ] **Remove old indexes** if replaced by new ones
- [ ] **Archive old data** if migration included cleanup
- [ ] **Update monitoring alerts** if thresholds changed

## Red Flags (Abort Deployment)

🚨 **Stop and investigate if:**

- Migration takes > 2x estimated time
- Database CPU > 90% during migration
- Errors in migration logs
- Data integrity violations detected
- Application errors spike after deployment
- Rollback fails during testing

## Emergency Rollback

**If issues detected post-deployment:**

1. **Assess severity** - Is this a critical issue?
2. **Attempt rollback**:
   ```bash
   source .env.db
   alembic downgrade -1
   ```
3. **Verify rollback** - Check schema and application functionality
4. **Deploy code rollback** - Revert application to previous version
5. **Investigate root cause** - Debug locally before re-attempting
6. **Notify team** of rollback and investigation status

## Zero-Downtime Patterns

For migrations that require zero downtime:

### 1. Adding Columns

- [ ] **Step 1**: Add column as nullable
- [ ] **Step 2**: Deploy code that writes to new column
- [ ] **Step 3**: Backfill existing rows (if needed)
- [ ] **Step 4**: Add NOT NULL constraint (if needed)

### 2. Removing Columns

- [ ] **Step 1**: Deploy code that stops using column
- [ ] **Step 2**: Verify column is unused (check logs)
- [ ] **Step 3**: Drop column in separate migration

### 3. Renaming Columns

- [ ] **Step 1**: Add new column
- [ ] **Step 2**: Deploy code that writes to both columns
- [ ] **Step 3**: Backfill new column from old column
- [ ] **Step 4**: Deploy code that reads from new column only
- [ ] **Step 5**: Drop old column

## Additional Resources

- Alembic documentation: https://alembic.sqlalchemy.org/
- Migration best practices: `references/sql-patterns.md`
- Schema documentation: check your project's own schema reference
- Performance considerations: `references/performance-optimization.md`
