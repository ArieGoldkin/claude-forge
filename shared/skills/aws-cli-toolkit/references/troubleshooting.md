# AWS CLI Troubleshooting Patterns

## Table of Contents

- [Lambda Not Responding](#lambda-not-responding)
- [Secret Access Denied](#secret-access-denied)
- [Database Connection Issues](#database-connection-issues)
- [S3 Access Issues](#s3-access-issues)
- [CloudWatch Log Issues](#cloudwatch-log-issues)
- [SSO Authentication Issues](#sso-authentication-issues)
- [Common Error Messages](#common-error-messages)
- [Diagnostic Command Cheat Sheet](#diagnostic-command-cheat-sheet)

Common debugging workflows for AWS services in the acme platform.

## Lambda Not Responding

```bash
# 1. Check function exists and is active
aws lambda get-function --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "Configuration.[State,LastUpdateStatus]"

# 2. Check recent invocations in CloudWatch
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 10m

# 3. Check for throttling
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/Lambda \
  --metric-name Throttles \
  --dimensions Name=FunctionName,Value=acme-api-service-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 --statistics Sum
```

## Secret Access Denied

```bash
# 1. Verify secret exists
aws secretsmanager describe-secret --profile acme-dev \
  --secret-id acme/dev/database

# 2. Check Lambda role has permission
aws iam simulate-principal-policy --profile acme-dev \
  --policy-source-arn arn:aws:iam::123456789012:role/acme-lambda-execution-role \
  --action-names secretsmanager:GetSecretValue \
  --resource-arns "arn:aws:secretsmanager:us-east-1:123456789012:secret:acme/dev/database*"
```

## Database Connection Issues

```bash
# 1. Check RDS status
aws rds describe-db-instances --profile acme-dev \
  --db-instance-identifier acme-db-dev \
  --query "DBInstances[0].DBInstanceStatus"

# 2. Check connection count
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=acme-db-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 --statistics Maximum

# 3. Check security group allows Lambda
aws ec2 describe-security-groups --profile acme-dev \
  --group-ids sg-xxxxxxxx \
  --query "SecurityGroups[0].IpPermissions"
```

## S3 Access Issues

```bash
# 1. Verify bucket exists and you have access
aws s3 ls s3://acme-data-dev --profile acme-dev

# 2. Check bucket policy
aws s3api get-bucket-policy --profile acme-dev \
  --bucket acme-data-dev

# 3. Simulate permission
aws iam simulate-principal-policy --profile acme-dev \
  --policy-source-arn arn:aws:iam::123456789012:role/acme-lambda-execution-role \
  --action-names s3:GetObject s3:PutObject \
  --resource-arns "arn:aws:s3:::acme-data-dev/*"
```

## CloudWatch Log Issues

```bash
# 1. Verify log group exists
aws logs describe-log-groups --profile acme-dev \
  --log-group-name-prefix /aws/lambda/acme

# 2. Check log retention
aws logs describe-log-groups --profile acme-dev \
  --log-group-name-prefix /aws/lambda/acme-api-service-dev \
  --query "logGroups[0].retentionInDays"

# 3. Check for recent log streams
aws logs describe-log-streams --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --order-by LastEventTime --descending --limit 5
```

## SSO Authentication Issues

```bash
# 1. Check current identity
aws sts get-caller-identity --profile acme-dev

# 2. Re-authenticate
aws sso login --profile acme-dev

# 3. Verify SSO session
aws sso list-accounts --access-token $(cat ~/.aws/sso/cache/*.json | jq -r '.accessToken')
```

## Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `ExpiredTokenException` | SSO session expired | Run `aws sso login --profile acme-dev` |
| `AccessDeniedException` | Missing IAM permission | Check role policies, run simulate-principal-policy |
| `ResourceNotFoundException` | Resource doesn't exist | Verify resource name/ARN |
| `ThrottlingException` | Too many requests | Add retry logic, check quotas |
| `ValidationException` | Invalid parameters | Check parameter format, required fields |

## Diagnostic Command Cheat Sheet

```bash
# Identity and access
aws sts get-caller-identity --profile acme-dev

# Lambda status
aws lambda get-function --profile acme-dev --function-name $FUNC --query "Configuration.State"

# Recent errors in logs
aws logs tail /aws/lambda/$FUNC --profile acme-dev --since 1h --filter-pattern "ERROR"

# Secret existence
aws secretsmanager describe-secret --profile acme-dev --secret-id $SECRET

# RDS status
aws rds describe-db-instances --profile acme-dev --query "DBInstances[?starts_with(DBInstanceIdentifier,'acme')].DBInstanceStatus"
```
