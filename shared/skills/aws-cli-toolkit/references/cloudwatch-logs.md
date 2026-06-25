# CloudWatch Logs Reference

## Table of Contents

- [Real-Time Log Tailing](#real-time-log-tailing)
- [Log Insights Queries](#log-insights-queries)
- [CloudWatch Metrics](#cloudwatch-metrics)
- [CloudWatch Alarms](#cloudwatch-alarms)
- [Log Group Management](#log-group-management)
- [Troubleshooting](#troubleshooting)


Comprehensive guide for CloudWatch log tailing, Log Insights queries, metrics, and alarms for the acme platform.

## Real-Time Log Tailing

### Basic Log Tail

```bash
# Tail with follow mode (real-time)
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 30m --follow

# Tail without follow (snapshot)
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 1h

# Tail with timestamps
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 1h --format short
```

### Time-Based Filtering

```bash
# Since relative time
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 30m    # 30 minutes
  --since 2h     # 2 hours
  --since 1d     # 1 day

# Since absolute time (ISO 8601)
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 2026-01-31T10:00:00Z
```

### Pattern Filtering

```bash
# Filter for ERROR level
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 1h --filter-pattern "ERROR"

# Filter for specific exception
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 1h --filter-pattern "ConnectionError"

# Filter for request ID
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 1h --filter-pattern "abc-123-def-456"

# Filter for user ID
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 1h --filter-pattern '"user_id": "m_12345"'
```

### Multiple Log Groups

```bash
# Tail multiple services (separate terminals)
aws logs tail --profile acme-dev /aws/lambda/acme-api-service-dev --since 30m --follow &
aws logs tail --profile acme-dev /aws/lambda/acme-staff-service-dev --since 30m --follow &
aws logs tail --profile acme-dev /aws/lambda/acme-activity-service-dev --since 30m --follow &

# Stop all background tails
kill $(jobs -p)
```

## Log Insights Queries

### Query Execution

```bash
# Start query (returns query ID)
QUERY_ID=$(aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-1H +%s) \
  --end-time $(date +%s) \
  --query-string '
    fields @timestamp, @message
    | filter @message like /ERROR/
    | sort @timestamp desc
    | limit 50
  ' --query queryId --output text)

echo "Query ID: $QUERY_ID"

# Wait and get results
sleep 5
aws logs get-query-results --profile acme-dev \
  --query-id $QUERY_ID
```

### Error Analysis Queries

```bash
# Count errors by type
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-24H +%s) \
  --end-time $(date +%s) \
  --query-string '
    fields @timestamp, @message
    | filter @message like /ERROR/
    | parse @message /ERROR.*(?<error_type>\w+Error)/
    | stats count(*) as count by error_type
    | sort count desc
  '

# Errors with stack traces
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-1H +%s) \
  --end-time $(date +%s) \
  --query-string '
    fields @timestamp, @message
    | filter @message like /Traceback/
    | sort @timestamp desc
    | limit 20
  '
```

### Performance Analysis Queries

```bash
# Lambda execution stats
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-24H +%s) \
  --end-time $(date +%s) \
  --query-string '
    filter @type = "REPORT"
    | stats count(*) as invocations,
            avg(@duration) as avgDurationMs,
            max(@duration) as maxDurationMs,
            avg(@maxMemoryUsed) as avgMemoryMB,
            max(@maxMemoryUsed) as maxMemoryMB
  '

# Cold start analysis
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-24H +%s) \
  --end-time $(date +%s) \
  --query-string '
    filter @type = "REPORT"
    | stats count(*) as total,
            sum(@initDuration > 0) as coldStarts,
            avg(@initDuration) as avgColdStartMs,
            max(@initDuration) as maxColdStartMs
    | sort total desc
  '

# P95/P99 latency
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-24H +%s) \
  --end-time $(date +%s) \
  --query-string '
    filter @type = "REPORT"
    | stats avg(@duration) as avg,
            pct(@duration, 50) as p50,
            pct(@duration, 95) as p95,
            pct(@duration, 99) as p99
  '
```

### Request Tracing Queries

```bash
# Find all logs for a request ID
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-1H +%s) \
  --end-time $(date +%s) \
  --query-string '
    fields @timestamp, @message, @requestId
    | filter @requestId = "abc-123-def-456"
    | sort @timestamp asc
  '

# Slow requests (> 5 seconds)
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-24H +%s) \
  --end-time $(date +%s) \
  --query-string '
    filter @type = "REPORT"
    | filter @duration > 5000
    | fields @timestamp, @requestId, @duration
    | sort @duration desc
    | limit 20
  '
```

### Structured Log Queries (JSON)

```bash
# Parse JSON logs (Powertools format)
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-1H +%s) \
  --end-time $(date +%s) \
  --query-string '
    fields @timestamp, level, message, service, user_id
    | filter level = "ERROR"
    | sort @timestamp desc
    | limit 50
  '

# Query by custom field
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-1H +%s) \
  --end-time $(date +%s) \
  --query-string '
    fields @timestamp, message, user_id, action
    | filter user_id = "m_12345"
    | sort @timestamp desc
  '
```

### Multi-Log Group Queries

```bash
# Query across multiple services
aws logs start-query --profile acme-dev \
  --log-group-names \
    /aws/lambda/acme-api-service-dev \
    /aws/lambda/acme-staff-service-dev \
    /aws/lambda/acme-activity-service-dev \
  --start-time $(date -v-1H +%s) \
  --end-time $(date +%s) \
  --query-string '
    fields @timestamp, @message, @logStream
    | filter @message like /ERROR/
    | sort @timestamp desc
    | limit 100
  '
```

## CloudWatch Metrics

### Lambda Metrics

```bash
# Get invocation count
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=acme-api-service-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Sum

# Get error count
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=acme-api-service-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Sum

# Get duration stats
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=acme-api-service-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Average Maximum

# Check for throttling
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/Lambda \
  --metric-name Throttles \
  --dimensions Name=FunctionName,Value=acme-api-service-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Sum
```

### RDS Metrics

```bash
# CPU utilization
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=acme-db-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Average Maximum \
  --output table

# Database connections
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=acme-db-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Average Maximum

# Free storage space
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/RDS \
  --metric-name FreeStorageSpace \
  --dimensions Name=DBInstanceIdentifier,Value=acme-db-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 3600 \
  --statistics Minimum
```

## CloudWatch Alarms

### List Alarms

```bash
# List all acme alarms
aws cloudwatch describe-alarms --profile acme-dev \
  --alarm-name-prefix acme \
  --query "MetricAlarms[*].[AlarmName,StateValue,MetricName]" \
  --output table

# List alarms in ALARM state
aws cloudwatch describe-alarms --profile acme-dev \
  --state-value ALARM \
  --query "MetricAlarms[*].[AlarmName,StateReason]" \
  --output table
```

### Get Alarm History

```bash
aws cloudwatch describe-alarm-history --profile acme-dev \
  --alarm-name acme-api-service-errors \
  --history-item-type StateUpdate \
  --query "AlarmHistoryItems[*].[Timestamp,HistorySummary]" \
  --output table
```

### Create Alarm

```bash
# Error rate alarm
aws cloudwatch put-metric-alarm --profile acme-dev \
  --alarm-name acme-api-service-errors \
  --alarm-description "User service error rate > 5%" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --dimensions Name=FunctionName,Value=acme-api-service-dev \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching

# Duration alarm
aws cloudwatch put-metric-alarm --profile acme-dev \
  --alarm-name acme-api-service-duration \
  --alarm-description "User service p99 duration > 10s" \
  --metric-name Duration \
  --namespace AWS/Lambda \
  --dimensions Name=FunctionName,Value=acme-api-service-dev \
  --extended-statistic p99 \
  --period 300 \
  --evaluation-periods 3 \
  --threshold 10000 \
  --comparison-operator GreaterThanThreshold
```

## Log Group Management

### List Log Groups

```bash
# List acme log groups
aws logs describe-log-groups --profile acme-dev \
  --log-group-name-prefix /aws/lambda/acme \
  --query "logGroups[*].[logGroupName,storedBytes,retentionInDays]" \
  --output table
```

### Set Retention Policy

```bash
# Set 30-day retention
aws logs put-retention-policy --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --retention-in-days 30
```

### Delete Log Group

```bash
# Delete old log group (use with caution)
aws logs delete-log-group --profile acme-dev \
  --log-group-name /aws/lambda/acme-old-service-dev
```

## Troubleshooting

### No Logs Appearing

```bash
# 1. Verify log group exists
aws logs describe-log-groups --profile acme-dev \
  --log-group-name-pattern acme-api-service

# 2. Check for recent log streams
aws logs describe-log-streams --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --order-by LastEventTime \
  --descending \
  --limit 5

# 3. Verify Lambda has CloudWatch permissions
aws iam simulate-principal-policy --profile acme-dev \
  --policy-source-arn arn:aws:iam::123456789012:role/acme-lambda-execution-role \
  --action-names logs:CreateLogStream logs:PutLogEvents \
  --resource-arns "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/acme-*"
```

### Query Timeout

```bash
# Check query status
aws logs describe-queries --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --status Running

# Cancel running query
aws logs stop-query --profile acme-dev \
  --query-id abc-123-def-456
```
