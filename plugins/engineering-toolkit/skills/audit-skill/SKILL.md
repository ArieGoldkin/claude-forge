---
name: audit-skill
description: "Audit a SKILL.md against the repo's Skill Authoring Rules and emit candidate flags for human review — CSO compliance, >150-line progressive-disclosure review, no-op/sediment/duplication, and completion criteria. Never edits or deletes. Use when: reviewing or pruning a skill before a version bump, vetting a new skill's quality, or sweeping the corpus for sediment. Triggers on: audit skill, audit-skill, skill quality, prune skill, sediment, no-op, skill review, lint skill"
effort: medium
disallowed-tools:
  - Edit
  - Write
  - NotebookEdit
---

# Audit Skill

Audit one or more `SKILL.md` files against this repo's **Skill Authoring Rules** — root `CLAUDE.md` → "Skill Authoring Rules" (esp. **CSO** and **Skill body hygiene**). That section is the **single source of truth**; this skill *operationalizes* it and does not restate the rules. If a definition is unclear (no-op, sediment, the steering carve-out), read it there first.

**Output contract**: candidate flags for a human to triage. This skill **never edits, deletes, or rewrites** a skill (it holds no Edit/Write/NotebookEdit). The no-op test is model-relative ("settle by running, not by debating") and we have no behavioral eval harness — so a human confirms every cut.

## Scope

- Target = the `SKILL.md` path(s) in `$ARGUMENTS`. If none given, ask which skill(s), or offer to sweep `plugins/*/skills/*/SKILL.md`. Use `find` / `find -L` (several etk skills are symlinks — `grep -r` misses them).
- Audit the SKILL.md body **and** its `references/*` satellite files — sediment often hides there.

## Checks — emit one flag per hit

1. **CSO description** — Read the frontmatter `description`. Flag if it does not (a) lead with what-it-does, (b) carry a "Use when" trigger clause, and (c) end with "Triggers on <keywords>". Workflow/process leaking into the description is a flag.
2. **Size / progressive disclosure** — `wc -l` the SKILL.md. If **>150 lines**, flag for a *progressive-disclosure review*: which sections are branch-specific reference that could move behind a `${CLAUDE_SKILL_DIR}` pointer? This is a review prompt, **not** a cut — reference-dense skills (terraform, database, testing) may legitimately exceed it.
3. **No-op / sediment** — Read sentence by sentence. Flag a sentence as a no-op candidate when it would not change the model's *default* behavior ("be thorough", "follow best practices", restating model-default deference). Flag a section as sediment when it is stale or documents a route/mode nothing reaches. **"Dormant is not dead"**: before flagging a reference file as dead, grep the SKILL.md + routing/reference files for a live pointer to it.
4. **Duplication (single source of truth)** — Flag the same *meaning* stated in multiple authoritative places (a behavior change would become an N-place edit). **Carve-out — do NOT flag**: deliberate repetition *as steering* (anti-rationalization tables, repeated safety boundaries). Test: would collapsing it weaken the steering? If yes, it is intentional, not duplication.
5. **Completion criteria** (long-horizon skills only — fix-bug/cover/experiment/develop and peers) — Flag steps whose done-condition is vague ("understanding reached") rather than **checkable AND exhaustive** ("every modified file accounted for"). Vague bounds invite premature completion.

## Report

Group flags by skill, then by check. Per flag:

```
SKILL:    <path>
RULE:     CSO | size | no-op/sediment | duplication | completion-criterion
WHERE:    <line / section>
WHY:      <one line>
SUGGEST:  collapse | move-behind-pointer | cut-sentence | sharpen-criterion | verify-then-prune
```

End with a per-skill verdict — `clean` | `minor` | `real-fix` — and a corpus summary when sweeping. Recommend nothing be auto-applied; a human decides each flag.

`STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED` on its own final line (Subagent Status Protocol).
