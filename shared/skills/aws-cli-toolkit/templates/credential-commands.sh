#!/bin/bash
# AWS Secrets Manager CLI Commands for Acme Platform
# Usage: Source this file or copy commands as needed

# ==============================================================================
# AUTHENTICATION
# ==============================================================================

# Login to AWS SSO (required before any operations)
aws sso login --profile acme-dev

# Verify identity
aws sts get-caller-identity --profile acme-dev

# ==============================================================================
# RETRIEVE CREDENTIALS
# ==============================================================================

# Get full credential as JSON
aws secretsmanager get-secret-value --profile acme-dev \
  --secret-id acme/dev/database \
  --query SecretString --output text | jq .

# Get database password only
aws secretsmanager get-secret-value --profile acme-dev \
  --secret-id acme/dev/database \
  --query SecretString --output text | jq -r '.password'

# Get database username
aws secretsmanager get-secret-value --profile acme-dev \
  --secret-id acme/dev/database \
  --query SecretString --output text | jq -r '.username'

# Build connection string
aws secretsmanager get-secret-value --profile acme-dev \
  --secret-id acme/dev/database \
  --query SecretString --output text | \
  jq -r '"postgresql://\(.username):\(.password)@\(.host):\(.port)/\(.dbname)"'

# Export as environment variable
export DB_PASSWORD=$(aws secretsmanager get-secret-value --profile acme-dev \
  --secret-id acme/dev/database \
  --query SecretString --output text | jq -r '.password')

# ==============================================================================
# LIST CREDENTIALS
# ==============================================================================

# List all acme credentials
aws secretsmanager list-secrets --profile acme-dev \
  --query "SecretList[?starts_with(Name, 'acme/')].[Name,LastChangedDate]" \
  --output table

# List with rotation status
aws secretsmanager list-secrets --profile acme-dev \
  --query "SecretList[?starts_with(Name, 'acme/')].[Name,RotationEnabled,LastRotatedDate]" \
  --output table

# Filter by environment tag
aws secretsmanager list-secrets --profile acme-dev \
  --filters Key=tag-key,Values=Environment Key=tag-value,Values=dev \
  --query "SecretList[*].[Name,Description]" \
  --output table

# ==============================================================================
# UPDATE CREDENTIALS
# ==============================================================================

# Replace entire value
aws secretsmanager put-secret-value --profile acme-dev \
  --secret-id acme/dev/api-keys \
  --secret-string '{
    "api_key": "new-api-key-value",
    "api_secret": "new-api-secret-value",
    "endpoint": "https://api.example.com"
  }'

# Update single field (get-modify-put pattern)
SECRET_ID="acme/dev/api-keys"

# 1. Get current value
CURRENT=$(aws secretsmanager get-secret-value --profile acme-dev \
  --secret-id $SECRET_ID \
  --query SecretString --output text)

# 2. Update specific field
UPDATED=$(echo "$CURRENT" | jq '.api_key = "updated-api-key"')

# 3. Put back
aws secretsmanager put-secret-value --profile acme-dev \
  --secret-id $SECRET_ID \
  --secret-string "$UPDATED"

echo "Updated: $SECRET_ID"

# ==============================================================================
# CREATE CREDENTIALS
# ==============================================================================

# Create with JSON value
aws secretsmanager create-secret --profile acme-dev \
  --name acme/dev/new-service \
  --description "Credentials for new acme service" \
  --secret-string '{
    "username": "service_user",
    "password": "secure-password-here",
    "endpoint": "https://new-service.internal"
  }' \
  --tags Key=Environment,Value=dev Key=Service,Value=acme

# ==============================================================================
# ROTATION
# ==============================================================================

# Enable rotation with Lambda function
aws secretsmanager rotate-secret --profile acme-dev \
  --secret-id acme/dev/database \
  --rotation-lambda-arn arn:aws:lambda:us-east-1:123456789012:function:acme-secret-rotation \
  --rotation-rules AutomaticallyAfterDays=30

# Trigger immediate rotation
aws secretsmanager rotate-secret --profile acme-dev \
  --secret-id acme/dev/database

# Check rotation status
aws secretsmanager describe-secret --profile acme-dev \
  --secret-id acme/dev/database \
  --query "[RotationEnabled,LastRotatedDate,NextRotationDate]"

# Disable rotation
aws secretsmanager cancel-rotate-secret --profile acme-dev \
  --secret-id acme/dev/database

# ==============================================================================
# METADATA
# ==============================================================================

# Describe (metadata only, no value)
aws secretsmanager describe-secret --profile acme-dev \
  --secret-id acme/dev/database

# Update description
aws secretsmanager update-secret --profile acme-dev \
  --secret-id acme/dev/database \
  --description "PostgreSQL credentials for acme-db-dev (updated $(date +%Y-%m))"

# Add/update tags
aws secretsmanager tag-resource --profile acme-dev \
  --secret-id acme/dev/database \
  --tags Key=Owner,Value=platform-team Key=CostCenter,Value=acme

# ==============================================================================
# VERSION MANAGEMENT
# ==============================================================================

# Get previous version
aws secretsmanager get-secret-value --profile acme-dev \
  --secret-id acme/dev/database \
  --version-stage AWSPREVIOUS \
  --query SecretString --output text | jq .

# List version stages
aws secretsmanager describe-secret --profile acme-dev \
  --secret-id acme/dev/database \
  --query "VersionIdsToStages"

# ==============================================================================
# DELETION
# ==============================================================================

# Schedule deletion (7-day recovery window)
aws secretsmanager delete-secret --profile acme-dev \
  --secret-id acme/dev/old-service \
  --recovery-window-in-days 7

# Restore deleted (within recovery window)
aws secretsmanager restore-secret --profile acme-dev \
  --secret-id acme/dev/old-service

# ==============================================================================
# TROUBLESHOOTING
# ==============================================================================

# Verify entry exists
aws secretsmanager describe-secret --profile acme-dev \
  --secret-id acme/dev/database

# Check IAM permissions
aws iam simulate-principal-policy --profile acme-dev \
  --policy-source-arn arn:aws:iam::123456789012:role/acme-lambda-execution-role \
  --action-names secretsmanager:GetSecretValue \
  --resource-arns "arn:aws:secretsmanager:us-east-1:123456789012:secret:acme/dev/database*"

# Check resource policy
aws secretsmanager get-resource-policy --profile acme-dev \
  --secret-id acme/dev/database

# Check for deleted entries
aws secretsmanager list-secrets --profile acme-dev \
  --include-planned-deletion \
  --query "SecretList[?DeletedDate!=null].[Name,DeletedDate]"
