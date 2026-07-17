# Routing Rules

Detailed parameter extraction logic for each target skill. Read this during Phase 2 (Plan)
to configure the target skill correctly.

## Table of Contents

- [Route: fix → /fix-bug](#route-fix--fix-bug)
- [Route: optimize → /experiment](#route-optimize--experiment)
- [Route: cover → /cover --target](#route-cover--cover---target)
- [Route: design → /brainstorming](#route-design--brainstorming)
- [Route: build → /develop](#route-build--develop)
- [Route: review → /review-mr](#route-review--review-mr)
- [Route: verify → /verify](#route-verify--verify)
- [Route: triage → /investigate-sentry](#route-triage--investigate-sentry)
- [Route: improve-skill → /experiment on SKILL.md](#route-improve-skill--experiment-on-skillmd)
- [Route: audit-skill → /audit-skill](#route-audit-skill--audit-skill)
- [Route: ship → /prepare-pr](#route-ship--prepare-pr)
- [Route: compliance → /hipaa-compliance-checker](#route-compliance--hipaa-compliance-checker)
- [Route: research → /ctk:web-research](#route-research--ctkweb-research)
- [Disambiguation Rules](#disambiguation-rules)

---

## Route: fix → /fix-bug

**Extract from goal:**
- Bug description (the full goal text becomes the bug description)
- Target files (if mentioned: "fix the timeout in `handler.ts`" → `handler.ts`)
- Ticket ID (if mentioned: "fix PROJ-142" → link to Jira/Linear)
- Error message (if quoted: `"TypeError: Cannot read property"`)

**Invocation:**
```
/fix-bug {bug description}
```

**Budget:** Default 30 minutes. Fix-bug uses observation loops, not iteration counts.

**Edge cases:**
- "Fix the tests" is `fix`, not `cover` — the user wants broken tests repaired, not new tests
- "Fix performance" is ambiguous — ask: "Do you want to debug a specific issue or optimize a metric?"

---

## Route: optimize → /experiment

**Extract from goal:**
- Metric name (latency, throughput, bundle size, response time, memory usage)
- Direction: `minimize` (latency, size, time, cost) or `maximize` (throughput, score, rate)
- Goal value (if specified: "below 100ms" → `--goal 100`)
- Unit (ms, KB, %, requests/sec)
- Target files (if specified, otherwise the skill will scan)

**Invocation:**
```
/experiment {target} --metric "{metric command}" --{direction} --goal {value} --unit {unit}
```

**Metric command inference:**
- Latency/performance → `npm run bench` or `time node {script}` or project-specific benchmark
- Bundle size → `npm run build && stat -f%z dist/bundle.js`
- Lint score → `npm run lint -- --format json | jq '.errorCount'`
- Custom → ask the user: "How should I measure {metric}?"

**Budget:** Default 10 iterations / 30 minutes.

**Edge cases:**
- "Make it faster" without a metric → ask: "What should I measure? Response time, build time, or something else?"
- Multiple metrics → pick the one the user emphasized; note others as constraints

---

## Route: cover → /cover --target

**Extract from goal:**
- Coverage target percentage (extract number: "90%" → 90, "above 85" → 85)
- Scope (if specified: "cover the auth module" → `--scope src/auth/`)

**Invocation:**
```
/cover --target {N}
```

**Budget:** Default 10 iterations (Phase 5b autonomous mode).

**Edge cases:**
- "Write more tests" without a target → ask: "What coverage percentage are you aiming for?"
- "Test the new feature" is `build` or `verify`, not `cover` — the user wants functional tests, not coverage

---

## Route: design → /brainstorming

**Extract from goal:**
- Topic (the full goal text)
- Mode: default is simple. Use `--deep` if the user says "thorough", "comprehensive",
  "deep dive", or the topic involves multiple systems/domains

**Invocation:**
```
/brainstorming {topic}
# or
/brainstorming --deep {topic}
```

**Budget:** Not iteration-based. Simple mode: 5-10 minutes. Deep mode: 15-30 minutes.

**Edge cases:**
- "How should we..." is `design`, not `build`
- "I have an idea about..." is `design`
- "Design AND build..." → start with `design`, offer to continue with `build` after

---

## Route: build → /develop

**Extract from goal:**
- Feature description (the full goal text)
- Ticket ID (if mentioned)
- Mode flags: `greenfield` (new feature), `brownfield` (extend existing), `refactor`, `bugfix`

**Invocation:**
```
/develop {feature description}
```

**Budget:** Not iteration-based. Follows the development pipeline phases.

**Edge cases:**
- "Build" with a ticket → include ticket context
- "Implement the design from the brainstorm" → check for recent brainstorm state

---

## Route: review → /review-mr

**Extract from goal:**
- MR/PR number (extract: "MR !42" → 42, "PR #123" → 123)
- Scope (if mentioned: "review the auth changes" → filter to auth files)

**Invocation:**
```
/review-mr {MR number or branch}
```

**Edge cases:**
- "Review my code" without an MR → ask: "Which MR or branch should I review?"
- "Review the design" is `design` (brainstorming), not `review`

---

## Route: verify → /verify

**Extract from goal:**
- Checks to run (tests, lint, typecheck, or all)
- Scope (if specified)

**Invocation:**
```
/verify
```

**Budget:** Single pass, no iteration.

**Edge cases:**
- "Make sure it works" → `/verify` (run all checks)
- "Check if tests pass" → `/verify` (focused on tests)

---

## Route: improve-skill → /experiment on SKILL.md

**Extract from goal:**
- Skill name (which SKILL.md to optimize)
- Quality metric (if specified, otherwise use task completion rate against test cases)

**Invocation:**
```
/experiment skills/{skill-name}/SKILL.md --metric "{eval command}" --maximize
```

**This is an advanced route.** Before executing:
1. Identify the skill to optimize
2. Check if evaluation criteria exist (golden dataset or test cases)
3. If no evaluation exists, help the user define 5-10 test cases first
4. Set the skill file as the only mutable target; everything else is readonly

**Budget:** Default 5 iterations / 30 minutes. Skill mutation should be conservative.

**Edge cases:**
- "Make the brainstorming skill better" → needs test cases first
- "Optimize my prompt" (not a skill) → route to `optimize` with prompt as target

---

## Route: research → /ctk:web-research

**Extract from goal:**
- Research topic / question (the full goal text becomes the topic)
- Scope hints (timeframe "in 2026", comparison "X vs Y", source preference "official docs")

**Invocation:**
```
/ctk:web-research {topic}
```

For a deep, multi-source, adversarially-verified report (not a quick lookup), escalate to the `deep-research` harness instead.

**Budget:** Single pass. Not iteration-based; bounded by the web-research skill's own web/MCP fan-out.

**Edge cases:**
- "Research how WE do X" (internal codebase) is NOT `research` — that's `design` (brainstorming) or a direct codebase read. `research` is for EXTERNAL web/docs.
- "Compare our options for X" with no external unknown → `design`. With an external landscape to survey → `research`.

---

## Route: triage → /investigate-sentry

**Extract from goal:**
- Sentry issue ID or short-id (`PROJ-4F2`, `ABC-123`) or a Sentry issue URL
- Environment, if mentioned ("in prod", "staging")
- Time window, if mentioned ("since Tuesday", "after the deploy")

**Invocation:**
```
/investigate-sentry {issue id or url}
```

**Budget:** Default 30 minutes. Investigation-shaped, like `fix` — not an iteration loop.

**Edge cases:**
- **No Sentry ID → this is not `triage`.** "Investigate the crash" with no issue reference is
  `diagnose` (`/fix-bug`). The ID is what makes the route resolvable.
- Writes an assessment doc, not code. It ends by *proposing* a fix — it does not apply one. If the
  user wants the fix applied, that is a follow-on `/fix-bug`.

---

## Route: audit-skill → /audit-skill

**Extract from goal:**
- Target `SKILL.md` path(s), or the skill name ("audit the review-mr skill")
- Scope: one skill, a plugin's skills, or a corpus sweep

**Invocation:**
```
/audit-skill {path to SKILL.md}
```

**Budget:** Cheap and bounded — a read pass per skill. No iteration loop.

**Edge cases:**
- **Read-only, structurally.** The skill declares `disallowed-tools: Edit/Write/NotebookEdit`; it
  emits *candidate flags* for a human, never edits. Safe to route without a confirm gate.
- **vs `improve-skill`**: auditing *judges* the skill; `improve-skill` *changes* it. If the user
  wants the flags acted on, that is a separate, human-decided step — do not chain automatically.

---

## Route: ship → /prepare-pr

**Extract from goal:**
- Target branch, if named ("into develop") — else `prepare-pr` resolves the repo default
- Draft intent ("as a draft" → `--draft`)
- Ticket ID to close, if mentioned (`--closes PROJ-142`)

**Invocation:**
```
/prepare-pr
```

**Budget:** Single pass. Not a loop.

**Edge cases:**
- **The only write-route added to the router.** It commits, pushes, and opens the MR/PR.
- **Do not pass `--no-confirm` through.** `prepare-pr` has its own mandatory gate (the drafted body
  must be human-approved before creation) and its own verify pre-gate. The router's job is to reach
  the skill, not to defeat its safety. `--no-confirm` on the router is honored for read-only routes
  only — this is not one.
- **vs `review`**: `ship` *opens* the MR/PR; `review` (`/review-mr`) reviews one that already
  exists. "Ship it" → `ship`. "Review !42" → `review`.

---

## Route: compliance → /hipaa-compliance-checker

**Extract from goal:**
- Scope: the paths/modules to check, else the working tree
- Specific concern, if named (RBAC, audit logging, token expiry, encryption at rest)

**Invocation:**
```
/hipaa-compliance-checker {scope}
```

**Budget:** Single analysis pass.

**Edge cases:**
- Analysis-only — reports findings, does not remediate. A fix is a follow-on `/fix-bug` or
  `/develop`.
- Never echo PHI into the goal, the plan, or the report. Findings are process/behavior only.

---

## Disambiguation Rules

When a goal matches multiple categories:

1. **Explicit verb wins.** "Fix the slow query" → `fix` (not `optimize`)
2. **Metric presence → optimize.** "Get latency below 100ms" → `optimize`
3. **Percentage target → cover.** "Get to 90%" in test context → `cover`
4. **Question form → design.** "How should we handle X?" → `design`
5. **Ticket reference → build.** "Implement PROJ-142" → `build`
6. **MR/PR reference → review.** "Look at !42" → `review`
7. **When truly ambiguous**, ask one question: "I see this as both {A} and {B}. Which approach: {A description} or {B description}?"
8. **Skill/prompt target → improve-skill; metric/code target → optimize.** "Optimize the review SKILL.md" / "improve the X skill" → `improve-skill` (skill-file mutation, conservative 5-iter budget, human review gate). "Optimize {metric}" / "optimize {code path}" → `optimize` (10-iter metric loop). Distinguishing signal: the target is a `SKILL.md` / named skill vs a runtime metric or source file.
9. **External-web question → research; internal-design question → design.** "What's the state of X in 2026" / "survey approaches to Y" → `research` (`/ctk:web-research`). "How should WE build Y" → `design` (`/brainstorming`).
10. **Sentry ID present → triage; otherwise → diagnose.** `triage` and `diagnose` both own the word "investigate", so the *ID is the tiebreak*, not the verb. "Investigate PROJ-4F2" / "triage this sentry issue {url}" → `triage` (`/investigate-sentry`). "Investigate why checkout crashes" → `diagnose` (`/fix-bug`). Rationale: `investigate-sentry` needs a resolvable issue reference to fetch; without one it has nothing to open, and `/fix-bug`'s observation loop is the right tool anyway.
11. **Judging a skill → audit-skill; changing one → improve-skill.** Both target a `SKILL.md`. "Audit the review-mr skill" / "is this skill any good" / "find sediment" → `audit-skill` (read-only, emits flags for a human). "Optimize the review SKILL.md" / "make this skill better" → `improve-skill` (mutates the file, conservative 5-iter budget, human review gate). Signal: *assess* vs *change*.
12. **Opening an MR/PR → ship; reviewing an existing one → review.** "Ship it" / "ready for review" / "open a PR" → `ship` (`/prepare-pr` — authors the description and creates it). "Review !42" / "look at PR 26" → `review` (`/review-mr` — reviews one that exists; it never creates one).
