---
name: aws-cli-toolkit
description: AWS CLI for Lambda deploy/invoke/logs, CloudWatch Log Insights, Secrets Manager, S3 operations, RDS monitoring, and IAM policies. Includes SSO auth, profile management, and platform patterns.
effort: low
paths:
  - "**/*aws*"
  - "**/*lambda*"
  - "**/*cloudwatch*"
  - "**/*s3*"
---

# AWS CLI Toolkit

## Overview

This skill provides comprehensive AWS CLI expertise for the platform, covering Lambda deployment, CloudWatch log analysis, Secrets Manager operations, S3 management, RDS monitoring, and IAM security. All commands use platform naming conventions and AWS SSO authentication.

**Bundled Resources:**
- `${CLAUDE_SKILL_DIR}/references/lambda-operations.md` - Function deployment, layers, invocation, configuration
- `${CLAUDE_SKILL_DIR}/references/cloudwatch-logs.md` - Log tailing, Log Insights queries, metrics, alarms
- `${CLAUDE_SKILL_DIR}/references/aws-sm-operations.md` - Secret retrieval, rotation, ESO integration
- `${CLAUDE_SKILL_DIR}/references/rds-operations.md` - RDS instance management, snapshots, monitoring
- `${CLAUDE_SKILL_DIR}/references/iam-security.md` - Role inspection, policy management, least privilege
- `${CLAUDE_SKILL_DIR}/references/troubleshooting.md` - Common debugging workflows and error reference
- `${CLAUDE_SKILL_DIR}/templates/lambda-commands.sh` - Common Lambda CLI commands
- `${CLAUDE_SKILL_DIR}/templates/cloudwatch-queries.sh` - Log Insights query templates
- `${CLAUDE_SKILL_DIR}/templates/secrets-rotation.sh` - Secret management commands
- `${CLAUDE_SKILL_DIR}/templates/iam-policies.json` - IAM policy templates
- `checklists/lambda-deployment.md` - Pre/post deployment validation
- `checklists/incident-response.md` - Production debugging workflow

---

## Quick Start

### 1. AWS SSO Authentication

**Login with SSO (required before any AWS operations):**
```bash
# Login to acme development account
aws sso login --profile acme-dev

# Login to acme production account
aws sso login --profile acme-prod

# Verify identity
aws sts get-caller-identity --profile acme-dev
```

**Profile configuration** (in `~/.aws/config`):
```ini
[profile acme-dev]
sso_start_url = https://my-org.awsapps.com/start
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = DeveloperAccess
region = us-east-1
output = json

[profile acme-prod]
sso_start_url = https://my-org.awsapps.com/start
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = ReadOnlyAccess
region = us-east-1
output = json
```

### 2. Lambda Quick Operations

**Deploy and invoke a function:**
```bash
# List acme Lambda functions
aws lambda list-functions --profile acme-dev \
  --query "Functions[?starts_with(FunctionName, 'acme-')].[FunctionName,Runtime,LastModified]" \
  --output table

# Invoke function synchronously
aws lambda invoke --profile acme-dev \
  --function-name acme-api-service-dev \
  --payload '{"action": "health_check"}' \
  --cli-binary-format raw-in-base64-out \
  response.json && cat response.json

# View recent logs
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 30m --follow
```

### 3. CloudWatch Log Tailing

**Real-time log monitoring:**
```bash
# Tail Lambda logs with follow mode
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 1h --follow

# Filter for errors only
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 1h --filter-pattern "ERROR"

# Tail multiple log groups (use separate terminals)
aws logs tail --profile acme-dev /aws/lambda/acme-staff-service-dev --since 30m &
aws logs tail --profile acme-dev /aws/lambda/acme-api-service-dev --since 30m &
```

### 4. Secrets Manager

**Retrieve secrets:**
```bash
# Get secret value
aws secretsmanager get-secret-value --profile acme-dev \
  --secret-id acme/dev/database \
  --query SecretString --output text | jq .

# List acme secrets
aws secretsmanager list-secrets --profile acme-dev \
  --query "SecretList[?starts_with(Name, 'acme/')].[Name,LastChangedDate]" \
  --output table
```

### 5. S3 Operations

**Common S3 commands:**
```bash
# List buckets
aws s3 ls --profile acme-dev | grep acme

# Sync deployment artifacts
aws s3 sync ./dist s3://acme-deployments-dev/functions/api-service/ \
  --profile acme-dev

# Generate presigned URL (1 hour expiry)
aws s3 presign s3://acme-data-dev/exports/report.csv \
  --profile acme-dev --expires-in 3600
```

---

## Lambda Operations

For full deployment, versioning, layers, concurrency, and configuration guide, see [references/lambda-operations.md](${CLAUDE_SKILL_DIR}/references/lambda-operations.md).

---

## CloudWatch Operations

For log tailing, Log Insights queries, metrics, alarms, and log group management, see [references/cloudwatch-logs.md](${CLAUDE_SKILL_DIR}/references/cloudwatch-logs.md).

---

## Secrets Manager

For secret retrieval, updates, rotation, ESO integration, and credential inventory, see [references/aws-sm-operations.md](${CLAUDE_SKILL_DIR}/references/aws-sm-operations.md).

---

## RDS PostgreSQL

For instance management, snapshots, performance monitoring, and troubleshooting, see [references/rds-operations.md](${CLAUDE_SKILL_DIR}/references/rds-operations.md).

---

## IAM Security

For role inspection, policy management, permission analysis, least privilege templates, and assume role patterns, see [references/iam-security.md](${CLAUDE_SKILL_DIR}/references/iam-security.md).

---

## Troubleshooting

For common debugging workflows (Lambda, Secrets Manager, RDS, S3, CloudWatch, SSO), error message reference, and diagnostic cheat sheet, see [references/troubleshooting.md](${CLAUDE_SKILL_DIR}/references/troubleshooting.md).

See also `checklists/incident-response.md` for production incident debugging workflows.

---

## Acme Platform Conventions

### Naming Patterns

| Resource | Pattern | Example |
|----------|---------|---------|
| Lambda | `acme-<service>-<env>` | `acme-api-service-dev` |
| Log Group | `/aws/lambda/acme-<service>-<env>` | `/aws/lambda/acme-api-service-dev` |
| Secret | `acme/<env>/<service>` | `acme/dev/database` |
| S3 Bucket | `acme-<purpose>-<env>` | `acme-deployments-dev` |
| RDS | `acme-db-<env>` | `acme-db-dev` |
| IAM Role | `acme-<service>-execution-role` | `acme-lambda-execution-role` |

### Environment Profiles

| Profile | Account | Purpose |
|---------|---------|---------|
| `acme-dev` | 123456789012 | Development and testing |
| `acme-staging` | (TBD) | Pre-production validation |
| `acme-prod` | (TBD) | Production workloads |

---

## Reference Documentation

**Detailed guides:**
- `${CLAUDE_SKILL_DIR}/references/lambda-operations.md` - Complete Lambda deployment and management
- `${CLAUDE_SKILL_DIR}/references/cloudwatch-logs.md` - Log Insights queries and metrics
- `${CLAUDE_SKILL_DIR}/references/aws-sm-operations.md` - Secret retrieval, rotation, ESO integration
- `${CLAUDE_SKILL_DIR}/references/rds-operations.md` - RDS instance management, snapshots, monitoring
- `${CLAUDE_SKILL_DIR}/references/iam-security.md` - IAM roles, policies, and least privilege
- `${CLAUDE_SKILL_DIR}/references/troubleshooting.md` - Common debugging workflows and error reference

**Templates:**
- `${CLAUDE_SKILL_DIR}/templates/lambda-commands.sh` - Ready-to-use Lambda commands
- `${CLAUDE_SKILL_DIR}/templates/cloudwatch-queries.sh` - Log Insights query library
- `${CLAUDE_SKILL_DIR}/templates/credential-commands.sh` - Credential management scripts
- `${CLAUDE_SKILL_DIR}/templates/iam-policies.json` - IAM policy templates

**Checklists:**
- `checklists/lambda-deployment.md` - Deployment validation checklist
- `checklists/incident-response.md` - Production incident debugging

---

**Skill Version**: 1.0.0
**Last Updated**: 2026-01-31
