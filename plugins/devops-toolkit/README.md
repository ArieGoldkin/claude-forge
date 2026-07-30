# dtk — DevOps Toolkit (Claude Code Plugin)

[![CI](https://github.com/ArieGoldkin/claude-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/ArieGoldkin/claude-forge/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

> **Formerly named `devops-toolkit`.** Renamed to `dtk` in v2.0.0 to shorten slash-command prefixes (e.g. `/devops-toolkit:aws-cli-toolkit` → `/dtk:aws-cli-toolkit`). The source directory remains `plugins/devops-toolkit/` for repo readability. Existing installations must uninstall `devops-toolkit@claude-forge` and reinstall as `dtk@claude-forge`.

Claude Code plugin for DevOps, infrastructure, and backend development. Provides 15 specialized skills, 2 agents, 12 commands, and 1 hook (repo-access-guard) for secure, efficient development workflows.

## Installation

### Prerequisites

- **Claude Code CLI** - [Install Claude Code](https://code.claude.com/docs/en/getting-started)

### Install via Marketplace

```bash
# Add the marketplace
/plugin marketplace add https://github.com/ArieGoldkin/claude-forge.git

# Install the plugin (new name: dtk)
/plugin install dtk@claude-forge
```

### Install via git-subdir (Direct Install)

Install directly from the monorepo without adding a marketplace:

```bash
/plugin install --source git-subdir \
  --url https://github.com/ArieGoldkin/claude-forge.git \
  --path plugins/devops-toolkit
```

### Install via Git Clone (Development)

```bash
# Clone the monorepo
git clone git@github.com:ArieGoldkin/claude-forge.git

# Use with Claude Code
claude --plugin-dir ./claude-forge/plugins/devops-toolkit
```

> **Tip**: Use `/reload-plugins` to hot-reload plugin changes without restarting Claude Code.

### Project-Level Auto-Installation

Add to your project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "claude-forge": {
      "source": {
        "source": "url",
        "url": "https://github.com/ArieGoldkin/claude-forge.git"
      }
    }
  },
  "enabledPlugins": {
    "dtk@claude-forge": true
  }
}
```

## Features

### Skills (15)

Domain-specific knowledge and patterns for DevOps and backend development:

#### DevOps Core (9)
| Skill | Description |
|-------|-------------|
| `devops-deployment` | CI/CD pipelines, containerization, Kubernetes, infrastructure as code |
| `terraform-aws-modules` | Generic AWS Terraform module patterns, multi-env tfvars |
| `terraform-aws-lambda-containers` | Container-native Lambda deployments with ECR, VPC support |
| `aws-cli-toolkit` | AWS CLI for Lambda, CloudWatch, Secrets Manager, S3, RDS, IAM |
| `aws-networking` | VPC, Transit Gateway, PrivateLink, Route 53, network architecture |
| `aws-cost-optimization` | FinOps practices, Savings Plans, cost management with Terraform |
| `databricks-aws` | Databricks workspace and Unity Catalog setup on AWS with Terraform |
| `observability-monitoring` | Structured logging, metrics, distributed tracing, alerting |
| `terraform-gitlab-ci` | GitLab CI/CD pipelines for Terraform with OIDC authentication |

#### Cross-Cutting (1)
| Skill | Description |
|-------|-------------|
| `performance-optimization` | Full-stack performance analysis, optimization patterns |

#### Python/Backend (3)
| Skill | Description |
|-------|-------------|
| `postgresql-master` | Database queries, schema design, migrations, performance optimization |
| `api-design-framework` | REST, GraphQL, gRPC API patterns, versioning |
| `database-schema-designer` | Normalization, indexing, schema migration patterns |

#### Integration & Tooling (2)
| Skill | Description |
|-------|-------------|
| `salesforce-integration-patterns` | Salesforce CRM sync, case management, webhooks, bulk operations, SOQL |
| `setup-pre-commit` | Husky pre-commit hook setup for lint, format, and test gates |

> `security-checklist`, `coding-standards`, `testing-strategy-builder`, `code-review-playbook`
> and `ascii-visualizer` are **not** dtk skills — they ship in etk and ftk. They were listed
> here in error until 2026-07-30; install those plugins to get them.

### Agents (2)

Specialized AI agents for DevOps and backend development:

| Agent | Specialization |
|-------|----------------|
| `devops-architect` | Python Lambda, PostgreSQL, REST API, AWS serverless |
| `quality-reviewer` | Code review, security, performance, best practices |

> `web-research-analyst` is a **ctk** agent, not a dtk one; it was listed here in error.

### Commands (12)

Slash commands for common workflows:

#### Skill Commands (11)
| Command | Description |
|---------|-------------|
| `/aws-cli-toolkit` | AWS CLI operations guide |
| `/aws-cost-optimization` | Cost optimization analysis |
| `/aws-networking` | Network architecture planning |
| `/databricks-aws` | Databricks setup guide |
| `/devops-deployment` | Deployment pipeline setup |
| `/observability-monitoring` | Monitoring setup guide |
| `/terraform-gitlab-ci` | Terraform CI/CD pipeline |
| `/terraform-aws-lambda-containers` | Lambda container deployment |
| `/terraform-aws-modules` | Terraform module patterns |
| `/performance-optimization` | Performance analysis |
| `/salesforce-integration-patterns` | Salesforce sync, cases, webhooks, SOQL |

> `/security-checklist` and `/coding-standards` are **etk** commands, not dtk ones;
> they were listed here in error until 2026-07-30.

#### Setup (1)
| Command | Description |
|---------|-------------|
| `/setup-repo-access-guard` | Configure repository access restrictions |

> **Note**: Session continuity commands (`/save-state`, `/create-handoff`, `/resume-session`, `/setup-context-monitor`) are provided by the **ctk** plugin.

### Hooks

Security and continuity hooks that fire automatically:

| Hook | Trigger | Purpose |
|------|---------|---------|
| `SessionStart` | Session begins | Load continuity context, detect stale sessions |
| `PreCompact` | Before context compact | Preserve state timestamp in ledger |
| `PreToolUse` | Before Bash/Write/Edit | Security validation, block dangerous operations |
| `PostToolUse` | After Write/Edit | Track file edits for dirty flag |
| `UserPromptSubmit` | Before prompt | Context window usage monitoring |

#### Security Protections

The `PreToolUse` security hook blocks:
- Environment file modifications (`.env`, `.envrc`)
- Git internals (`.git/`, `.gitconfig`)
- SSH keys and certificates
- System directories (`/etc`, `/usr`, `/var`, `/sys`, `/proc`, `/boot`)
- Credential files (`.aws/credentials`, `.npmrc`, etc.)
- Dangerous bash commands (`rm -rf /`, `dd`, `mkfs`, etc.)
- Path traversal attempts (`../`)

## Directory Structure

```
devops-toolkit/
├── .claude-plugin/
│   ├── plugin.json          # Plugin manifest
│   └── marketplace.json     # Marketplace catalog
├── skills/                  # 15 skill directories
│   ├── devops-deployment/
│   ├── terraform-aws-modules/
│   ├── postgresql-master/
│   └── ... (12 more)
├── agents/                  # 2 agent definitions
│   ├── devops-architect.md
│   └── quality-reviewer.md
├── commands/                # 12 slash commands
│   ├── devops-deployment.md
│   └── ... (11 more)
├── hooks/                   # TypeScript hook system
│   ├── hooks.json
│   ├── src/
│   └── dist/
├── instructions/            # Agent instruction files
├── README.md
├── CHANGELOG.md
└── .gitignore
```

## Usage Examples

### Using Skills

Skills are automatically invoked when tasks match their domain:

```bash
# Terraform skill activates for infrastructure work
> Create a Terraform module for a VPC with public and private subnets

# AWS CLI skill activates for operations
> Show me the Lambda function logs for the last hour

# Database skill activates for schema design
> Design a migration to add a user_preferences table
```

### Using Commands

```bash
# Run security checklist
/security-checklist

# Set up repository access guard
/setup-repo-access-guard
```

### Using Agents

Agents are invoked via the Task tool when complex domain work is needed:

```
[Claude selects devops-architect for Lambda API work]
[Claude selects quality-reviewer for code review tasks]
```

## Requirements

- Claude Code CLI v1.0+
- Git (for repository access)
- Node.js 18+ (for hook system)

## Contributing

Contributions welcome — open an issue or pull request.

## License

MIT — see [LICENSE](../../LICENSE).

---

**Version**: 2.0.12
**Maintained by**: Arie Goldkin
