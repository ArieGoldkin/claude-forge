#!/bin/bash
# CloudWatch Log Insights Queries for Acme Platform
# Usage: Copy queries and run via AWS CLI or Console

# ==============================================================================
# LOG TAILING COMMANDS
# ==============================================================================

# Real-time log tail
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 30m --follow

# Tail with error filter
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 1h --filter-pattern "ERROR"

# Tail with request ID filter
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 1h --filter-pattern "REQUEST_ID_HERE"

# ==============================================================================
# LOG INSIGHTS: ERROR ANALYSIS
# ==============================================================================

# Recent errors (last hour)
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-1H +%s) \
  --end-time $(date +%s) \
  --query-string '
    fields @timestamp, @message
    | filter @message like /ERROR/
    | sort @timestamp desc
    | limit 50
  '

# Error count by type
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

# ==============================================================================
# LOG INSIGHTS: PERFORMANCE ANALYSIS
# ==============================================================================

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
            pct(@duration, 95) as p95DurationMs,
            pct(@duration, 99) as p99DurationMs
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
  '

# Memory usage analysis
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-24H +%s) \
  --end-time $(date +%s) \
  --query-string '
    filter @type = "REPORT"
    | stats avg(@maxMemoryUsed) as avgMemoryMB,
            max(@maxMemoryUsed) as maxMemoryMB,
            pct(@maxMemoryUsed, 95) as p95MemoryMB
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

# ==============================================================================
# LOG INSIGHTS: REQUEST TRACING
# ==============================================================================

# Find all logs for a request ID
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-1H +%s) \
  --end-time $(date +%s) \
  --query-string '
    fields @timestamp, @message, @requestId
    | filter @requestId = "REQUEST_ID_HERE"
    | sort @timestamp asc
  '

# Find logs by user ID (Powertools structured logging)
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-1H +%s) \
  --end-time $(date +%s) \
  --query-string '
    fields @timestamp, level, message, user_id
    | filter user_id = "USER_ID_HERE"
    | sort @timestamp desc
  '

# ==============================================================================
# LOG INSIGHTS: INVOCATION PATTERNS
# ==============================================================================

# Invocations per hour
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-24H +%s) \
  --end-time $(date +%s) \
  --query-string '
    filter @type = "REPORT"
    | stats count(*) as invocations by bin(1h)
    | sort bin(1h) asc
  '

# Error rate by hour
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-24H +%s) \
  --end-time $(date +%s) \
  --query-string '
    filter @type = "REPORT"
    | stats count(*) as total,
            sum(@message like /ERROR/) as errors,
            (sum(@message like /ERROR/) / count(*)) * 100 as errorRate
    by bin(1h)
    | sort bin(1h) asc
  '

# ==============================================================================
# LOG INSIGHTS: MULTI-SERVICE QUERIES
# ==============================================================================

# Query across all acme services
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

# ==============================================================================
# QUERY RESULTS
# ==============================================================================

# Get query results (use query-id from start-query output)
aws logs get-query-results --profile acme-dev \
  --query-id "QUERY_ID_HERE"

# Check query status
aws logs describe-queries --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --status Running

# Cancel running query
aws logs stop-query --profile acme-dev \
  --query-id "QUERY_ID_HERE"

# ==============================================================================
# CLOUDWATCH METRICS
# ==============================================================================

# Lambda invocations (last hour)
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=acme-api-service-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Sum

# Lambda duration
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=acme-api-service-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Average Maximum

# RDS CPU utilization
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=acme-db-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Average Maximum \
  --output table

# RDS database connections
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=acme-db-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Average Maximum

# ==============================================================================
# ALARMS
# ==============================================================================

# List acme alarms
aws cloudwatch describe-alarms --profile acme-dev \
  --alarm-name-prefix acme \
  --query "MetricAlarms[*].[AlarmName,StateValue,MetricName]" \
  --output table

# List alarms in ALARM state
aws cloudwatch describe-alarms --profile acme-dev \
  --state-value ALARM \
  --query "MetricAlarms[*].[AlarmName,StateReason]" \
  --output table
