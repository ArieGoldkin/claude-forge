# Context Management Protocol

## Purpose

Ensures session persistence, cross-agent knowledge sharing, and continuous learning across all platform development sessions. Every agent interaction with the context system maintains project continuity.

## Context File Location

**Primary File**: `.claude/context/shared-context.json`
**Archive Directory**: `.claude/context/archive/`
**Session Logs**: `.claude/context/sessions/`

## Core Workflow

### Step 1: Load Existing Context (Before Starting Work)

**Use the Read tool:**
```
Tool: Read
File: .claude/context/shared-context.json
```

**Mentally extract relevant information:**
- Your agent's previous decisions: `context.agent_decisions[your-agent-name]`
- Completed tasks: `context.tasks_completed`
- Pending tasks: `context.tasks_pending`
- Codebase patterns: `context.codebase_patterns`
- Architectural decisions: `context.architectural_decisions`

**Example mental checklist:**
1. Has my agent worked on this codebase before?
2. What patterns were established? (functional components? React hooks? Tailwind?)
3. Are there pending tasks I should know about?
4. What recent architectural decisions affect my work?

### Step 2: Track Decisions (During Work)

**When you make a significant decision:**
1. Use Read tool on `shared-context.json`
2. Mentally prepare the update (don't execute JavaScript)
3. Use Edit tool to add your decision

**Decision Entry Format:**
```json
{
  "timestamp": "2025-12-29T15:30:00.000Z",
  "decision": "Implemented Lambda WebSocket handler for real-time chat",
  "rationale": "WebSocket provides better UX than polling for conversational AI",
  "evidence": {
    "architecture_doc": "/docs/ai-agents/GUIDE_CONVERSATIONAL_AI_ARCHITECTURE.md",
    "cost_analysis": "$0.027 per conversation vs $0.15 for polling"
  },
  "impact": "All future real-time features should use WebSocket pattern",
  "alternatives_considered": [
    {"option": "SSE", "reason": "Rejected due to browser compatibility"},
    {"option": "Polling", "reason": "Rejected due to poor UX and higher costs"}
  ]
}
```

**Use Edit tool to add decision:**
```
Tool: Edit
File: .claude/context/shared-context.json
Old String: "agent_decisions": {}
New String: "agent_decisions": {
  "devops-architect": [{
    "timestamp": "2025-12-29T15:30:00.000Z",
    "decision": "Implemented Lambda WebSocket handler for real-time chat",
    ...
  }]
}
```

### Step 3: Mark Tasks Complete (After Finishing Work)

**Use Edit tool to update:**
```json
{
  "id": "task-guide-architecture-2025-12-29",
  "description": "Design conversational AI architecture",
  "agent": "devops-architect",
  "completed_at": "2025-12-29T15:30:00.000Z",
  "deliverable": "/docs/ai-agents/GUIDE_CONVERSATIONAL_AI_ARCHITECTURE.md",
  "outcome": "Comprehensive 3,500+ line architecture document with objective recommendations",
  "evidence": {
    "document_created": true,
    "technical_depth": "production-grade",
    "alternatives_analyzed": 3
  }
}
```

**Add to `tasks_completed` array and remove from `tasks_pending`**

### Step 4: Handle Blockers (When Stuck)

**Document blockers immediately:**
```json
{
  "id": "blocker-alembic-migration-2025-12-29",
  "description": "Database migration needed for new chat table",
  "blocker": "Requires production data backup and approval",
  "agent": "data-architect",
  "timestamp": "2025-12-29T15:45:00.000Z",
  "suggested_resolution": "1. Run pg_dump backup, 2. Get approval, 3. Apply migration",
  "priority": "high",
  "dependencies": ["users table", "sessions table"]
}
```

## Context Structure (TypeScript Interface)

```typescript
interface SharedContext {
  version: string;                    // Config version (e.g., "4.0.0")
  timestamp: string;                  // Last update timestamp
  session_id: string;                 // Current session identifier
  mode: "classic" | "squad" | "adaptive";

  // Agent decisions with evidence
  agent_decisions: {
    [agentName: string]: Array<{
      timestamp: string;
      decision: string;              // What was decided
      rationale: string;             // Why this decision
      evidence?: object;             // Proof (docs, metrics, analysis)
      impact?: string;               // How this affects future work
      alternatives_considered?: Array<{
        option: string;
        reason: string;
      }>;
    }>;
  };

  // Completed tasks
  tasks_completed: Array<{
    id: string;
    description: string;
    agent: string;
    completed_at: string;
    deliverable?: string;            // File path or artifact
    outcome: string;                 // What was achieved
    evidence?: object;               // Build logs, test results, etc.
    artifacts?: string[];            // Files created/modified
    metrics?: {
      linesOfCode?: number;
      testsAdded?: number;
      performance?: string;
    };
  }>;

  // Pending tasks and blockers
  tasks_pending: Array<{
    id: string;
    description: string;
    blocker?: string;                // What's blocking progress
    agent: string;
    timestamp: string;
    suggested_resolution?: string;
    priority?: "low" | "medium" | "high";
    dependencies?: string[];
  }>;

  // Detected codebase patterns
  codebase_patterns?: {
    component_style?: "functional" | "class";
    state_management?: "hooks" | "redux" | "zustand" | "context";
    api_pattern?: "REST" | "GraphQL" | "WebSocket";
    testing_framework?: "vitest" | "jest" | "pytest";
    styling?: "tailwind-shadcn" | "material-ui" | "css-modules";
    backend_patterns?: {
      runtime?: "Python 3.12" | "Node.js";
      architecture?: "AWS Lambda" | "FastAPI" | "Express";
      database?: "PostgreSQL" | "DynamoDB";
      migrations?: "Alembic" | "Prisma";
    };
  };

  // Architectural decisions (ADRs)
  architectural_decisions?: {
    [decision_name: string]: {
      decision: string;
      reasoning: string;
      alternatives_rejected?: Array<{
        option: string;
        reason: string;
      }>;
      future_reconsideration?: string;
    };
  };

  // Session metadata
  last_activity?: string;
  active_agent?: string;

  // Retention policy (v4.0.0+)
  retention?: {
    current_session: string;
    active_since: string;
    archive_after_days: number;      // Default: 30
    summarize_after_days: number;    // Default: 90
  };
}
```

## Context Rotation Policy (v4.0.0+)

### Automatic Archival

**Active Sessions**: Last 30 days in `shared-context.json`
**Archived Sessions**: 31-365 days in `.claude/context/archive/`
**Summarized**: 365+ days compressed to key decisions only

### Manual Archive Command

When starting a new major feature or phase:

**Step 1: Read current context**
```
Tool: Read
File: .claude/context/shared-context.json
```

**Step 2: Save archive**
```
Tool: Write
File: .claude/context/archive/session-2025-12-29-guide-architecture.json
Content: [current shared-context.json content]
```

**Step 3: Reset shared-context.json**
```
Tool: Write
File: .claude/context/shared-context.json
Content: {
  "version": "4.0.0",
  "timestamp": "2025-12-29T16:00:00.000Z",
  "session_id": "session-new-feature-2025-12-29",
  "mode": "adaptive",
  "agent_decisions": {},
  "tasks_completed": [],
  "tasks_pending": [],
  "codebase_patterns": { [copy from archived session] },
  "retention": {
    "current_session": "session-new-feature-2025-12-29",
    "active_since": "2025-12-29T16:00:00.000Z",
    "archive_after_days": 30,
    "summarize_after_days": 90
  }
}
```

**Note**: Preserve `codebase_patterns` - these are cumulative knowledge.

## Best Practices

### 1. Atomic Updates
- Save context after EVERY major decision (not batch updates)
- Use Edit tool, not Write tool (preserves existing content)
- Include timestamps in ISO 8601 format

### 2. Pattern Detection

**As you work, identify patterns:**
- Component style: Do most components use hooks or classes?
- State management: Is Redux used? Context API? Zustand?
- API patterns: REST endpoints? GraphQL? WebSocket?
- Styling: Tailwind? Material-UI? CSS modules?

**Update `codebase_patterns` section:**
```
Tool: Edit
File: .claude/context/shared-context.json
Old String: "codebase_patterns": {}
New String: "codebase_patterns": {
  "component_style": "functional",
  "state_management": "hooks",
  "styling": "tailwind-shadcn",
  "testing_framework": "vitest"
}
```

### 3. Evidence-Based Recording

**Always include evidence:**
- Exit codes from builds (`npm run build` output)
- Test results (`pytest` output, `vitest` coverage)
- Performance metrics (bundle size, load times)
- Documentation created (file paths)

**Example:**
```json
{
  "decision": "Migrated from Material-UI to shadcn/ui",
  "evidence": {
    "bundle_size_before": "450KB",
    "bundle_size_after": "180KB",
    "migration_pr": "#1234",
    "affected_components": 47
  }
}
```

### 4. Conflict Prevention (Squad Mode)

**Before starting work in squad mode:**
1. Read `shared-context.json`
2. Check `active_agent` field
3. Check `last_activity` timestamp
4. If another agent active within 5 minutes, coordinate

**Mental calculation:**
```
Current time: 2025-12-29T16:00:00.000Z
Last activity: 2025-12-29T15:57:00.000Z
Difference: 3 minutes -> CONFLICT! Other agent still working
```

**Resolution**: Wait or coordinate via team lead

## Integration Checklist

When working as an agent, ensure:

- [ ] Context loaded at session start (Read tool)
- [ ] Previous decisions reviewed for your agent
- [ ] Codebase patterns identified and followed
- [ ] Major decisions documented with rationale + evidence
- [ ] Tasks marked complete with deliverables
- [ ] Blockers documented with suggested resolutions
- [ ] Context saved after major milestones (Edit tool)
- [ ] Conflicts checked in squad mode
- [ ] Session continuity maintained

## Context Query Patterns

### "What patterns exist in this codebase?"
```
Read: .claude/context/shared-context.json
Focus on: codebase_patterns section
```

### "Has anyone worked on authentication before?"
```
Read: .claude/context/shared-context.json
Search: agent_decisions, tasks_completed for "auth" keywords
```

### "What's blocking progress?"
```
Read: .claude/context/shared-context.json
Focus on: tasks_pending with high priority
```

### "What architectural decisions were made?"
```
Read: .claude/context/shared-context.json
Focus on: architectural_decisions section
```

## Context Preservation is NOT Optional

Context preservation is the **foundation of intelligent, continuous AI development** on the platform. Without it:
- Agents repeat work
- Patterns get violated
- Architectural decisions get forgotten
- Progress tracking fails

**Always maintain context integrity.**

---
**Version**: 4.0.0 | **Last Updated**: 2025-12-29 | **Replaces**: context-middleware.md
