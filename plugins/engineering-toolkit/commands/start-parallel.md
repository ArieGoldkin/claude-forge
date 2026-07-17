---
description: Start parallel agent execution for distributed tasks. Use when launching multiple agents simultaneously.
---

# Start Parallel Agent Execution

**INTERACTION MODE: REQUIRED**

This command requires user interaction. You MUST wait for user input if no requirements are found.

Instructions for launching multiple agents to work simultaneously on allocated tasks.

## STEP 1: Check for Requirements

**FIRST ACTION:** Check if requirements were provided with this command.

**CRITICAL**: When searching for PRDs:
- **EXCLUDE** any files in `.squad/examples/` - These are example templates
- **EXCLUDE** any files in `.claude/` - These are agent templates
- **EXCLUDE** any files in `templates/` or `test/` - These are not real requirements
- If only example PRDs are found, treat as NO PRD FOUND

If NO requirements were provided:
- Proceed to Step 2 to gather requirements
- **DO NOT** skip to implementation
- **DO NOT** create any files until requirements are confirmed
- **DO NOT** use example PRDs as actual requirements

## Step 1: Discover or Gather Requirements

### Search for Existing Requirements

Search for any existing requirements or documentation:

```bash
# Search for PRD or requirements files (EXCLUDING examples and templates)
# IMPORTANT: Exclude .squad/examples/, .claude/, templates/, and test/ directories
find . -type f \( -name "*prd*.md" -o -name "*requirements*.md" -o -name "README.md" -o -name "TODO.md" -o -name "ROADMAP.md" \) \
    -not -path "*/node_modules/*" \
    -not -path "*/.git/*" \
    -not -path "*/.squad/examples/*" \
    -not -path "*/.claude/*" \
    -not -path "*/templates/*" \
    -not -path "*/test/*" \
    2>/dev/null

# Check README for features section (if not in excluded directories)
if [ -f "README.md" ]; then
    grep -i "features\|requirements\|user stories" README.md 2>/dev/null
fi

# Check for GitHub issues
if [ -d ".github/ISSUE_TEMPLATE" ]; then
    cat .github/ISSUE_TEMPLATE/*.md 2>/dev/null | head -50
fi
```

### If Requirements Found

Summarize what you found and confirm:

```markdown
📄 Found existing requirements in [filename]:
"[1-2 sentence summary of what the project is building]"

Is this what you're building? (Y/n):
```

**If YES:** Proceed to Step 1 with existing requirements
**If NO:** Ask for requirements (see below)

### If No Requirements Found (or user said NO)

**REQUIRED ACTIONS:**
1. **ASK** the user directly:
   "📋 **What would you like to build?**
   
   Please describe your requirements and I'll orchestrate multiple agents to build it in parallel."
   
2. **WAIT** for the user to type their response
3. **DO NOT** proceed until the user provides input
4. **DO NOT** create any files or start any work until requirements are received
5. Once user responds, proceed to Smart Inference

### Smart Inference from User Input

#### Examples of Inference

**Example 1 - Minimal Input:**
```
User: "user auth system"
Inferred:
- Frontend: login/register forms
- Backend: auth endpoints, JWT handling
- Database: user tables, sessions
→ 3 agents recommended
```

**Example 2 - Detailed Input:**
```
User: "Dashboard showing real-time metrics with charts, 
      export to CSV, and email alerts"
Inferred:
- Frontend: dashboard UI, charts, real-time updates
- Backend: metrics API, WebSocket server, export service
- Notifications: email service
→ 3-4 agents recommended
```

**Example 3 - Vague Input:**
```
User: "something like Twitter"
Inferred:
- Frontend: timeline, post creation
- Backend: posts API, user API
- Database: posts, users, follows
→ Start with 2 agents (conservative)
```

#### Inference Logic

```python
def infer_requirements(user_input):
    # Keywords to components mapping
    component_keywords = {
        'frontend': ['dashboard', 'UI', 'interface', 'form', 'page', 'screen'],
        'backend': ['API', 'endpoint', 'server', 'auth', 'database'],
        'realtime': ['websocket', 'real-time', 'live', 'updates'],
        'ml': ['ML', 'AI', 'predict', 'recommend', 'analyze'],
        'data': ['export', 'CSV', 'report', 'analytics']
    }
    
    # Extract components from keywords
    components = detect_components(user_input, component_keywords)
    
    # Generate concrete tasks
    tasks = []
    if 'frontend' in components:
        tasks.extend(['Create UI components', 'Style layouts', 'Handle state'])
    if 'backend' in components:
        tasks.extend(['Build API endpoints', 'Setup database', 'Handle auth'])
    if 'ml' in components:
        tasks.extend(['Train model', 'Create pipeline', 'API integration'])
    
    # Smart agent count
    if len(tasks) <= 3:
        agent_count = 1  # Sequential is fine
    elif len(components) <= 3 and no_complex_dependencies:
        agent_count = len(components)  # One agent per component
    else:
        agent_count = min(len(components), 5)  # Cap at 5 for manageability
    
    return {
        "description": user_input,
        "components": components,
        "tasks": tasks,
        "recommended_agents": agent_count
    }
```

### Confirmation Before Proceeding

Show the user what you understood:

```markdown
I'll build this with [N] parallel agents:
- Component 1: [what it does]
- Component 2: [what it does]
- Component 3: [what it does]

Ready to start? (Y/n):
```

## Prerequisites

Once requirements are confirmed:
1. Generate task allocation based on requirements
2. Create `.squad/parallel-plans/agent-*-plan.md` files
3. Initialize directories (`.squad/locks/`, `.squad/comms/`)
4. Ensure Git repository is in clean state

## Launch Instructions

### Step 1: Prepare Environment

Run this from the **coordinator** terminal, at the repo root.

```bash
# Shared coordination state (lives in the main checkout, visible to every worktree)
mkdir -p .squad/locks .squad/comms .squad/logs .squad/metrics

# Clear any stale locks
rm -f .squad/locks/*.lock

# Initialize communication files
for i in 1 2 3; do
  {
    echo "# Agent $i Communication Log"
    echo "Status: READY"
    echo "Initialized: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  } > ".squad/comms/agent-$i-comm.md"
done
```

### Step 2: Give Each Agent Its Own Worktree

**This is the isolation boundary — do not skip it.** Without it, every agent
shares one working tree and the `.squad/locks/` protocol is the *only* thing
standing between two agents and a corrupted file. Locks here are advisory:
nothing enforces them, so an agent that never checks simply overwrites. A git
worktree makes collision *structurally impossible* rather than merely
discouraged — each agent gets its own checkout and its own branch, and you
resolve conflicts once, at merge, where git is designed to handle them.

Run this in the **coordinator** terminal, from anywhere inside the repo:

```bash
# One worktree + branch per agent, as siblings of the main checkout.
# Derive from git, not from $(pwd) — this works from a subdirectory too.
MAIN="$(git rev-parse --show-toplevel)"
REPO="$(basename "$MAIN")"

git worktree add "$MAIN/../${REPO}-agent-1" -b parallel/agent-1
git worktree add "$MAIN/../${REPO}-agent-2" -b parallel/agent-2
git worktree add "$MAIN/../${REPO}-agent-3" -b parallel/agent-3

git worktree list   # verify: 1 main + 3 agent worktrees

# Print the exact lines to paste into each agent terminal (Step 3).
# Absolute paths — nothing here depends on a variable from this shell.
echo "MAIN=$MAIN"
```

ctk's `WorktreeCreate` hook fires on each, seeding continuity state in the new
worktree — so each agent starts with its own context rather than inheriting the
coordinator's.

> **`REPO` and `MAIN` live only in THIS shell.** Every agent terminal below
> re-derives them itself. Do not assume a variable set here is visible in
> another terminal — if it isn't, `cd "../${REPO}-agent-1"` silently becomes
> `cd ../-agent-1`, the `cd` fails, and the agent keeps working in the **shared
> checkout** — the exact collision this step exists to prevent.

**Teardown** — run this only after each agent branch has been merged (there is
no dedicated merge step; merge `parallel/agent-N` however your project
normally merges). `git worktree remove` requires
**git ≥ 2.17**; `rm -rf` + `prune` is the portable form that works everywhere,
including the 2.15 still shipped by some LTS distros and Xcode CLI tools:

```bash
# Run from the coordinator terminal (MAIN/REPO as set above)
# Portable (any git that has worktrees at all, i.e. >= 2.5)
rm -rf "$MAIN/../${REPO}-agent-1"
git worktree prune                # drops the now-dangling registration
git branch -d parallel/agent-1    # -D to discard unmerged work

# git >= 2.17 equivalent for the first two lines:
#   git worktree remove "../${REPO}-agent-1"     # -f if the tree is dirty
```

> Order matters: `git branch -d` refuses while the branch is still checked out
> in a registered worktree (`Cannot delete branch ... checked out at ...`), so
> prune first, delete second.

### Step 3: Set Agent Environment Variables

**Start each block from inside the main checkout** — every terminal re-derives
its own paths from git, so nothing depends on a variable set in another shell.
Each `cd`s into its own worktree; `SQUAD_DIR` is **absolute** (it survives any
later `cd` into a subdirectory) and points back at the coordinator's `.squad/`,
so all agents share one lock/comm namespace. Coordination state is shared on
purpose; only the *code* is isolated.

**Terminal 1 - Frontend Agent:**
```bash
cd /path/to/your/repo            # the MAIN checkout
MAIN="$(git rev-parse --show-toplevel)"
export SQUAD_DIR="$MAIN/.squad"  # absolute — survives any cd
cd "$MAIN/../$(basename "$MAIN")-agent-1" || { echo "worktree missing — run Step 2"; exit 1; }

export AGENT_ID="agent-1-ui-developer"
export AGENT_TYPE="ui-developer"
export AGENT_PLAN="$SQUAD_DIR/parallel-plans/agent-1-plan.md"
export AGENT_COMM="$SQUAD_DIR/comms/agent-1-comm.md"
export PARALLEL_MODE="true"

# Confirm isolation before doing any work:
git rev-parse --show-toplevel    # must print the -agent-1 worktree, NOT the main repo
```

**Terminal 2 - Backend Agent:**
```bash
cd /path/to/your/repo
MAIN="$(git rev-parse --show-toplevel)"
export SQUAD_DIR="$MAIN/.squad"
cd "$MAIN/../$(basename "$MAIN")-agent-2" || { echo "worktree missing — run Step 2"; exit 1; }

export AGENT_ID="agent-2-devops-architect"
export AGENT_TYPE="devops-architect"
export AGENT_PLAN="$SQUAD_DIR/parallel-plans/agent-2-plan.md"
export AGENT_COMM="$SQUAD_DIR/comms/agent-2-comm.md"
export PARALLEL_MODE="true"

git rev-parse --show-toplevel    # must print the -agent-2 worktree
```

**Terminal 3 - AI/ML Agent:**
```bash
cd /path/to/your/repo
MAIN="$(git rev-parse --show-toplevel)"
export SQUAD_DIR="$MAIN/.squad"
cd "$MAIN/../$(basename "$MAIN")-agent-3" || { echo "worktree missing — run Step 2"; exit 1; }

export AGENT_ID="agent-3-ai-ml-engineer"
export AGENT_TYPE="ai-ml-engineer"
export AGENT_PLAN="$SQUAD_DIR/parallel-plans/agent-3-plan.md"
export AGENT_COMM="$SQUAD_DIR/comms/agent-3-comm.md"
export PARALLEL_MODE="true"

git rev-parse --show-toplevel    # must print the -agent-3 worktree
```

> The `|| { … exit 1; }` guard is load-bearing: without it a failed `cd` leaves
> the terminal in the **main checkout** and the agent edits the shared tree with
> no warning. Fail loudly instead.

### Step 4: Launch Agents

In each terminal, instruct the agent to start work:

```markdown
You are operating in PARALLEL EXECUTION MODE as ${AGENT_ID}.

Your execution plan is in: ${AGENT_PLAN}
Your communication file is: ${AGENT_COMM}

Rules for parallel execution:
1. ONLY modify files listed in your plan under "MODIFY" or "CREATE"
2. Before editing any file, check for locks in ${SQUAD_DIR}/locks/
   (NOT `.squad/locks/` — from inside your worktree that path does not exist,
   so you would find no locks and wrongly conclude every file is free)
3. Create a lock before editing, remove it after completion
4. Update your communication file every 5 minutes
5. If blocked, work on alternative tasks or wait

Begin by:
1. Reading your execution plan
2. Confirming your file ownership
3. Starting with the first task
4. Creating locks as needed

Start now.
```

### Step 5: Monitor Progress Dashboard

**Coordinator Terminal (Terminal 4):**

Create a monitoring script:

```bash
#!/bin/bash
# monitor-parallel.sh

while true; do
  clear
  echo "==================================="
  echo "PARALLEL EXECUTION MONITOR"
  echo "Time: $(date)"
  echo "==================================="
  
  echo -e "\n📊 AGENT STATUS:"
  for i in 1 2 3; do
    if [ -f ".squad/comms/agent-$i-comm.md" ]; then
      status=$(grep "^Status:" .squad/comms/agent-$i-comm.md | tail -1)
      task=$(grep "^Current Task:" .squad/comms/agent-$i-comm.md | tail -1)
      echo "Agent $i: $status"
      echo "  $task"
    fi
  done
  
  echo -e "\n🔒 ACTIVE LOCKS:"
  # No redirect in the `for` list -- `for x in *.glob 2>/dev/null` is a syntax
  # error, not a "hide errors" idiom. The [ -f ] guard already handles the
  # no-matches case (the glob stays literal when nothing matches).
  for lock in .squad/locks/*.lock; do
    if [ -f "$lock" ]; then
      filename=$(basename "$lock" .lock)
      locked_by=$(grep "LOCKED_BY:" "$lock" | cut -d: -f2)
      echo "  $filename -> $locked_by"
    fi
  done
  
  echo -e "\n📁 RECENT FILE CHANGES:"
  git status --short | head -5
  
  echo -e "\n⏱️  METRICS:"
  if [ -f ".squad/metrics/parallel-performance.md" ]; then
    grep "Parallel Efficiency:" .squad/metrics/parallel-performance.md
  fi
  
  sleep 5
done
```

Run the monitor:
```bash
chmod +x monitor-parallel.sh
./monitor-parallel.sh
```

## Parallel Execution Protocol

### Starting Work
1. Agent reads its plan file
2. Updates status to "ACTIVE" in comm file
3. Begins first task from plan
4. Creates lock before file modification
5. Updates progress regularly

### During Execution
```markdown
## Status Update Format
Status: ACTIVE
Current Task: Implementing user dashboard component
Files Modified: 
  - /frontend/components/Dashboard.tsx (created)
  - /frontend/styles/dashboard.css (created)
Progress: 2/5 tasks complete
Next: API integration hooks
Timestamp: 2024-01-20T11:00:00Z
```

### Handling Blocks
```markdown
## Blocker Report
Status: BLOCKED
Blocker: File /shared/types/user.ts locked by agent-2
Waiting Since: 2024-01-20T11:15:00Z
Alternative Task: Starting on error handling components
Resolution: Will retry in 5 minutes
```

### Completion
```markdown
## Completion Report
Status: COMPLETE
Tasks Completed: 5/5
Files Created: 8
Files Modified: 3
Total Time: 35 minutes
Handoffs: None pending
Final Notes: All dashboard components ready for integration
```

## Coordination Commands

### Check All Agent Status
```bash
for i in 1 2 3; do
  echo "=== Agent $i ==="
  tail -10 .squad/comms/agent-$i-comm.md | grep -E "Status:|Current Task:"
done
```

### Force Unlock (Emergency)
```bash
# Use only if agent has crashed
rm -f .squad/locks/[filename].lock
echo "Force unlocked: [filename]" >> .squad/logs/force-unlock.log
```

### Pause All Agents
```bash
echo "PAUSE_REQUESTED" > .squad/control/pause.flag
# Agents should check for this flag
```

### Resume All Agents
```bash
rm -f .squad/control/pause.flag
```

## Success Indicators

✅ **Good Parallel Execution:**
- All agents report ACTIVE status
- No locks held > 10 minutes
- Regular communication updates
- Files being created/modified
- No merge conflicts in git

⚠️ **Warning Signs:**
- Lock held > 10 minutes
- Agent status stuck
- Multiple BLOCKED statuses
- No communication updates
- Git conflicts appearing

❌ **Failure Indicators:**
- Deadlock (circular lock waiting)
- Agent crash/termination
- File corruption
- Unresolvable conflicts
- Plan deviation

## Troubleshooting

### Agent Not Starting
- Verify environment variables are set
- Check plan file exists and is readable
- Ensure agent has correct permissions
- Verify git repository is clean

### Locks Not Releasing
- Check agent communication for errors
- Force unlock if agent has crashed
- Verify lock directory permissions
- Check for stale lock files (> 30 min)

### Merge Conflicts
- Stop all agents immediately
- Resolve conflicts manually
- Clear all locks
- Restart with updated plans

### Communication Breakdown
- Check comm file permissions
- Verify agents are updating files
- Ensure filesystem isn't full
- Check for network/terminal issues

## Best Practices

1. **Start Small**: Begin with 2 agents before scaling to 3+
2. **Clear Boundaries**: Ensure file ownership is unambiguous  
3. **Frequent Syncs**: Update communication files every 3-5 minutes
4. **Quick Locks**: Hold locks only for actual edit time
5. **Alternative Tasks**: Always have backup work if blocked
6. **Clean Handoffs**: Document clearly when passing work
7. **Regular Commits**: Commit completed work frequently
8. **Monitor Actively**: Watch the dashboard for issues