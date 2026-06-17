---
name: tool-wrapper-patterns
description: Patterns for CLI tool wrapper skills — auto-context, setup verification, output budgeting, error enrichment. Triggers on tool wrapper, CLI wrapper skill, wrapper pattern, auto-context, setup verification, output budgeting
effort: low
paths:
  - "**/skills/**"
  - "**/*skill*"
  - "**/*wrapper*"
keep-coding-instructions: true
---

# Tool Wrapper Patterns

## Overview

A reference guide for writing skills that wrap external CLI tools effectively. Based on patterns proven by debug-skill (DAP debugger wrapper) and applicable to any CLI integration.

The core insight: an LLM agent interacting with a CLI tool has different needs than a human. Humans scan output visually and issue follow-up commands instinctively. An agent pays per-token for output and per-turn for follow-ups. Design your wrapper to minimize both.

---

## The 6 Principles of Effective Tool Wrapping

### 1. Auto-Context (Single-Command Full State)

Every CLI invocation should capture and return the FULL relevant context in one shot. Don't make the agent issue follow-up queries.

**Why it matters**: Each follow-up command costs a full agent turn (tool call overhead, context window growth, latency). A wrapper that returns complete state in one shot can save 3-5 turns per interaction.

**Examples**:

- **Database query skill**: Return results + query plan + row count + execution time, not just results
- **Terraform skill**: Return plan output + resource count + drift warnings, not just the plan
- **Debug skill**: Return current frame + local variables + watch expressions + breakpoint status, not just the stopped location

**Pattern**:

```bash
# Bad: Agent needs 4 commands to understand state
tool status
tool list-resources
tool show-errors
tool get-config

# Good: Single command returns combined context
tool status --json | jq '{
  status: .status,
  resources: (.resources | length),
  errors: .errors[:5],
  config: {region: .config.region, profile: .config.profile}
}'
```

### 2. Setup Verification

Always check if the tool is installed and configured before attempting to use it.

**Checklist**:

- Check binary exists: `which tool-name`
- Check version compatibility if needed: `tool-name --version`
- Check required configuration (config files, env vars, credentials)
- Provide clear install instructions on failure
- Graceful degradation: offer alternative approaches if tool unavailable

**Pattern**:

```bash
# Verify prerequisites before any operation
if ! command -v terraform &> /dev/null; then
  echo "ERROR: terraform not found"
  echo "Install: https://developer.hashicorp.com/terraform/install"
  echo "Alternative: review .tf files manually without plan execution"
  exit 1
fi

TERRAFORM_VERSION=$(terraform version -json | jq -r '.terraform_version')
REQUIRED_VERSION="1.5.0"
if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$TERRAFORM_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
  echo "WARNING: terraform $TERRAFORM_VERSION found, >= $REQUIRED_VERSION recommended"
fi
```

### 3. Output Budgeting for LLM Consumption

External tools produce output designed for humans. Truncate and filter for LLM token economics.

**Budget guidelines**:

| Output Type | Budget | Rationale |
|-------------|--------|-----------|
| String values (paths, messages) | 200-500 chars | Preserve meaning, cut repetition |
| List/collection previews | 5-10 items | Enough to show pattern, agent can request more |
| Stack traces | 20 frames max | Top frames have the signal |
| Command stdout | 200 lines | Beyond this, filter or summarize |
| JSON responses | 50 keys at top level | Flatten or pick relevant subtrees |

**Noise to strip**:

- ANSI color codes: `sed 's/\x1b\[[0-9;]*m//g'`
- Progress bars and spinner output
- Debug/trace prefixes (e.g., `DEBUG:`, `TRACE:`)
- Repeated blank lines
- Build tool banners and version headers

**Pattern**:

```bash
# Bad: raw terraform plan (can be 1000+ lines)
terraform plan

# Good: filtered and budgeted
terraform plan -no-color 2>&1 | head -200 | grep -E '^\s*(#|Plan:|Changes|Error)'
echo "---"
terraform plan -no-color 2>&1 | tail -5  # summary line
```

### 4. Structured Methodology

Don't just list commands -- teach a workflow. The agent should follow a repeatable loop:

1. **OBSERVE**: What's the current state?
   - Run diagnostic/status commands
   - Capture baseline before making changes
2. **PLAN**: What specific outcome do we want?
   - State the goal explicitly
   - Identify the minimum commands needed
3. **ACT**: Execute the minimum necessary command
   - One change at a time
   - Capture full output (stdout + stderr + exit code)
4. **VERIFY**: Did we get the expected result?
   - Run the same diagnostic from step 1
   - Diff against baseline
   - Confirm no unintended side effects

**Why this matters for agents**: Without structure, agents tend to run commands speculatively and lose track of what changed. The OBSERVE-PLAN-ACT-VERIFY loop keeps the agent grounded and prevents cascading mistakes.

### 5. Error Context Enrichment

When a CLI command fails, capture everything the agent needs to diagnose the issue without additional commands:

- **Exit code** + **stderr** + **stdout** (all three -- some tools report errors on stdout)
- **The exact command** that was run (with arguments, after variable expansion)
- **Environment context**: cwd, relevant env vars, tool version
- **Last known good state** if applicable (e.g., last successful deployment, last passing test)

**Pattern**:

```bash
# Capture full error context
COMMAND="terraform apply -auto-approve"
OUTPUT=$($COMMAND 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "FAILED: $COMMAND"
  echo "Exit code: $EXIT_CODE"
  echo "Working directory: $(pwd)"
  echo "Terraform version: $(terraform version -json | jq -r '.terraform_version')"
  echo "AWS region: ${AWS_REGION:-not set}"
  echo "Output (last 50 lines):"
  echo "$OUTPUT" | tail -50
fi
```

### 6. Stateful Session Awareness

Some tools need persistent state across agent turns. Know which pattern your tool needs:

**Stateless tools** (grep, curl, jq):
- No session needed, each invocation is independent
- Simplest to wrap -- just format input/output

**Session tools** (psql, debuggers, REPLs):
- Need a daemon/socket pattern or session files
- Consider: can you serialize state to a file between turns?
- Consider: can you use a long-running background process?
- The debug-skill DAP pattern: maintain a socket connection, serialize breakpoints/state

**Cached tools** (terraform, docker, npm):
- Work without state but benefit from awareness of cached state
- Check for stale state: `terraform plan` after `git pull`
- Warn about cache invalidation: "Docker image was rebuilt, previous container references are stale"

---

## Template: SKILL.md for a Tool Wrapper

Use this as a starting point when creating a new skill that wraps a CLI tool. Replace bracketed placeholders with your tool's specifics.

````markdown
---
name: [tool-name]-integration
description: [When to use this skill. What CLI tool it wraps. What workflows it enables.]
version: 1.0.0
tags: [tool-name, relevant-domain-tags]
---

# [Tool Name] Integration

## Prerequisites

- [ ] `[tool]` installed (`which [tool]` or `command -v [tool]`)
- [ ] Version >= X.Y (`[tool] --version`)
- [ ] [Any required configuration, credentials, or environment variables]

## Quick Reference

| Command | Purpose | Auto-Context Returned |
|---------|---------|----------------------|
| `tool cmd1 --flags` | [Description] | Returns: X, Y, Z |
| `tool cmd2 --flags` | [Description] | Returns: A, B, C |
| `tool status` | Full state snapshot | Returns: [all relevant state] |

## Workflow

### 1. Setup

Verify the tool is available and configured:

```bash
command -v [tool] || echo "Install: [install-url]"
[tool] --version
[any config verification]
```

### 2. Observe

Gather current state before making changes:

```bash
[tool] status [--flags for full context]
```

### 3. Plan

Determine target state. State the goal explicitly before executing commands.

### 4. Execute

Run commands one at a time, capturing full output:

```bash
OUTPUT=$([tool] [command] 2>&1)
echo "Exit: $?"
echo "$OUTPUT" | head -200
```

### 5. Verify

Confirm the expected outcome:

```bash
[tool] status  # Compare against step 2 baseline
```

## Output Handling

- Truncate [specific field] to [N] characters
- Filter out [noise patterns specific to this tool]
- Always capture exit code alongside output
- Strip ANSI codes when passing output to the agent

## Common Failure Modes

| Error | Cause | Resolution |
|-------|-------|------------|
| [common error 1] | [why it happens] | [how to fix] |
| [common error 2] | [why it happens] | [how to fix] |
````

---

## Applicable Tools in Our Ecosystem

| Skill | Tool | Plugin | Auto-Context Opportunity |
|-------|------|--------|--------------------------|
| aws-cli-toolkit | AWS CLI | dtk | Region + account + output in one shot |
| terraform-aws-modules | Terraform | dtk | Plan + state + drift together |
| postgresql-master | psql | dtk | Results + plan + stats together |
| agent-browser | Browser CLI | ftk | Screenshot + DOM + console together |

When wrapping any of these tools, apply all 6 principles. The biggest wins typically come from **auto-context** (eliminating follow-up turns) and **output budgeting** (keeping token costs manageable).
