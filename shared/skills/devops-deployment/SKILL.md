---
name: devops-deployment
description: |
  CI/CD pipelines, containerization, Kubernetes, and infrastructure as code patterns for
  platform deployments. Use when setting up GitLab CI pipelines, configuring
  Docker multi-stage builds, deploying to Kubernetes or ECS, implementing GitOps with ArgoCD,
  or managing Terraform/CloudFormation infrastructure. Covers deployment strategies
  (blue-green, canary, rolling), container security scanning with Trivy, secrets management,
  and release automation. Handles AWS Lambda deployments, EKS cluster configuration, and
  pipeline optimization.
paths:
  - "**/*deploy*"
  - "Dockerfile*"
  - "docker-compose*"
  - ".gitlab-ci.yml"
  - "k8s/**"
---

# DevOps & Deployment Skill

Comprehensive frameworks for CI/CD pipelines, containerization, deployment strategies, and infrastructure automation.

## When to Use

- Setting up CI/CD pipelines
- Containerizing applications
- Deploying to Kubernetes or cloud platforms
- Implementing GitOps workflows
- Managing infrastructure as code
- Planning release strategies

## Pipeline Architecture

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│    Code     │──▶│    Build    │──▶│    Test     │──▶│   Deploy    │
│   Commit    │   │   & Lint    │   │   & Scan    │   │  & Release  │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
       │                 │                 │                 │
       ▼                 ▼                 ▼                 ▼
   Triggers         Artifacts          Reports          Monitoring
```

## Key Concepts

### CI/CD Pipeline Stages

1. **Lint & Type Check** - Code quality gates
2. **Unit Tests** - Test coverage with reporting
3. **Security Scan** - npm audit + Trivy vulnerability scanner
4. **Build & Push** - Docker image to container registry
5. **Deploy Staging** - Environment-gated deployment
6. **Deploy Production** - Manual approval or automated

> See `${CLAUDE_SKILL_DIR}/templates/gitlab-ci.yml` for complete GitLab CI pipeline

### Container Best Practices

**Multi-stage builds** minimize image size:
- Stage 1: Install production dependencies only
- Stage 2: Build application with dev dependencies
- Stage 3: Production runtime with minimal footprint

**Security hardening**:
- Non-root user (uid 1001)
- Read-only filesystem where possible
- Health checks for orchestrator integration

> See `${CLAUDE_SKILL_DIR}/templates/Dockerfile` and `${CLAUDE_SKILL_DIR}/templates/docker-compose.yml`

### Kubernetes Deployment

**Essential manifests**:
- Deployment with rolling update strategy
- Service for internal routing
- Ingress for external access with TLS
- HorizontalPodAutoscaler for scaling

**Security context**:
- `runAsNonRoot: true`
- `allowPrivilegeEscalation: false`
- `readOnlyRootFilesystem: true`
- Drop all capabilities

**Resource management**:
- Always set requests and limits
- Use `requests` for scheduling, `limits` for throttling

> See `${CLAUDE_SKILL_DIR}/templates/k8s-manifests.yaml` and `${CLAUDE_SKILL_DIR}/templates/helm-values.yaml`

### Deployment Strategies

| Strategy | Use Case | Risk |
|----------|----------|------|
| **Rolling** | Default, gradual replacement | Low - automatic rollback |
| **Blue-Green** | Instant switch, easy rollback | Medium - double resources |
| **Canary** | Progressive traffic shift | Low - gradual exposure |

**Rolling Update** (Kubernetes default):
```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 25%
    maxUnavailable: 0  # Zero downtime
```

**Blue-Green**: Deploy to standby environment, switch service selector
**Canary**: Use Istio VirtualService for traffic splitting (10% → 50% → 100%)

### Infrastructure as Code

**Terraform patterns**:
- Remote state in S3 with DynamoDB locking
- Module-based architecture (VPC, EKS, RDS)
- Environment-specific tfvars files

> See `${CLAUDE_SKILL_DIR}/templates/terraform-aws.tf` for AWS VPC + EKS + RDS example

### GitOps with ArgoCD

ArgoCD watches Git repository and syncs cluster state:
- Automated sync with pruning
- Self-healing (drift detection)
- Retry policies for transient failures

> See `${CLAUDE_SKILL_DIR}/templates/argocd-application.yaml`

### Secrets Management

Use External Secrets Operator to sync from cloud providers:
- AWS Secrets Manager
- HashiCorp Vault
- Azure Key Vault
- GCP Secret Manager

> See `${CLAUDE_SKILL_DIR}/templates/external-secrets.yaml`

## Claude Code Plugin Installation in CI/Docker

When running Claude Code in CI pipelines or Docker containers, use `CLAUDE_CODE_PLUGIN_SEED_DIR` to pre-install plugins without interactive prompts.

**Single plugin directory:**
```bash
CLAUDE_CODE_PLUGIN_SEED_DIR="/opt/claude-forge/my-plugin"
```

**Multiple plugin directories** (v2.1.79+, colon-separated on Unix):
```bash
CLAUDE_CODE_PLUGIN_SEED_DIR="/opt/plugins/ctk:/opt/plugins/dtk:/opt/plugins/wtk"
```

**Dockerfile example:**
```dockerfile
# Copy plugin sources into the image
COPY plugins/continuity-toolkit /opt/claude-forge/continuity-toolkit
COPY plugins/devops-toolkit /opt/claude-forge/devops-toolkit

# Set seed dir so plugins are available without install
ENV CLAUDE_CODE_PLUGIN_SEED_DIR="/opt/claude-forge/ctk:/opt/claude-forge/devops-toolkit"
```

**GitLab CI example:**
```yaml
claude-code-task:
  image: node:22-alpine
  variables:
    CLAUDE_CODE_PLUGIN_SEED_DIR: "${CI_PROJECT_DIR}/plugins/ctk:${CI_PROJECT_DIR}/plugins/devops-toolkit"
  script:
    - npx @anthropic-ai/claude-code --print "run the tests"
```

> Note: `--plugin-dir` accepts one path per flag (use repeated flags for multiple). `PLUGIN_SEED_DIR` is simpler for multiple plugins.

## Deployment Checklist

### Pre-Deployment
- [ ] All tests passing in CI
- [ ] Security scans clean
- [ ] Database migrations ready
- [ ] Rollback plan documented

### During Deployment
- [ ] Monitor deployment progress
- [ ] Watch error rates
- [ ] Verify health checks passing

### Post-Deployment
- [ ] Verify metrics normal
- [ ] Check logs for errors
- [ ] Update status page

## Helm Chart Structure

```
charts/app/
├── Chart.yaml
├── values.yaml
├── templates/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── hpa.yaml
│   └── _helpers.tpl
└── values/
    ├── staging.yaml
    └── production.yaml
```

## Extended Thinking Triggers

Use Opus 4.5 extended thinking for:
- **Architecture decisions** - Kubernetes vs serverless, multi-region setup
- **Migration planning** - Moving between cloud providers
- **Incident response** - Complex deployment failures
- **Security design** - Zero-trust architecture

## Templates Reference

| Template | Purpose |
|----------|---------|
| `gitlab-ci.yml` | Full CI/CD pipeline with 6 stages |
| `Dockerfile` | Multi-stage Node.js build |
| `docker-compose.yml` | Development environment |
| `k8s-manifests.yaml` | Deployment, Service, Ingress |
| `helm-values.yaml` | Helm chart values |
| `terraform-aws.tf` | VPC, EKS, RDS infrastructure |
| `argocd-application.yaml` | GitOps application |
| `external-secrets.yaml` | Secrets Manager integration |
