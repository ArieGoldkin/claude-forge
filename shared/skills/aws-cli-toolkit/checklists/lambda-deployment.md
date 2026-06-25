# Lambda Deployment Checklist

## Table of Contents

- [Pre-Development](#pre-development)
- [Development](#development)
  - [1. Code Changes](#1-code-changes)
  - [2. Package Preparation](#2-package-preparation)
  - [3. Configuration Review](#3-configuration-review)
- [Pre-Deployment Validation](#pre-deployment-validation)
  - [1. AWS Authentication](#1-aws-authentication)
  - [2. Function State Check](#2-function-state-check)
  - [3. Dependency Verification](#3-dependency-verification)
- [Deployment Execution](#deployment-execution)
  - [1. Upload Package](#1-upload-package)
  - [2. Wait for Update](#2-wait-for-update)
  - [3. Update Configuration (if needed)](#3-update-configuration-if-needed)
- [Post-Deployment Validation](#post-deployment-validation)
  - [1. Smoke Test](#1-smoke-test)
  - [2. Log Verification](#2-log-verification)
  - [3. Metrics Check](#3-metrics-check)
- [Version Management (if using aliases)](#version-management-if-using-aliases)
  - [1. Publish Version](#1-publish-version)
  - [2. Update Alias](#2-update-alias)
  - [3. Canary Deployment (optional)](#3-canary-deployment-optional)
- [Rollback Procedure](#rollback-procedure)
  - [Quick Rollback (Alias-based)](#quick-rollback-alias-based)
  - [Code Rollback](#code-rollback)
- [Post-Deployment Monitoring](#post-deployment-monitoring)
- [Production Deployment Notes](#production-deployment-notes)
- [Red Flags (Abort Deployment)](#red-flags-abort-deployment)

Pre-deployment validation checklist for AWS Lambda function deployments on the acme platform.

## Pre-Development

- [ ] **Review requirements** - Understand what changes are needed
- [ ] **Check current function** - Review existing configuration and code
- [ ] **Plan deployment strategy** - Direct update vs. alias-based vs. canary
- [ ] **Estimate impact** - Will this require downtime?

## Development

### 1. Code Changes

- [ ] **Implement changes** in Lambda function code
- [ ] **Update dependencies** if needed
- [ ] **Update environment variables** if needed
- [ ] **Update IAM permissions** if needed
- [ ] **Run local tests** to verify functionality

### 2. Package Preparation

- [ ] **Build package** (zip or Docker image)
- [ ] **Verify package size** (< 50MB for direct upload, < 250MB uncompressed)
- [ ] **Check dependencies** are included
- [ ] **Verify handler path** is correct
- [ ] **Remove dev dependencies** from production package

### 3. Configuration Review

- [ ] **Memory size** is appropriate
- [ ] **Timeout** is appropriate for expected execution time
- [ ] **Environment variables** are correct
- [ ] **VPC configuration** is correct (if applicable)
- [ ] **Layers** are up to date

## Pre-Deployment Validation

### 1. AWS Authentication

```bash
# Login to AWS SSO
aws sso login --profile acme-dev

# Verify identity
aws sts get-caller-identity --profile acme-dev
```

- [ ] **AWS credentials** are valid and not expired
- [ ] **Correct profile** is being used (dev vs. prod)

### 2. Function State Check

```bash
# Check current function state
aws lambda get-function --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "Configuration.[State,LastUpdateStatus]"
```

- [ ] **Function state** is Active
- [ ] **No pending updates** on the function

### 3. Dependency Verification

- [ ] **Required AWS services** are available (RDS, Secrets Manager, etc.)
- [ ] **Network connectivity** is verified (if VPC-attached)
- [ ] **IAM permissions** are sufficient

## Deployment Execution

### 1. Upload Package

```bash
# Option A: Deploy from S3 (recommended for large packages)
aws s3 cp function.zip s3://acme-deployments-dev/functions/api-service/ \
  --profile acme-dev

aws lambda update-function-code --profile acme-dev \
  --function-name acme-api-service-dev \
  --s3-bucket acme-deployments-dev \
  --s3-key functions/api-service/function.zip

# Option B: Deploy from local zip
aws lambda update-function-code --profile acme-dev \
  --function-name acme-api-service-dev \
  --zip-file fileb://function.zip
```

- [ ] **Package uploaded** successfully
- [ ] **Update initiated** without errors

### 2. Wait for Update

```bash
# Wait for update to complete
aws lambda wait function-updated --profile acme-dev \
  --function-name acme-api-service-dev

# Verify state
aws lambda get-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "[State,LastUpdateStatus]"
```

- [ ] **Update completed** successfully
- [ ] **Function state** is Active

### 3. Update Configuration (if needed)

```bash
# Update environment variables
aws lambda update-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --environment "Variables={KEY=value}"
```

- [ ] **Configuration updated** successfully

## Post-Deployment Validation

### 1. Smoke Test

```bash
# Invoke function with test payload
aws lambda invoke --profile acme-dev \
  --function-name acme-api-service-dev \
  --payload '{"action": "health_check"}' \
  --cli-binary-format raw-in-base64-out \
  response.json && cat response.json
```

- [ ] **Function invokes** successfully
- [ ] **Response is valid** (no errors)
- [ ] **Execution time** is reasonable

### 2. Log Verification

```bash
# Check recent logs for errors
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 10m --filter-pattern "ERROR"
```

- [ ] **No errors** in logs
- [ ] **Expected log messages** are present
- [ ] **No unexpected warnings**

### 3. Metrics Check

```bash
# Check error count
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=acme-api-service-dev \
  --start-time $(date -u -v-15M +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 --statistics Sum
```

- [ ] **Error count** is zero or expected
- [ ] **Duration** is within acceptable range
- [ ] **No throttling** observed

## Version Management (if using aliases)

### 1. Publish Version

```bash
# Publish new version
VERSION=$(aws lambda publish-version --profile acme-dev \
  --function-name acme-api-service-dev \
  --description "Deployment $(date +%Y-%m-%d)" \
  --query Version --output text)
echo "Published version: $VERSION"
```

- [ ] **Version published** successfully

### 2. Update Alias

```bash
# Update alias to new version
aws lambda update-alias --profile acme-dev \
  --function-name acme-api-service-dev \
  --name live \
  --function-version $VERSION
```

- [ ] **Alias updated** to new version

### 3. Canary Deployment (optional)

```bash
# Route 10% traffic to new version
aws lambda update-alias --profile acme-dev \
  --function-name acme-api-service-dev \
  --name live \
  --function-version 5 \
  --routing-config AdditionalVersionWeights={"6"=0.1}
```

- [ ] **Canary traffic** configured
- [ ] **Monitor for 15-30 minutes** before increasing traffic

## Rollback Procedure

**If issues are detected:**

### Quick Rollback (Alias-based)

```bash
# Revert alias to previous version
aws lambda update-alias --profile acme-dev \
  --function-name acme-api-service-dev \
  --name live \
  --function-version PREVIOUS_VERSION
```

### Code Rollback

```bash
# Deploy previous package from S3
aws lambda update-function-code --profile acme-dev \
  --function-name acme-api-service-dev \
  --s3-bucket acme-deployments-dev \
  --s3-key functions/api-service/function-previous.zip
```

## Post-Deployment Monitoring

- [ ] **Monitor for 1 hour** after deployment
- [ ] **Check error rates** in CloudWatch
- [ ] **Verify business metrics** are normal
- [ ] **Update team** on deployment status

## Production Deployment Notes

For production deployments:

- [ ] **Deployment window** is during low-traffic period
- [ ] **On-call engineer** is available
- [ ] **Rollback plan** is documented and tested
- [ ] **Stakeholders** are notified
- [ ] **Monitoring dashboards** are open

## Red Flags (Abort Deployment)

- Error rate > 1% after deployment
- Latency increase > 50%
- Throttling errors
- Database connection failures
- Unexpected 5xx responses
