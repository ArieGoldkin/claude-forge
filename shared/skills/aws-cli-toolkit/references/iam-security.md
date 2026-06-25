# IAM Security Reference

## Table of Contents

- [Role Inspection](#role-inspection)
  - [List Roles](#list-roles)
  - [Get Role Details](#get-role-details)
  - [List Role Policies](#list-role-policies)
- [Policy Management](#policy-management)
  - [Get Policy Document](#get-policy-document)
  - [List Policy Versions](#list-policy-versions)
  - [Create Policy Version](#create-policy-version)
- [Permission Analysis](#permission-analysis)
  - [Simulate Policy](#simulate-policy)
  - [Check Specific Permission](#check-specific-permission)
  - [Get Access Advisor (Last Accessed)](#get-access-advisor-last-accessed)
- [Assume Role](#assume-role)
  - [Assume Role for Testing](#assume-role-for-testing)
  - [Cross-Account Assume Role](#cross-account-assume-role)
- [Least Privilege Templates](#least-privilege-templates)
  - [Lambda Execution Role](#lambda-execution-role)
  - [S3 Read-Only Access](#s3-read-only-access)
  - [RDS Describe Only](#rds-describe-only)
- [Trust Policies](#trust-policies)
  - [Lambda Trust Policy](#lambda-trust-policy)
  - [Cross-Account Trust Policy](#cross-account-trust-policy)
- [Security Best Practices](#security-best-practices)
  - [Permission Boundaries](#permission-boundaries)
  - [Service Control Policies (SCPs)](#service-control-policies-scps)
- [Troubleshooting](#troubleshooting)
  - [Access Denied Debugging](#access-denied-debugging)
  - [Implicit Deny vs Explicit Deny](#implicit-deny-vs-explicit-deny)
  - [Check CloudTrail for Denied Actions](#check-cloudtrail-for-denied-actions)

Comprehensive guide for IAM role inspection, policy management, and least privilege patterns for the acme platform.

## Role Inspection

### List Roles

```bash
# List acme roles
aws iam list-roles --profile acme-dev \
  --query "Roles[?starts_with(RoleName, 'acme')].[RoleName,CreateDate,Description]" \
  --output table

# List Lambda execution roles
aws iam list-roles --profile acme-dev \
  --query "Roles[?contains(RoleName, 'lambda')].[RoleName,Arn]" \
  --output table
```

### Get Role Details

```bash
# Get role info
aws iam get-role --profile acme-dev \
  --role-name acme-lambda-execution-role

# Get trust policy (who can assume this role)
aws iam get-role --profile acme-dev \
  --role-name acme-lambda-execution-role \
  --query "Role.AssumeRolePolicyDocument"
```

### List Role Policies

```bash
# List attached managed policies
aws iam list-attached-role-policies --profile acme-dev \
  --role-name acme-lambda-execution-role \
  --query "AttachedPolicies[*].[PolicyName,PolicyArn]" \
  --output table

# List inline policies
aws iam list-role-policies --profile acme-dev \
  --role-name acme-lambda-execution-role

# Get inline policy document
aws iam get-role-policy --profile acme-dev \
  --role-name acme-lambda-execution-role \
  --policy-name LambdaBasicExecution
```

## Policy Management

### Get Policy Document

```bash
# Get managed policy (need version)
POLICY_ARN="arn:aws:iam::123456789012:policy/acme-lambda-policy"

# Get default version
VERSION=$(aws iam get-policy --profile acme-dev \
  --policy-arn $POLICY_ARN \
  --query "Policy.DefaultVersionId" --output text)

# Get policy document
aws iam get-policy-version --profile acme-dev \
  --policy-arn $POLICY_ARN \
  --version-id $VERSION \
  --query "PolicyVersion.Document"
```

### List Policy Versions

```bash
aws iam list-policy-versions --profile acme-dev \
  --policy-arn arn:aws:iam::123456789012:policy/acme-lambda-policy \
  --query "Versions[*].[VersionId,IsDefaultVersion,CreateDate]" \
  --output table
```

### Create Policy Version

```bash
# Create new version (keeps old as non-default)
aws iam create-policy-version --profile acme-dev \
  --policy-arn arn:aws:iam::123456789012:policy/acme-lambda-policy \
  --policy-document file://policy.json \
  --set-as-default
```

## Permission Analysis

### Simulate Policy

```bash
# Check if role can perform actions
aws iam simulate-principal-policy --profile acme-dev \
  --policy-source-arn arn:aws:iam::123456789012:role/acme-lambda-execution-role \
  --action-names \
    s3:GetObject \
    s3:PutObject \
    secretsmanager:GetSecretValue \
    logs:CreateLogStream \
    logs:PutLogEvents \
  --resource-arns \
    "arn:aws:s3:::acme-data-dev/*" \
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:acme/*" \
    "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/acme-*"
```

### Check Specific Permission

```bash
# Quick permission check
aws iam simulate-principal-policy --profile acme-dev \
  --policy-source-arn arn:aws:iam::123456789012:role/acme-lambda-execution-role \
  --action-names rds:DescribeDBInstances \
  --query "EvaluationResults[*].[EvalActionName,EvalDecision]" \
  --output table
```

### Get Access Advisor (Last Accessed)

```bash
# Generate report
JOB_ID=$(aws iam generate-service-last-accessed-details --profile acme-dev \
  --arn arn:aws:iam::123456789012:role/acme-lambda-execution-role \
  --query JobId --output text)

# Get results (wait for completion)
sleep 5
aws iam get-service-last-accessed-details --profile acme-dev \
  --job-id $JOB_ID \
  --query "ServicesLastAccessed[?LastAuthenticated!=null].[ServiceName,LastAuthenticated]" \
  --output table
```

## Assume Role

### Assume Role for Testing

```bash
# Assume role and get credentials
CREDS=$(aws sts assume-role --profile acme-dev \
  --role-arn arn:aws:iam::123456789012:role/acme-lambda-execution-role \
  --role-session-name test-session \
  --duration-seconds 3600)

# Export credentials
export AWS_ACCESS_KEY_ID=$(echo $CREDS | jq -r '.Credentials.AccessKeyId')
export AWS_SECRET_ACCESS_KEY=$(echo $CREDS | jq -r '.Credentials.SecretAccessKey')
export AWS_SESSION_TOKEN=$(echo $CREDS | jq -r '.Credentials.SessionToken')

# Test with assumed role
aws sts get-caller-identity

# Clear credentials when done
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
```

### Cross-Account Assume Role

```bash
# Assume role in different account
aws sts assume-role \
  --role-arn arn:aws:iam::PROD_ACCOUNT_ID:role/acme-readonly-role \
  --role-session-name cross-account-session \
  --external-id optional-external-id
```

## Least Privilege Templates

### Lambda Execution Role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/acme-*"
    },
    {
      "Sid": "SecretsManagerRead",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:acme/*"
    },
    {
      "Sid": "VPCNetworkInterfaces",
      "Effect": "Allow",
      "Action": [
        "ec2:CreateNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DeleteNetworkInterface"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "ec2:Vpc": "arn:aws:ec2:us-east-1:123456789012:vpc/vpc-acme"
        }
      }
    }
  ]
}
```

### S3 Read-Only Access

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3ReadOnly",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::acme-data-dev",
        "arn:aws:s3:::acme-data-dev/*"
      ]
    }
  ]
}
```

### RDS Describe Only

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RDSDescribe",
      "Effect": "Allow",
      "Action": [
        "rds:DescribeDBInstances",
        "rds:DescribeDBClusters",
        "rds:DescribeDBSnapshots"
      ],
      "Resource": "arn:aws:rds:us-east-1:123456789012:db:acme-*"
    }
  ]
}
```

## Trust Policies

### Lambda Trust Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### Cross-Account Trust Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::OTHER_ACCOUNT_ID:root"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "acme-external-id"
        }
      }
    }
  ]
}
```

## Security Best Practices

### Permission Boundaries

```bash
# List roles with permission boundary
aws iam list-roles --profile acme-dev \
  --query "Roles[?PermissionsBoundary!=null].[RoleName,PermissionsBoundary.PermissionsBoundaryArn]" \
  --output table

# Attach permission boundary
aws iam put-role-permissions-boundary --profile acme-dev \
  --role-name acme-lambda-execution-role \
  --permissions-boundary arn:aws:iam::123456789012:policy/acme-permission-boundary
```

### Service Control Policies (SCPs)

```bash
# List SCPs (requires Organizations access)
aws organizations list-policies --profile acme-dev \
  --filter SERVICE_CONTROL_POLICY

# Get SCP targets
aws organizations list-targets-for-policy --profile acme-dev \
  --policy-id p-xxxxxxxx
```

## Troubleshooting

### Access Denied Debugging

```bash
# 1. Identify the role
aws sts get-caller-identity --profile acme-dev

# 2. List all policies
ROLE_NAME="acme-lambda-execution-role"

echo "Attached policies:"
aws iam list-attached-role-policies --profile acme-dev \
  --role-name $ROLE_NAME

echo "Inline policies:"
aws iam list-role-policies --profile acme-dev \
  --role-name $ROLE_NAME

# 3. Simulate the failed action
aws iam simulate-principal-policy --profile acme-dev \
  --policy-source-arn arn:aws:iam::123456789012:role/$ROLE_NAME \
  --action-names THE_FAILED_ACTION \
  --resource-arns THE_RESOURCE_ARN
```

### Implicit Deny vs Explicit Deny

```bash
# Check for explicit denies
aws iam simulate-principal-policy --profile acme-dev \
  --policy-source-arn arn:aws:iam::123456789012:role/acme-lambda-execution-role \
  --action-names s3:DeleteBucket \
  --resource-arns "arn:aws:s3:::acme-data-dev" \
  --query "EvaluationResults[*].[EvalActionName,EvalDecision,MatchedStatements]"
```

### Check CloudTrail for Denied Actions

```bash
aws cloudtrail lookup-events --profile acme-dev \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRole \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --query "Events[?contains(CloudTrailEvent, 'AccessDenied')]"
```
