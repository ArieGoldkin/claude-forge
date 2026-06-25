# AWS Secrets Manager Operations Reference

## Table of Contents

- [Secret Retrieval](#secret-retrieval)
  - [Get Full Secret](#get-full-secret)
  - [Extract Specific Fields](#extract-specific-fields)
  - [Get Specific Version](#get-specific-version)
- [Secret Listing](#secret-listing)
  - [List All Acme Entries](#list-all-acme-entries)
  - [Filter by Tags](#filter-by-tags)
- [Secret Updates](#secret-updates)
  - [Update Entire Value](#update-entire-value)
  - [Update Single Field](#update-single-field)
  - [Add New Field](#add-new-field)
- [Secret Creation](#secret-creation)
  - [Create New Entry](#create-new-entry)
- [Secret Rotation](#secret-rotation)
  - [Enable Rotation](#enable-rotation)
  - [Trigger Immediate Rotation](#trigger-immediate-rotation)
  - [Disable Rotation](#disable-rotation)
- [Secret Metadata](#secret-metadata)
  - [Describe Entry](#describe-entry)
  - [Update Description](#update-description)
  - [Add/Update Tags](#addupdate-tags)
- [Secret Deletion](#secret-deletion)
  - [Schedule Deletion](#schedule-deletion)
  - [Restore Deleted Entry](#restore-deleted-entry)
- [External Secrets Operator Integration](#external-secrets-operator-integration)
  - [ExternalSecret Resource](#externalsecret-resource)
  - [ClusterSecretStore Resource](#clustersecretstore-resource)
  - [Verify ESO Sync](#verify-eso-sync)
- [Acme Credential Inventory](#acme-credential-inventory)
- [Troubleshooting](#troubleshooting)
  - [Access Denied](#access-denied)
  - [Entry Not Found](#entry-not-found)
  - [Rotation Failed](#rotation-failed)

Comprehensive guide for AWS Secrets Manager operations for the acme platform.

## Secret Retrieval

### Get Full Secret

```bash
# Get secret as JSON
aws secretsmanager get-secret-value --profile acme-dev \
  --secret-id acme/dev/database \
  --query SecretString --output text | jq .

# Get secret with version info
aws secretsmanager get-secret-value --profile acme-dev \
  --secret-id acme/dev/database
```

### Extract Specific Fields

```bash
# Get database password
aws secretsmanager get-secret-value --profile acme-dev \
  --secret-id acme/dev/database \
  --query SecretString --output text | jq -r '.password'

# Get username
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
```

### Get Specific Version

```bash
# Get previous version
aws secretsmanager get-secret-value --profile acme-dev \
  --secret-id acme/dev/database \
  --version-stage AWSPREVIOUS \
  --query SecretString --output text | jq .

# Get by version ID
aws secretsmanager get-secret-value --profile acme-dev \
  --secret-id acme/dev/database \
  --version-id abc123-def456 \
  --query SecretString --output text | jq .
```

## Secret Listing

### List All Acme Entries

```bash
# List with name and last changed date
aws secretsmanager list-secrets --profile acme-dev \
  --query "SecretList[?starts_with(Name, 'acme/')].[Name,LastChangedDate]" \
  --output table

# List with rotation status
aws secretsmanager list-secrets --profile acme-dev \
  --query "SecretList[?starts_with(Name, 'acme/')].[Name,RotationEnabled,LastRotatedDate]" \
  --output table
```

### Filter by Tags

```bash
# Filter by environment tag
aws secretsmanager list-secrets --profile acme-dev \
  --filters Key=tag-key,Values=Environment Key=tag-value,Values=dev \
  --query "SecretList[*].[Name,Description]" \
  --output table
```

## Secret Updates

### Update Entire Value

```bash
# Replace entire value
aws secretsmanager put-secret-value --profile acme-dev \
  --secret-id acme/dev/api-keys \
  --secret-string '{
    "api_key": "new-api-key-value",
    "api_secret": "new-api-secret-value",
    "endpoint": "https://api.example.com"
  }'
```

### Update Single Field

```bash
# Get current, update field, put back
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
```

### Add New Field

```bash
# Add field to existing entry
SECRET_ID="acme/dev/api-keys"

CURRENT=$(aws secretsmanager get-secret-value --profile acme-dev \
  --secret-id $SECRET_ID \
  --query SecretString --output text)

UPDATED=$(echo "$CURRENT" | jq '. + {"new_field": "new_value"}')

aws secretsmanager put-secret-value --profile acme-dev \
  --secret-id $SECRET_ID \
  --secret-string "$UPDATED"
```

## Secret Creation

### Create New Entry

```bash
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

# Create with binary value
aws secretsmanager create-secret --profile acme-dev \
  --name acme/dev/certificate \
  --description "TLS certificate for acme service" \
  --secret-binary fileb://certificate.pem
```

## Secret Rotation

### Enable Rotation

```bash
# Enable rotation with Lambda function
aws secretsmanager rotate-secret --profile acme-dev \
  --secret-id acme/dev/database \
  --rotation-lambda-arn arn:aws:lambda:us-east-1:123456789012:function:acme-secret-rotation \
  --rotation-rules AutomaticallyAfterDays=30
```

### Trigger Immediate Rotation

```bash
# Rotate now (doesn't wait for schedule)
aws secretsmanager rotate-secret --profile acme-dev \
  --secret-id acme/dev/database

# Check rotation status
aws secretsmanager describe-secret --profile acme-dev \
  --secret-id acme/dev/database \
  --query "[RotationEnabled,LastRotatedDate,NextRotationDate]"
```

### Disable Rotation

```bash
aws secretsmanager cancel-rotate-secret --profile acme-dev \
  --secret-id acme/dev/database
```

## Secret Metadata

### Describe Entry

```bash
# Get metadata (no value)
aws secretsmanager describe-secret --profile acme-dev \
  --secret-id acme/dev/database

# Get specific metadata fields
aws secretsmanager describe-secret --profile acme-dev \
  --secret-id acme/dev/database \
  --query "{Name:Name,ARN:ARN,RotationEnabled:RotationEnabled,LastChanged:LastChangedDate,Versions:VersionIdsToStages}"
```

### Update Description

```bash
aws secretsmanager update-secret --profile acme-dev \
  --secret-id acme/dev/database \
  --description "PostgreSQL credentials for acme-db-dev (updated 2026-01)"
```

### Add/Update Tags

```bash
aws secretsmanager tag-resource --profile acme-dev \
  --secret-id acme/dev/database \
  --tags Key=Owner,Value=platform-team Key=CostCenter,Value=acme
```

## Secret Deletion

### Schedule Deletion

```bash
# Schedule deletion (7-30 days recovery window)
aws secretsmanager delete-secret --profile acme-dev \
  --secret-id acme/dev/old-service \
  --recovery-window-in-days 7

# Immediate deletion (no recovery)
aws secretsmanager delete-secret --profile acme-dev \
  --secret-id acme/dev/old-service \
  --force-delete-without-recovery
```

### Restore Deleted Entry

```bash
# Restore within recovery window
aws secretsmanager restore-secret --profile acme-dev \
  --secret-id acme/dev/old-service
```

## External Secrets Operator Integration

The acme platform uses External Secrets Operator (ESO) to sync from AWS to Kubernetes.

### ExternalSecret Resource

```yaml
# external-secret.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: database-credentials
  namespace: acme
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: database-credentials
    creationPolicy: Owner
  data:
    - secretKey: DB_HOST
      remoteRef:
        key: acme/dev/database
        property: host
    - secretKey: DB_PASSWORD
      remoteRef:
        key: acme/dev/database
        property: password
    - secretKey: DB_USERNAME
      remoteRef:
        key: acme/dev/database
        property: username
```

### ClusterSecretStore Resource

```yaml
# cluster-secret-store.yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: aws-secrets-manager
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets
            namespace: external-secrets
```

### Verify ESO Sync

```bash
# Check ExternalSecret status
kubectl get externalsecret -n acme

# Check synced Kubernetes secret
kubectl get secret database-credentials -n acme -o yaml

# Describe for sync errors
kubectl describe externalsecret database-credentials -n acme
```

## Acme Credential Inventory

| Path | Purpose | Rotation |
|------|---------|----------|
| `acme/dev/database` | RDS PostgreSQL credentials | 30 days |
| `acme/dev/api-keys` | Third-party API keys | Manual |
| `acme/dev/jwt-secret` | JWT signing key | 90 days |
| `acme/dev/encryption-key` | Data encryption key | 365 days |
| `acme/prod/database` | Production DB credentials | 30 days |
| `acme/prod/api-keys` | Production API keys | Manual |

## Troubleshooting

### Access Denied

```bash
# 1. Verify entry exists
aws secretsmanager describe-secret --profile acme-dev \
  --secret-id acme/dev/database

# 2. Check IAM permissions
aws iam simulate-principal-policy --profile acme-dev \
  --policy-source-arn arn:aws:iam::123456789012:role/acme-lambda-execution-role \
  --action-names secretsmanager:GetSecretValue \
  --resource-arns "arn:aws:secretsmanager:us-east-1:123456789012:secret:acme/dev/database*"

# 3. Check resource policy
aws secretsmanager get-resource-policy --profile acme-dev \
  --secret-id acme/dev/database
```

### Entry Not Found

```bash
# List all to verify name
aws secretsmanager list-secrets --profile acme-dev \
  --query "SecretList[*].Name" | grep -i database

# Check for deleted entries
aws secretsmanager list-secrets --profile acme-dev \
  --include-planned-deletion \
  --query "SecretList[?DeletedDate!=null].[Name,DeletedDate]"
```

### Rotation Failed

```bash
# Check rotation Lambda logs
aws logs tail --profile acme-dev \
  /aws/lambda/acme-secret-rotation \
  --since 1h --filter-pattern "ERROR"

# Check CloudTrail for rotation events
aws cloudtrail lookup-events --profile acme-dev \
  --lookup-attributes AttributeKey=EventName,AttributeValue=RotateSecret \
  --start-time $(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)
```
