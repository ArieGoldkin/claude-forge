---
name: brainstorming
description: "Refine ideas into actionable designs via Socratic questioning (simple mode) or parallel multi-agent analysis (--deep). Includes scoring matrix, tier detection, and security review. Use when: exploring a feature idea, making architectural decisions, comparing design approaches, or starting a complex project. Triggers on: brainstorm, help me design, explore options, architect, how should we, design a, what approach, trade-offs, compare approaches"
effort: xhigh
---

<!--
DELIBERATELY NOT `context: fork`. Measured on CC 2.1.222 (issue #134): a forked
skill has NO `AskUserQuestion` tool, so Socratic mode cannot ask anything.
`background: false` does NOT fix this — it changes only whether the parent waits.
Re-adding `context: fork` silently disables this skill's primary mode.
See root CLAUDE.md § "Forking strips the interactive channel".
-->


# Brainstorming Ideas Into Designs

## Overview

Transform rough ideas into fully-formed designs using either:
- **Simple Mode** (default): Interactive Socratic questioning for straightforward features
- **Deep Mode** (--deep flag): Parallel multi-agent analysis for complex architectural decisions

**Core principle:** Ask questions to understand, explore alternatives, present design incrementally for validation.

**Announce skill usage and mode at start of session.**

## No-Interlocutor Guard (mandatory, both modes)

**Before Phase 0, check whether `AskUserQuestion` is actually available to you.** It is absent whenever this skill runs in a forked/subagent context — measured on CC 2.1.222, issue #134.

**If it is missing, you have no interlocutor. Then:**

1. **Say so in your first line.** State that you ran without a user channel.
2. **Never invent the user's answers, and never silently take a default.** A fabricated answer is indistinguishable from a real one once it is in the design.
3. Complete every step that does **not** depend on an answer.
4. Return the unanswered questions verbatim in a final `## Questions requiring a human` section — each with its options and what it would change. The caller relays them.

The failure this prevents is not a crash. It is a confident, well-structured design built on invented intent — which looks exactly like a good one. Both modes need this: `--deep`'s Phase 5 blocks on `AskUserQuestion` too.

## Context Detection

Before starting, detect project context to adapt brainstorming:

### Project Tier Detection
Scan the working directory to classify the change scope:
- **FOCUSED**: 1-5 files, <500 LOC — direct implementation, no new abstractions
- **MODERATE**: 5-15 files, 500-2000 LOC — one new module OK, follow existing patterns
- **SIGNIFICANT**: 15+ files, 2000+ LOC — new patterns justified, propose incrementally

Display detected tier briefly at session start. See `${CLAUDE_SKILL_DIR}/references/tier-detection.md` for detection heuristics.

### Tech Stack Detection
Scan the working directory to detect the project's tech stack:
- `package.json` / `tsconfig.json` → Frontend framework (React, Vue, Angular, etc.)
- `requirements.txt` / `pyproject.toml` → Backend framework (FastAPI, Django, Flask, etc.)
- `Dockerfile` / `docker-compose.yml` → Infrastructure patterns
- Migration files (Alembic, Prisma, etc.) → Database type
- CI configs (`.gitlab-ci.yml`, `.github/workflows/`) → Deployment patterns

Substitute detected values into agent prompts. If detection fails, ask the user to confirm their tech stack.

## Mode Selection

```
Decision tree:

  User request arrives
         |
    --deep flag? ──yes──► Deep Mode (multi-agent)
         |
        no
         |
    Complex arch? ──yes──► Suggest --deep, proceed Simple if declined
         |
        no
         |
    Simple Mode (Socratic)
```

**Triggered by:**
- User explicitly requests deep mode: `/brainstorm --deep <topic>`
- Check command arguments for `--deep` flag

**Default:** Simple mode if no `--deep` flag present

## Simple Mode (Default)

**Use for:** Quick feature ideation, clarifications, straightforward designs, single-domain problems.

**Token efficiency:** ~2-5k tokens, 5-10 minutes

### Flow

#### Phase 0: Quick System Design Check

Before diving into Socratic questioning, briefly assess system design dimensions conversationally:

```markdown
Let me ask a few quick questions to understand constraints:

1. **Scale**: Roughly how many users will use this? (10s, 100s, 1000s+)
2. **Data**: Where should this data live? (existing table, new table, consideration needed?)
3. **Security**: Who needs access? (end users, admins, API consumers, specific roles)
4. **UX**: What's the latency expectation? (<100ms, <500ms, <2s OK)
5. **Compliance**: Regulatory or data classification constraints? (PII, SOC2, GDPR, none)
```

Keep it brief and conversational. Don't make it a formal phase. Integrate into Phase 1.

Reference: See `${CLAUDE_SKILL_DIR}/references/system-design-interrogation.md` for full 5-dimension framework.

#### Phase 1: Understanding

**Goal:** Gather purpose, constraints, and success criteria.

**Process:**
- Check current project state in working directory
- Ask ONE question at a time to refine the idea
- Use AskUserQuestion tool when presenting multiple choice options
- Gather: Purpose, constraints, success criteria
- Weave in system design questions naturally

**Tool Usage:**
Use AskUserQuestion for clarifying questions with 2-4 clear options.

Example: "Where should the authentication data be stored?" with options for Session storage, Local storage, Cookies, each with trade-off descriptions.

See `${CLAUDE_SKILL_DIR}/references/example-session-auth.md` for complete Phase 1 example.

#### Phase 1.5: Divergent Braindump (30 seconds)

**Goal:** Generate a quick spread of ideas before narrowing to 2-3 approaches.

**Process:**
- Based on what was learned in Phase 1, list 5-8 raw ideas as a numbered braindump
- Each idea: **Name** — one-liner description (Testability: easy/medium/hard)
- No evaluation, no filtering — quantity over quality
- Present the list and ask: "Any of these spark interest, or should I explore a different direction?"

**Format:**
```
1. **Idea Name** — Brief description (Testability: easy)
2. **Idea Name** — Brief description (Testability: hard)
...5-8 ideas total
```

**Keep it fast.** This is a 30-second braindump, not a formal exercise. The goal is to widen the solution space before Phase 2 narrows it.

#### Phase 2: Exploration

**Goal:** Propose 2-3 different architectural approaches with explicit trade-offs.

**Pre-step — load business invariants** (when applicable):

Before proposing approaches, follow the shared loader at `skills/code-review-playbook/references/load-business-invariants.md` with `mode: planning`. The loader handles all four cases (file present / missing / sparse / user-skipped) including the create-or-skip prompt. If the loader returns `status: loaded`, present the rule IDs + one-line rule names to the user inline (so they can reference them when comparing approaches), and add an **Invariants** scoring dimension (see matrix below). If the loader returns `status: skipped` or `status: absent`, omit the dimension and proceed normally — make a brief note that invariants were not consulted this session.

**Process:**
- Propose 2-3 different approaches
- For each: Core architecture, trade-offs, complexity assessment
- Use AskUserQuestion tool to present approaches as structured choices
- Include trade-off comparison table when helpful

**Scoring Matrix Format:**

From the divergent braindump, select top 2-3 ideas and score them:

| Approach | Feasibility | Complexity | Testability | Security | Fit | Invariants | **Total** |
|----------|:-----------:|:----------:|:-----------:|:--------:|:---:|:----------:|:---------:|
| Option 1 |    /10      |    /10     |     /10     |   /10    | /10 |    /10     | **/60**   |
| Option 2 |    /10      |    /10     |     /10     |   /10    | /10 |    /10     | **/60**   |
| Option 3 |    /10      |    /10     |     /10     |   /10    | /10 |    /10     | **/60**   |

If invariants were not loaded (loader returned `skipped` or `absent`), drop the **Invariants** column and revert to a `/50` total — do not score a dimension you didn't measure.

**Dimensions (0-10 each):**
- **Feasibility**: Can we build this with current stack and skills?
- **Complexity** (inverted): 10 = trivially simple, 0 = extremely complex
- **Testability**: How easy to write automated tests?
- **Security**: How well does it handle auth, data protection, isolation?
- **Fit**: How well does it match the stated requirements?
- **Invariants** (only if loaded): How well does the approach respect the project's `.claude/business-invariants.md` rules? 10 = preserves all relevant rules cleanly; 5 = relies on weak `[Convention]`-only enforcement; 0 = forced to violate or document an exemption. Cite invariant IDs in the prose justification.

Include 2-3 sentence prose description alongside each approach. The matrix supplements, not replaces, the narrative.

Each approach must include a **1-liner test strategy** (e.g., "Unit test core logic + integration test API endpoint").

See `${CLAUDE_SKILL_DIR}/references/example-session-dashboard.md` for complete Phase 2 example with SSE vs WebSockets vs Polling comparison.

#### Phase 3: Design Presentation

**Goal:** Present complete design incrementally, validating each section.

**Process:**
- Present in 200-300 word sections
- Cover: Architecture, components, data flow, error handling, testing
- Ask after each section: "Does this look right so far?"
- Use open-ended questions to allow freeform feedback

**Typical Sections:**
1. Architecture overview
2. Component details
3. Data flow
4. Error handling
5. **Testing approach** (unit, integration, key test cases)
6. Security considerations
7. Implementation priorities

**Validation Pattern:**
After each section, pause for feedback before proceeding to next section.

#### Phase 4: Security and Compliance Review

If the design involves sensitive data or regulated environments, briefly review:

```markdown
Let me verify security and compliance considerations:

- **Data Classification**: What data is sensitive? (PII, financial, proprietary)
- **Access Control**: Who can access what? Role-based permissions clear?
- **Encryption**: Data encrypted at rest and in transit?
- **Audit Trail**: Are access events logged for compliance?
```

Skip this phase if no sensitive data is involved.

#### Visual Preview (Optional — UI features only)

When brainstorming UI or frontend features, offer to generate a quick visual preview:

1. Generate a self-contained HTML mockup of the proposed design
2. Write to a temp file and open with `open` (macOS) or suggest the user open it
3. Use this to validate layout, flow, and interaction patterns before finalizing the design

Skip this step for backend, infrastructure, or non-visual features.

---

## Deep Mode (--deep flag)

**Use for:** Complex features, architectural decisions, multi-domain problems, significant new functionality.

**Token budget:** ~20-40k tokens, 15-30 minutes

### Flow Summary

Deep mode runs 6 phases with parallel multi-agent analysis. Read `${CLAUDE_SKILL_DIR}/references/deep-mode-phases.md` for full phase-by-phase instructions.

| Phase | Name | Description |
|-------|------|-------------|
| 0 | System Design Interrogation | Structured 5-dimension assessment |
| 1 | Codebase Context | Search existing patterns and ADRs (optional, skip if greenfield) |
| 1.5 | Divergent Exploration | Generate 8-12 ideas, feasibility filter to 6-10 candidates |
| 2 | Multi-Perspective Analysis | 8 parallel agents analyze the problem (checkpoint) |
| 3 | Synthesis & Coherence | 3 agents integrate findings into unified recommendation (checkpoint) |
| 4 | Presentation & Decision Points | Present executive summary, gaps, and key decisions |
| 5 | Interactive Refinement | Structured refinement with exit criteria (max 2 rounds) |

**Task Tracking (Deep Mode):** At Phase 0 start, create parent task "Brainstorm: [topic]" and a subtask for each phase. Update subtask status silently as phases progress — do not display task operations to the user.

**Key rules:**
- Phase 2: Launch ALL 8 agents in ONE message, wait for all to complete
- Phase 3: Launch ALL 3 synthesis agents in ONE message, wait for all to complete
- Phase 4: Present results using the structured template from the reference file
- Phase 5: Refine design based on user answers

### Checkpoint Resume & Refinement (Deep Mode)

See `${CLAUDE_SKILL_DIR}/references/deep-mode-phases.md` for checkpoint resume, refinement loops, and exit criteria.

### Simple Mode Refinement
After Phase 3, if user requests changes:
1. Loop back to Phase 2 with the new constraint added, re-score approaches
2. **Maximum 3 loops** — after 3rd, suggest `/brainstorm --deep [topic]`

### Non-Linear Progression (Both Modes)
Go backward when needed — return to earlier phase when user reveals new constraint or validation shows a gap.

---

## Output Policy

**CRITICAL:** Do NOT write files unless explicitly requested by user.

- Default: Return analysis inline as text
- Use structured text, code blocks, ASCII art
- Only create files (ADRs, design docs) with explicit user approval
- Update `.claude/context/shared-context.json` after major decisions

---

## After Brainstorming Completes

Offer these next steps (ask user first):
- Document the design using `assets/design-doc-template.md`
- Create ADR if architectural decision (use `/architecture-decision-record` skill)
- Break down into implementation tasks

---

## Reference Files

Load as needed during brainstorming:

- **Deep Mode Phases**: `${CLAUDE_SKILL_DIR}/references/deep-mode-phases.md` — full phase-by-phase deep mode instructions, checkpoint resume, refinement loops
- **System Design**: `${CLAUDE_SKILL_DIR}/references/system-design-interrogation.md` — 5-dimension framework
- **Agent Prompts**: `${CLAUDE_SKILL_DIR}/references/agent-prompts.md` — 8 parallel agent prompt templates (deep mode Phase 2)
- **Synthesis**: `${CLAUDE_SKILL_DIR}/references/synthesis-agents.md` — 3 synthesis agent prompt templates (deep mode Phase 3)
- **Tier Detection**: `${CLAUDE_SKILL_DIR}/references/tier-detection.md` — project complexity detection and YAGNI gate
- **Examples**: `${CLAUDE_SKILL_DIR}/references/example-session-auth.md`, `${CLAUDE_SKILL_DIR}/references/example-session-dashboard.md`

## Assets

Output templates (use only if user requests):
- `assets/design-doc-template.md` — structured design document format
- `assets/decision-matrix-template.md` — weighted decision comparison format
