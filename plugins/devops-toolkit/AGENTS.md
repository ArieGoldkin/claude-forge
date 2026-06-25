# AGENTS.md

<!-- dtk:start -->
## DevOps Toolkit (v1.0.0)

IMPORTANT: Explore the project first, then check workflow triggers below.
IMPORTANT: Invoke skills with `/dtk:<skill-name>` for full implementation details.
IMPORTANT: All infrastructure changes must follow security boundaries at bottom of this file.

### Workflow Triggers

| Workflow | Keywords | Agent/Skill Chain |
|----------|----------|-------------------|
| **DEPLOY** | deploy, release, pipeline, ci/cd, container | devops-deployment → terraform-gitlab-ci → quality-reviewer |
| **INFRA** | terraform, module, vpc, lambda, aws, networking | terraform-aws-modules → aws-networking → devops-architect |
| **DEBUG** | fix, error, bug, logs, crash, incident | aws-cli-toolkit (logs) → observability-monitoring → devops-architect |
| **REVIEW** | review, audit, check, analyze, lint | quality-reviewer → security-checklist → coding-standards |
| **SECURITY** | security, secrets, iam, owasp, vulnerability | security-checklist → aws-cli-toolkit (IAM) → quality-reviewer |
| **DATABASE** | database, schema, migration, query, postgresql | postgresql-master → database-schema-designer → devops-architect |
| **OPTIMIZE** | performance, cost, slow, expensive, optimize | performance-optimization → aws-cost-optimization → observability-monitoring |

**Conflict Resolution**: SECURITY > DEBUG > REVIEW > DEPLOY > INFRA > DATABASE > OPTIMIZE

### Quick Reference

#### Terraform (AWS Modules)
```hcl
# Standard naming in locals.tf
locals {
  name_prefix = "${var.project}-${var.environment}"
  common_tags = { Project = var.project, Environment = var.environment, ManagedBy = "terraform" }
}
```
**Structure**: `terraform/{main,variables,outputs,versions,backend,locals}.tf` + `modules/` + `envs/{dev,staging,prod}.tfvars`
**Deep dive**: `/dtk:terraform-aws-modules`

#### PostgreSQL
```python
from utils.database.db_utils import get_db_engine, get_session
engine = get_db_engine(db_secret="arn:aws:secretsmanager:...")
with get_session(engine) as session:
    session.execute(text("SELECT * FROM users WHERE id = :id"), {"id": user_id})
```
**ORM**: SQLAlchemy 2.0 + Alembic migrations. Always use parameterized queries.
**Deep dive**: `/dtk:postgresql-master`

#### AWS CLI
```bash
# Lambda logs (last 30 min)
aws logs tail /aws/lambda/<project>-<env>-<function> --since 30m --follow --profile dev
# Deploy Lambda
aws lambda update-function-code --function-name <name> --image-uri <ecr-uri> --profile dev
```
**Auth**: AWS SSO (`aws sso login --profile dev|prod`)
**Deep dive**: `/dtk:aws-cli-toolkit`

#### Security
```bash
npm audit          # JS dependency scan
pip-audit          # Python dependency scan
```
**Block deploy if**: Critical vulns > 0 OR High vulns > 5. Covers OWASP Top 10, GDPR, SOC2.
**Deep dive**: `/dtk:security-checklist`

#### Testing
```
Testing Trophy: Static Analysis → Unit (most) → Integration (many) → E2E (few)
```
**Targets**: >80% coverage. **Frameworks**: Jest/Vitest (TS), pytest (Python), Playwright (E2E).
**Deep dive**: `/dtk:testing-strategy-builder`

#### CI/CD Pipeline
```
Code Commit → Build & Lint → Test & Scan → Deploy & Release
```
**Strategies**: blue-green, canary, rolling. **Containers**: Docker multi-stage + Trivy scan.
**Deep dive**: `/dtk:devops-deployment`

#### Observability
```
Three Pillars: LOGS (what happened) | METRICS (how performing) | TRACES (request flow)
```
**Stack**: CloudWatch/Datadog, Prometheus/Grafana, OpenTelemetry, Sentry, PagerDuty.
**Deep dive**: `/dtk:observability-monitoring`

#### Coding Standards
| Metric | Limit | Enforcement |
|--------|-------|-------------|
| Function size | < 50 lines | Manual review |
| Complexity | < 10 | Manual review |
| Test coverage | > 80% | Manual review |
| Nesting depth | < 4 levels | Manual review |

**Naming**: TS `camelCase`/`PascalCase`, Python `snake_case`/`PascalCase`, constants `SCREAMING_SNAKE_CASE`
**Deep dive**: `/dtk:coding-standards`

### Boundaries

#### Always Do
- Use parameterized queries (never string interpolation in SQL)
- Run `npm audit` / `pip-audit` before deployments
- Use AWS SSO profiles (never hardcode credentials)
- Follow naming: `{project}-{environment}-{resource}`
- Include type hints on all Python function signatures
- Tag all AWS resources with Project, Environment, ManagedBy
- Use Terraform for all infrastructure (no manual console changes)

#### Ask First
- Database schema migrations (run checklist first)
- IAM policy changes (least privilege review)
- Production deployments
- New external dependencies
- Security group / networking changes
- Terraform state operations (import, mv, rm)

#### Never Do
- Commit secrets, credentials, or .env files
- Run `rm -rf /`, `dd`, `mkfs`, or destructive system commands
- Hardcode AWS credentials or access keys
- Skip security scan for deployments
- Modify Terraform state directly (use CLI commands)
- Deploy without passing quality gates

### Agents

| Agent | Role | Tools |
|-------|------|-------|
| **devops-architect** | Python Lambda, PostgreSQL, REST APIs | Read, Edit, Write, Bash, Grep, Glob |
| **quality-reviewer** | Code review, linting, test coverage | Read, Bash, Grep, Glob (read-only) |
| **web-research-analyst** | External docs, API discovery, best practices | WebFetch, WebSearch, Bash, Read, Write |

### Commands (16)

| Command | Purpose |
|---------|---------|
| `/dtk:terraform-aws-modules` | AWS Terraform module patterns |
| `/dtk:terraform-aws-lambda-containers` | Container Lambda deployments |
| `/dtk:terraform-gitlab-ci` | GitLab CI for Terraform |
| `/dtk:aws-cli-toolkit` | AWS CLI operations |
| `/dtk:aws-networking` | VPC, Transit Gateway patterns |
| `/dtk:aws-cost-optimization` | FinOps and cost management |
| `/dtk:postgresql-master` | Database operations |
| `/dtk:database-schema-designer` | Schema design |
| `/dtk:api-design-framework` | REST/GraphQL API design |
| `/dtk:devops-deployment` | CI/CD and deployment |
| `/dtk:observability-monitoring` | Logging, metrics, tracing |
| `/dtk:performance-optimization` | Performance analysis |
| `/dtk:security-checklist` | Security audit |
| `/dtk:coding-standards` | Code quality standards |
| `/dtk:testing-strategy-builder` | Test strategy |
| `/dtk:databricks-aws` | Databricks + Unity Catalog |

### Session Continuity

| Command | Purpose |
|---------|---------|
| `/dtk:save-state` | Snapshot current progress to ledger |
| `/dtk:create-handoff` | Create session handoff document |
| `/dtk:resume-session` | Load context from previous session |
<!-- dtk:end -->
