#!/bin/bash
# AWS Lambda CLI Commands for Acme Platform
# Usage: Source this file or copy commands as needed

# ==============================================================================
# AUTHENTICATION
# ==============================================================================

# Login to AWS SSO (required before any operations)
aws sso login --profile acme-dev

# Verify identity
aws sts get-caller-identity --profile acme-dev

# ==============================================================================
# LIST AND INSPECT FUNCTIONS
# ==============================================================================

# List all acme Lambda functions
aws lambda list-functions --profile acme-dev \
  --query "Functions[?starts_with(FunctionName, 'acme-')].[FunctionName,Runtime,LastModified]" \
  --output table

# Get function details
aws lambda get-function --profile acme-dev \
  --function-name acme-api-service-dev

# Get function configuration
aws lambda get-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev

# Get function URL (if configured)
aws lambda get-function-url-config --profile acme-dev \
  --function-name acme-api-service-dev

# ==============================================================================
# DEPLOY FROM S3
# ==============================================================================

# Upload package to S3
aws s3 cp function.zip \
  s3://acme-deployments-dev/functions/api-service/function.zip \
  --profile acme-dev

# Update function code from S3
aws lambda update-function-code --profile acme-dev \
  --function-name acme-api-service-dev \
  --s3-bucket acme-deployments-dev \
  --s3-key functions/api-service/function.zip

# Wait for update to complete
aws lambda wait function-updated --profile acme-dev \
  --function-name acme-api-service-dev

# ==============================================================================
# DEPLOY FROM LOCAL ZIP
# ==============================================================================

# Direct upload (for packages < 50MB)
aws lambda update-function-code --profile acme-dev \
  --function-name acme-api-service-dev \
  --zip-file fileb://function.zip

# ==============================================================================
# VERSION MANAGEMENT
# ==============================================================================

# Publish new version
VERSION=$(aws lambda publish-version --profile acme-dev \
  --function-name acme-api-service-dev \
  --description "Release $(date +%Y-%m-%d)" \
  --query Version --output text)
echo "Published version: $VERSION"

# List all versions
aws lambda list-versions-by-function --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "Versions[*].[Version,Description,LastModified]" \
  --output table

# ==============================================================================
# ALIAS MANAGEMENT
# ==============================================================================

# List aliases
aws lambda list-aliases --profile acme-dev \
  --function-name acme-api-service-dev \
  --query "Aliases[*].[Name,FunctionVersion,Description]" \
  --output table

# Update alias to point to new version
aws lambda update-alias --profile acme-dev \
  --function-name acme-api-service-dev \
  --name live \
  --function-version $VERSION

# Create canary deployment (10% to new version)
aws lambda update-alias --profile acme-dev \
  --function-name acme-api-service-dev \
  --name live \
  --function-version 5 \
  --routing-config AdditionalVersionWeights={"6"=0.1}

# ==============================================================================
# INVOKE FUNCTION
# ==============================================================================

# Synchronous invocation
aws lambda invoke --profile acme-dev \
  --function-name acme-api-service-dev \
  --payload '{"action": "health_check"}' \
  --cli-binary-format raw-in-base64-out \
  response.json && cat response.json

# Asynchronous invocation
aws lambda invoke --profile acme-dev \
  --function-name acme-api-service-dev \
  --invocation-type Event \
  --payload '{"action": "process_batch"}' \
  --cli-binary-format raw-in-base64-out \
  /dev/null

# Invoke with log tail
aws lambda invoke --profile acme-dev \
  --function-name acme-api-service-dev \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  --log-type Tail \
  --query 'LogResult' \
  response.json | tr -d '"' | base64 -d

# Invoke specific alias
aws lambda invoke --profile acme-dev \
  --function-name acme-api-service-dev \
  --qualifier live \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  response.json

# ==============================================================================
# CONFIGURATION UPDATES
# ==============================================================================

# Update environment variables
aws lambda update-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --environment "Variables={LOG_LEVEL=DEBUG,FEATURE_FLAG=true}"

# Update memory and timeout
aws lambda update-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --memory-size 512 \
  --timeout 30

# Set reserved concurrency
aws lambda put-function-concurrency --profile acme-dev \
  --function-name acme-api-service-dev \
  --reserved-concurrent-executions 100

# ==============================================================================
# LAYERS
# ==============================================================================

# List available layers
aws lambda list-layers --profile acme-dev \
  --query "Layers[?starts_with(LayerName, 'acme')].[LayerName,LatestMatchingVersion.Version]" \
  --output table

# Add layer to function
aws lambda update-function-configuration --profile acme-dev \
  --function-name acme-api-service-dev \
  --layers arn:aws:lambda:us-east-1:123456789012:layer:acme-powertools:5

# ==============================================================================
# LOGS
# ==============================================================================

# Tail logs in real-time
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 30m --follow

# Filter for errors
aws logs tail --profile acme-dev \
  /aws/lambda/acme-api-service-dev \
  --since 1h --filter-pattern "ERROR"

# ==============================================================================
# METRICS
# ==============================================================================

# Get invocation count (last hour)
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=acme-api-service-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Sum

# Check for errors
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=acme-api-service-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Sum

# Check for throttling
aws cloudwatch get-metric-statistics --profile acme-dev \
  --namespace AWS/Lambda \
  --metric-name Throttles \
  --dimensions Name=FunctionName,Value=acme-api-service-dev \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Sum
