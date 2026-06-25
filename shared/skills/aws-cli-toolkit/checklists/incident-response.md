# Incident Response Checklist

## Table of Contents

- [Initial Assessment (First 5 Minutes)](#initial-assessment-first-5-minutes)
  - [1. Identify Scope](#1-identify-scope)
  - [2. Quick Status Check](#2-quick-status-check)
- [Log Investigation](#log-investigation)
  - [1. Tail Recent Errors](#1-tail-recent-errors)
  - [2. Search for Specific Errors](#2-search-for-specific-errors)
  - [3. Trace Specific Request](#3-trace-specific-request)
- [Common Issue Debugging](#common-issue-debugging)
  - [Lambda Timeout](#lambda-timeout)
  - [Lambda Throttling](#lambda-throttling)
  - [Database Connection Issues](#database-connection-issues)
  - [Credential Access Issues](#credential-access-issues)
  - [Memory Exhaustion](#memory-exhaustion)
- [Mitigation Actions](#mitigation-actions)
  - [Quick Fixes](#quick-fixes)
  - [Rollback](#rollback)
- [CloudWatch Alarms Status](#cloudwatch-alarms-status)
- [Escalation Criteria](#escalation-criteria)
- [Post-Incident](#post-incident)
  - [1. Document Timeline](#1-document-timeline)
  - [2. Collect Evidence](#2-collect-evidence)
  - [3. Follow-Up Actions](#3-follow-up-actions)
- [Quick Reference: Common Error Patterns](#quick-reference-common-error-patterns)

Production incident debugging workflow for the acme platform AWS infrastructure.

## Initial Assessment (First 5 Minutes)

### 1. Identify Scope

- [ ] **What service is affected?** (Lambda function, RDS, etc.)
- [ ] **When did it start?** (Check CloudWatch for first error)
- [ ] **Who reported it?** (User, monitoring, automated alert)
- [ ] **What is the user impact?** (Complete outage, degraded, intermittent)

### 2. Quick Status Check

```bash
# Login to AWS
aws sso login --profile acme-dev

# Check Lambda status
aws lambda get-function --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "Configuration.[State,LastUpdateStatus,LastModified]"

# Check RDS status
aws rds describe-db-instances --profile acme-dev \
  --db-instance-identifier acme-db-dev \
  --query "DBInstances[0].DBInstanceStatus"

# Check for recent deployments
aws lambda list-versions-by-function --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "Versions[-3:].[Version,LastModified]" \
  --output table
```

## Log Investigation

### 1. Tail Recent Errors

```bash
# Real-time error log tail
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 30m --filter-pattern "ERROR" --follow
```

### 2. Search for Specific Errors

```bash
# Find error messages
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-1H +%s) \
  --end-time $(date +%s) \
  --query-string '
    fields @timestamp, @message
    | filter @message like /ERROR|Exception|Traceback/
    | sort @timestamp desc
    | limit 50
  '

# Get query results
aws logs get-query-results --profile acme-dev \
  --query-id "QUERY_ID_HERE"
```

### 3. Trace Specific Request

```bash
# Find logs for a specific request ID
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-1H +%s) \
  --end-time $(date +%s) \
  --query-string '
    fields @timestamp, @message, @requestId
    | filter @requestId = "REQUEST_ID_HERE"
    | sort @timestamp asc
  '
```

## Common Issue Debugging

### Lambda Timeout

```bash
# Check for slow executions
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-1H +%s) \
  --end-time $(date +%s) \
  --query-string '
    filter @type = "REPORT"
    | filter @duration > 10000
    | fields @timestamp, @requestId, @duration
    | sort @duration desc
    | limit 20
  '

# Check function timeout setting
aws lambda get-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "[Timeout,MemorySize]"
```

### Lambda Throttling

```bash
# Check throttling metrics
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/Lambda \
  --metric-name Throttles \
  --dimensions Name=FunctionName,Value=acme-api-service-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 --statistics Sum

# Check concurrent executions
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/Lambda \
  --metric-name ConcurrentExecutions \
  --dimensions Name=FunctionName,Value=acme-api-service-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 --statistics Maximum
```

### Database Connection Issues

```bash
# Check RDS status
aws rds describe-db-instances --profile acme-dev \
  --db-instance-identifier acme-db-dev \
  --query "DBInstances[0].{Status:DBInstanceStatus,Endpoint:Endpoint.Address}"

# Check connection count
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=acme-db-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 --statistics Maximum

# Check CPU utilization
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=acme-db-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 --statistics Maximum
```

### Credential Access Issues

```bash
# Verify credential exists
aws secretsmanager describe-secret --profile acme-dev \
  --secret-id acme/dev/database

# Check Lambda role permissions
aws iam simulate-principal-policy --profile acme-dev \
  --policy-source-arn arn:aws:iam::123456789012:role/acme-lambda-execution-role \
  --action-names secretsmanager:GetSecretValue \
  --resource-arns "arn:aws:secretsmanager:us-east-1:123456789012:secret:acme/dev/database*"
```

### Memory Exhaustion

```bash
# Check memory usage
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-1H +%s) \
  --end-time $(date +%s) \
  --query-string '
    filter @type = "REPORT"
    | stats max(@maxMemoryUsed) as maxMem, avg(@maxMemoryUsed) as avgMem
  '

# Compare with allocated memory
aws lambda get-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "MemorySize"
```

## Mitigation Actions

### Quick Fixes

```bash
# Increase function timeout
aws lambda update-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --timeout 60

# Increase memory (also increases CPU)
aws lambda update-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --memory-size 1024

# Increase reserved concurrency
aws lambda put-function-concurrency --profile acme-dev \
  --function-name acme-api-service-dev \
  --reserved-concurrent-executions 200
```

### Rollback

```bash
# If recent deployment caused issues, rollback alias
aws lambda update-alias --profile acme-dev \
  --function-name acme-api-service-dev \
  --name live \
  --function-version PREVIOUS_VERSION

# Or redeploy previous code
aws lambda update-function-code --profile acme-dev \
  --function-name acme-api-service-dev \
  --s3-bucket acme-deployments-dev \
  --s3-key functions/api-service/function-previous.zip
```

## CloudWatch Alarms Status

```bash
# Check all acme alarms
aws cloudwatch describe-alarms --profile acme-dev \
  --alarm-name-prefix acme \
  --query "MetricAlarms[*].[AlarmName,StateValue,StateReason]" \
  --output table

# List alarms in ALARM state
aws cloudwatch describe-alarms --profile acme-dev \
  --state-value ALARM \
  --query "MetricAlarms[*].[AlarmName,StateReason]" \
  --output table
```

## Escalation Criteria

**Escalate to senior engineer if:**
- [ ] Issue persists > 15 minutes
- [ ] Root cause is unclear
- [ ] Database is affected
- [ ] Multiple services are impacted
- [ ] Production data may be compromised

**Escalate to on-call manager if:**
- [ ] Complete service outage
- [ ] Data integrity issue
- [ ] Security incident suspected
- [ ] Customer-facing impact > 30 minutes

## Post-Incident

### 1. Document Timeline

- [ ] When was incident detected?
- [ ] When was investigation started?
- [ ] What was the root cause?
- [ ] When was mitigation applied?
- [ ] When was service restored?

### 2. Collect Evidence

```bash
# Export relevant logs
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time INCIDENT_START_TIME \
  --end-time INCIDENT_END_TIME \
  --query-string '
    fields @timestamp, @message
    | sort @timestamp asc
  '
```

### 3. Follow-Up Actions

- [ ] Create incident report
- [ ] Identify preventive measures
- [ ] Update monitoring/alerting
- [ ] Schedule post-mortem (for major incidents)

## Quick Reference: Common Error Patterns

| Error | Likely Cause | First Check |
|-------|--------------|-------------|
| `Task timed out` | Slow DB query or external call | CloudWatch duration metrics |
| `AccessDeniedException` | IAM permissions | Simulate principal policy |
| `Connection refused` | DB down or network issue | RDS status |
| `OperationalError: connection` | Too many DB connections | RDS connection count |
| `ResourceNotFoundException` | Wrong credential path | Describe secret |
| `ThrottlingException` | Rate limit exceeded | Throttles metric |
| `MemoryError` | OOM | Max memory used metric |
