---
name: terraform-gitlab-ci
description: |
  GitLab CI/CD patterns for Terraform with AWS OIDC authentication. Use when setting up
  Terraform pipelines in GitLab, configuring HTTP backend for state storage, implementing
  OIDC-based AWS authentication (no static credentials), or managing multi-environment
  deployments. Covers pipeline stages (init, validate, plan, apply), resource groups for
  state locking, mise tool versioning, environment-specific jobs, manual approval gates,
  and MR-based plan previews. Includes templates for backend configuration and IAM roles.
paths:
  - ".gitlab-ci.yml"
  - "terraform/**"
  - "*.tf"
  - "**/*pipeline*"
---

# Terraform GitLab CI Skill

GitLab CI/CD pipeline patterns for Terraform deployments with AWS OIDC authentication.

## When to Use

- Setting up Terraform pipelines in GitLab
- Configuring GitLab HTTP backend for Terraform state
- Implementing OIDC authentication to AWS (no static credentials)
- Managing multi-environment Terraform deployments
- Creating plan preview jobs for merge requests

## Pipeline Architecture

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   Validate  │──▶│    Plan     │──▶│   Manual    │──▶│   Apply     │
│   & Init    │   │  (Saved)    │   │  Approval   │   │  Changes    │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
       │                 │                                    │
       ▼                 ▼                                    ▼
   terraform         plan.tfplan                         State Updated
   validate          (artifact)                          in Backend
```

## Key Concepts

### GitLab HTTP Backend

GitLab provides a built-in HTTP backend for Terraform state storage:

```hcl
terraform {
  backend "http" {
    address        = "https://gitlab.com/api/v4/projects/${PROJECT_ID}/terraform/state/${ENV}"
    lock_address   = "https://gitlab.com/api/v4/projects/${PROJECT_ID}/terraform/state/${ENV}/lock"
    unlock_address = "https://gitlab.com/api/v4/projects/${PROJECT_ID}/terraform/state/${ENV}/lock"
    lock_method    = "POST"
    unlock_method  = "DELETE"
    retry_wait_min = 5
  }
}
```

**Benefits**:
- No separate S3 bucket/DynamoDB required
- Built-in locking via lock addresses
- State versioning in GitLab
- Access controlled by GitLab permissions

> See `${CLAUDE_SKILL_DIR}/templates/backend-gitlab.tf` for complete configuration

### OIDC Authentication to AWS

GitLab CI can authenticate to AWS using OIDC tokens - no static credentials needed:

```yaml
assume role web identity:
  id_tokens:
    GITLAB_OIDC_TOKEN:
      aud: https://gitlab.com
  script:
    - >
      STS=$(aws sts assume-role-with-web-identity
        --role-arn $AWS_ROLE_ARN
        --role-session-name "gitlab-ci-${CI_PIPELINE_ID}"
        --web-identity-token $GITLAB_OIDC_TOKEN
        --duration-seconds 3600)
```

**AWS IAM Trust Policy**:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "arn:aws:iam::ACCOUNT:oidc-provider/gitlab.com"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {"gitlab.com:aud": "https://gitlab.com"},
      "StringLike": {"gitlab.com:sub": "project_path:myorg/myrepo:*"}
    }
  }]
}
```

> See `${CLAUDE_SKILL_DIR}/templates/oidc-role.tf` for IAM role Terraform configuration

### Pipeline Stages

```yaml
stages:
  - validate    # fmt, validate, tflint
  - plan        # generate execution plan
  - apply       # apply changes (manual trigger)
  - destroy     # teardown (manual, protected)
```

**Stage Details**:

| Stage | Tools | Artifacts | Trigger |
|-------|-------|-----------|---------|
| validate | `terraform fmt -check`, `terraform validate`, `tflint` | None | Automatic |
| plan | `terraform plan -out=plan.tfplan` | `plan.tfplan`, `plan.txt` | Automatic |
| apply | `terraform apply plan.tfplan` | None | Manual |
| destroy | `terraform destroy -auto-approve` | None | Manual (protected) |

> See `${CLAUDE_SKILL_DIR}/references/pipeline-stages.md` for detailed stage configuration

### Resource Groups for State Locking

GitLab resource groups prevent concurrent Terraform operations:

```yaml
plan:
  resource_group: terraform-${TF_ENV}

apply:
  resource_group: terraform-${TF_ENV}
```

This ensures only one job can modify state for an environment at a time.

### Multi-Environment Strategy

Use GitLab CI rules to deploy to different environments:

```yaml
.terraform:plan:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      variables:
        TF_ENV: dev
    - if: $CI_COMMIT_BRANCH == "main"
      variables:
        TF_ENV: staging
    - if: $CI_COMMIT_TAG
      variables:
        TF_ENV: production
```

**Environment structure**:
```
terraform/
├── main.tf
├── variables.tf
├── outputs.tf
└── vars/
    ├── dev.tfvars
    ├── staging.tfvars
    └── production.tfvars
```

### Tool Versioning with Mise

Pin Terraform version in `.mise.toml`:

```toml
[tools]
terraform = "1.9.0"
tflint = "0.50.0"
```

Pipeline installs tools:
```yaml
before_script:
  - mise install
  - eval "$(mise activate bash)"
```

## Quick Start

### 1. Configure Backend

Create `backend.tf`:
```hcl
terraform {
  backend "http" {}  # Configured via CI variables
}
```

### 2. Set CI Variables

In GitLab project settings → CI/CD → Variables:

| Variable | Value | Protected |
|----------|-------|-----------|
| `AWS_ROLE_ARN` | `arn:aws:iam::123456789:role/gitlab-terraform` | Yes |
| `TF_HTTP_ADDRESS` | GitLab state URL | No |
| `TF_HTTP_LOCK_ADDRESS` | GitLab lock URL | No |
| `TF_HTTP_UNLOCK_ADDRESS` | GitLab unlock URL | No |
| `TF_HTTP_USERNAME` | `gitlab-ci-token` | No |
| `TF_HTTP_PASSWORD` | `$CI_JOB_TOKEN` | No |

### 3. Add Pipeline

Copy `${CLAUDE_SKILL_DIR}/templates/gitlab-ci-terraform.yml` to `.gitlab-ci.yml`.

### 4. Create AWS OIDC Role

Apply `${CLAUDE_SKILL_DIR}/templates/oidc-role.tf` to create the IAM role.

## Common Patterns

### MR Plan Preview

Show plan output in merge request:

```yaml
plan:
  script:
    - terraform plan -out=plan.tfplan | tee plan.txt
  artifacts:
    paths:
      - plan.tfplan
      - plan.txt
    reports:
      terraform: plan.json
```

GitLab displays the Terraform plan report in the MR widget.

### Environment-Specific Variables

```yaml
variables:
  TF_VAR_environment: $TF_ENV
  TF_VAR_project_name: $CI_PROJECT_NAME
```

### Selective Apply Rules

```yaml
apply:staging:
  extends: .terraform:apply
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: manual
  environment:
    name: staging
    url: https://staging.example.com

apply:production:
  extends: .terraform:apply
  rules:
    - if: $CI_COMMIT_TAG
      when: manual
  environment:
    name: production
    url: https://example.com
```

### Destroy Protection

```yaml
destroy:
  extends: .terraform:base
  stage: destroy
  script:
    - terraform destroy -auto-approve
  rules:
    - if: $DESTROY_CONFIRMED == "yes"
      when: manual
  allow_failure: false
```

## Security Best Practices

1. **No static credentials** - Use OIDC for AWS authentication
2. **Protected variables** - Mark sensitive vars as protected
3. **Resource groups** - Prevent concurrent state modifications
4. **Manual apply** - Require human approval for production
5. **Destroy protection** - Require explicit variable to enable destroy

## Troubleshooting

### State Lock Timeout

```
Error: Error acquiring the state lock
```

**Solution**: Check if another pipeline is running. Use `terraform force-unlock` only as last resort.

### OIDC Token Issues

```
Error: Not authorized to perform sts:AssumeRoleWithWebIdentity
```

**Verify**:
- IAM role trust policy has correct GitLab OIDC provider
- Subject condition matches your project path
- Audience is set to `https://gitlab.com`

### Backend Authentication

```
Error: Failed to request discovery document
```

**Check**:
- `TF_HTTP_USERNAME` is `gitlab-ci-token`
- `TF_HTTP_PASSWORD` is `$CI_JOB_TOKEN` (not quoted)
- Project CI/CD settings allow job token access

## Templates Reference

| Template | Purpose |
|----------|---------|
| `gitlab-ci-terraform.yml` | Complete CI/CD pipeline |
| `backend-gitlab.tf` | HTTP backend configuration |
| `oidc-role.tf` | AWS IAM role for OIDC |

## References

- `${CLAUDE_SKILL_DIR}/references/pipeline-stages.md` - Detailed stage configuration
