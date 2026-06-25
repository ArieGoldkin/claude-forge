# Lambda Operations Reference

## Table of Contents

- [Function Deployment](#function-deployment)
  - [Deploy from S3 (Recommended)](#deploy-from-s3-recommended)
  - [Deploy from Local Zip](#deploy-from-local-zip)
  - [Deploy with Docker Image](#deploy-with-docker-image)
- [Version Management](#version-management)
  - [Publish Version](#publish-version)
  - [List Versions](#list-versions)
  - [Delete Old Versions](#delete-old-versions)
- [Alias Management](#alias-management)
  - [Create Alias](#create-alias)
  - [Update Alias](#update-alias)
  - [Weighted Alias (Canary Deployment)](#weighted-alias-canary-deployment)
- [Lambda Layers](#lambda-layers)
  - [List Available Layers](#list-available-layers)
  - [Add Layer to Function](#add-layer-to-function)
  - [Publish Layer Version](#publish-layer-version)
- [Function Invocation](#function-invocation)
  - [Synchronous Invocation](#synchronous-invocation)
  - [Asynchronous Invocation](#asynchronous-invocation)
  - [Invoke with Log Tail](#invoke-with-log-tail)
  - [Invoke Specific Version/Alias](#invoke-specific-versionalias)
- [Configuration Management](#configuration-management)
  - [Environment Variables](#environment-variables)
  - [Memory and Timeout](#memory-and-timeout)
  - [Concurrency](#concurrency)
  - [VPC Configuration](#vpc-configuration)
- [Function Logs](#function-logs)
  - [View Recent Logs](#view-recent-logs)
  - [Filter Logs](#filter-logs)
- [Troubleshooting](#troubleshooting)
  - [Function Not Found](#function-not-found)
  - [Update Stuck in Progress](#update-stuck-in-progress)
  - [Permission Denied](#permission-denied)
  - [Out of Memory](#out-of-memory)

Comprehensive guide for AWS Lambda deployment, invocation, and management for the acme platform.

## Function Deployment

### Deploy from S3 (Recommended)

For packages larger than 50MB, upload to S3 first:

```bash
# 1. Package function
cd lambda/api-service
zip -r function.zip .

# 2. Upload to S3
aws s3 cp function.zip \
  s3://acme-deployments-dev/functions/api-service/function.zip \
  --profile acme-dev

# 3. Update function code
aws lambda update-function-code --profile acme-dev \
  --function-name acme-api-service-dev \
  --s3-bucket acme-deployments-dev \
  --s3-key functions/api-service/function.zip

# 4. Wait for update to complete
aws lambda wait function-updated --profile acme-dev \
  --function-name acme-api-service-dev
```

### Deploy from Local Zip

For smaller packages (< 50MB uncompressed):

```bash
# Direct upload
aws lambda update-function-code --profile acme-dev \
  --function-name acme-api-service-dev \
  --zip-file fileb://function.zip
```

### Deploy with Docker Image

For container-based Lambda functions:

```bash
# 1. Build and push to ECR
docker build -t acme-api-service .
aws ecr get-login-password --profile acme-dev | \
  docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

docker tag acme-api-service:latest \
  123456789012.dkr.ecr.us-east-1.amazonaws.com/acme-api-service:latest
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/acme-api-service:latest

# 2. Update function to use new image
aws lambda update-function-code --profile acme-dev \
  --function-name acme-api-service-dev \
  --image-uri 123456789012.dkr.ecr.us-east-1.amazonaws.com/acme-api-service:latest
```

## Version Management

### Publish Version

```bash
# Publish new version with description
VERSION=$(aws lambda publish-version --profile acme-dev \
  --function-name acme-api-service-dev \
  --description "Release v1.2.3 - Added user search" \
  --query Version --output text)

echo "Published version: $VERSION"
```

### List Versions

```bash
aws lambda list-versions-by-function --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "Versions[*].[Version,Description,LastModified]" \
  --output table
```

### Delete Old Versions

```bash
# List versions older than 30 days (keep last 5)
aws lambda list-versions-by-function --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "Versions[?Version!='\$LATEST']|sort_by(@, &LastModified)|[:-5].[Version]" \
  --output text | xargs -I {} aws lambda delete-function --profile acme-dev \
  --function-name acme-api-service-dev --qualifier {}
```

## Alias Management

### Create Alias

```bash
# Create 'live' alias pointing to version
aws lambda create-alias --profile acme-dev \
  --function-name acme-api-service-dev \
  --name live \
  --function-version 5 \
  --description "Production traffic"
```

### Update Alias

```bash
# Point alias to new version
aws lambda update-alias --profile acme-dev \
  --function-name acme-api-service-dev \
  --name live \
  --function-version $NEW_VERSION
```

### Weighted Alias (Canary Deployment)

```bash
# Route 10% traffic to new version
aws lambda update-alias --profile acme-dev \
  --function-name acme-api-service-dev \
  --name live \
  --function-version 5 \
  --routing-config AdditionalVersionWeights={"6"=0.1}

# Increase to 50%
aws lambda update-alias --profile acme-dev \
  --function-name acme-api-service-dev \
  --name live \
  --routing-config AdditionalVersionWeights={"6"=0.5}

# Full rollout (remove weighted routing)
aws lambda update-alias --profile acme-dev \
  --function-name acme-api-service-dev \
  --name live \
  --function-version 6 \
  --routing-config AdditionalVersionWeights={}
```

## Lambda Layers

### List Available Layers

```bash
aws lambda list-layers --profile acme-dev \
  --query "Layers[?starts_with(LayerName, 'acme')].[LayerName,LatestMatchingVersion.Version]" \
  --output table
```

### Add Layer to Function

```bash
# Get current layers
CURRENT_LAYERS=$(aws lambda get-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "Layers[*].Arn" --output text | tr '\t' ' ')

# Add new layer (preserving existing)
aws lambda update-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --layers $CURRENT_LAYERS \
    arn:aws:lambda:us-east-1:123456789012:layer:acme-powertools:5
```

### Publish Layer Version

```bash
# Create layer zip (dependencies only)
pip install -t python/lib/python3.10/site-packages aws-lambda-powertools
zip -r layer.zip python

# Publish layer
aws lambda publish-layer-version --profile acme-dev \
  --layer-name acme-powertools \
  --description "AWS Lambda Powertools v2.x" \
  --zip-file fileb://layer.zip \
  --compatible-runtimes python3.10 python3.11
```

## Function Invocation

### Synchronous Invocation

```bash
# Invoke and get response
aws lambda invoke --profile acme-dev \
  --function-name acme-api-service-dev \
  --payload '{"action": "get_user", "user_id": "123"}' \
  --cli-binary-format raw-in-base64-out \
  response.json

cat response.json | jq .
```

### Asynchronous Invocation

```bash
# Fire and forget
aws lambda invoke --profile acme-dev \
  --function-name acme-api-service-dev \
  --invocation-type Event \
  --payload '{"action": "process_batch", "batch_id": "abc"}' \
  --cli-binary-format raw-in-base64-out \
  /dev/null
```

### Invoke with Log Tail

```bash
# Get logs from invocation
aws lambda invoke --profile acme-dev \
  --function-name acme-api-service-dev \
  --payload '{"action": "test"}' \
  --cli-binary-format raw-in-base64-out \
  --log-type Tail \
  --query 'LogResult' \
  response.json | tr -d '"' | base64 -d
```

### Invoke Specific Version/Alias

```bash
# Invoke specific version
aws lambda invoke --profile acme-dev \
  --function-name acme-api-service-dev \
  --qualifier 5 \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  response.json

# Invoke alias
aws lambda invoke --profile acme-dev \
  --function-name acme-api-service-dev \
  --qualifier live \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  response.json
```

## Configuration Management

### Environment Variables

```bash
# Get current environment
aws lambda get-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "Environment.Variables"

# Update environment (replaces all variables)
aws lambda update-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --environment "Variables={
    LOG_LEVEL=DEBUG,
    DB_SECRET_ARN=arn:aws:secretsmanager:us-east-1:123456789012:secret:acme/dev/database,
    POWERTOOLS_SERVICE_NAME=api-service
  }"
```

### Memory and Timeout

```bash
# Update memory (also affects CPU allocation)
aws lambda update-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --memory-size 1024 \
  --timeout 30
```

### Concurrency

```bash
# Set reserved concurrency (limits max concurrent executions)
aws lambda put-function-concurrency --profile acme-dev \
  --function-name acme-api-service-dev \
  --reserved-concurrent-executions 100

# Remove reserved concurrency
aws lambda delete-function-concurrency --profile acme-dev \
  --function-name acme-api-service-dev

# Set provisioned concurrency (pre-warmed instances)
aws lambda put-provisioned-concurrency-config --profile acme-dev \
  --function-name acme-api-service-dev \
  --qualifier live \
  --provisioned-concurrent-executions 5
```

### VPC Configuration

```bash
# Add to VPC
aws lambda update-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --vpc-config SubnetIds=subnet-abc123,subnet-def456,SecurityGroupIds=sg-xyz789

# Remove from VPC
aws lambda update-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --vpc-config SubnetIds=[],SecurityGroupIds=[]
```

## Function Logs

### View Recent Logs

```bash
# Tail logs (real-time)
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 30m --follow

# View logs without follow
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 1h
```

### Filter Logs

```bash
# Filter for errors
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 1h --filter-pattern "ERROR"

# Filter for specific request ID
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 1h --filter-pattern "request-id-123"

# Filter for cold starts
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 1h --filter-pattern "Init Duration"
```

## Troubleshooting

### Function Not Found

```bash
# List functions matching pattern
aws lambda list-functions --profile acme-dev \
  --query "Functions[?contains(FunctionName, 'acme')].[FunctionName,State,LastUpdateStatus]" \
  --output table
```

### Update Stuck in Progress

```bash
# Check update status
aws lambda get-function --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "Configuration.LastUpdateStatus"

# Wait for update to complete (timeout after 300s)
aws lambda wait function-updated --profile acme-dev \
  --function-name acme-api-service-dev
```

### Permission Denied

```bash
# Get execution role
ROLE=$(aws lambda get-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "Role" --output text)

# Check role policies
aws iam list-attached-role-policies --profile acme-dev \
  --role-name $(basename $ROLE)
```

### Out of Memory

```bash
# Check memory configuration
aws lambda get-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "[MemorySize,Timeout]"

# Check max memory used in CloudWatch
aws logs start-query --profile acme-dev \
  --log-group-name /aws/lambda/acme-api-service-dev \
  --start-time $(date -v-24H +%s) \
  --end-time $(date +%s) \
  --query-string '
    filter @type = "REPORT"
    | stats max(@maxMemoryUsed) as maxMemUsed, avg(@maxMemoryUsed) as avgMemUsed
  '
```
