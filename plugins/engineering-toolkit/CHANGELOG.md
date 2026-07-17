# Changelog

All notable changes to the engineering-toolkit (`etk`) plugin will be documented in this file.

## [2.15.0] - 2026-07-18 — dispatch ladder: per-route agent-dispatch policy + adversarial-verifier agent

The router (auto-research) knew *which skill* handles a goal, but each skill improvised *how many agents* to throw at it — only `review-mr` and `brainstorming --deep` had written dispatch rules, `develop --parallel` spawned "fresh subagents" with no specialist selection, and the adversarial refute-prompt that caught real defects in 4 consecutive PRs was re-typed by hand each time. Design vetted via a strategy-brief playground; decisions: phased A→D, read-only verifier agent, policy lives in agent-loops.

### Added

- **`agent-loops/references/dispatch-policy.md`** — the dispatch ladder (L0 solo default → L1 single specialist → L2 team fan-out → L3 dynamic `Workflow`), single-sourced: escalation criteria per rung, the route→rung map (pointing at the review-mr/brainstorm dispatch tables as exemplars, not duplicating them), the no-nesting structural constraint, model-economics pointers, and the fan-out failure modes (fan-out theater, silent-return orchestration, wrong-specialist dispatch). The orthogonal axis to the autonomy ladder: *how many minds*, not *how unattended*. L3 stays gated on explicit user opt-in — the ladder must not defeat the `Workflow` gate.
- **`agents/adversarial-verifier.md`** (etk's 5th agent) — codifies the refute-first verification pattern: read-only by construction (no Write/Edit), restates refutation targets, verifies against ground truth (never the author's narrative), cites `file:line` per finding, per-target CLEAN/finding verdicts, SHIP / FIX-FIRST (or CLOSED / NOT-CLOSED) overall.
- **`develop` Phase 4 domain→agent map** (`development-pipeline/SKILL.md` § Parallel Dispatch): tests→`etk:tdd-implementer` · frontend→`ftk:ui-developer` · backend→`dtk:devops-architect` · LLM→`atk:ai-ml-engineer`, honoring each agent's "Do NOT use for" clause, single-message dispatch, worktrees on file collision. **Phase 5 gains an L1 independent-review gate** (adversarial-verifier / quality-reviewer) for non-trivial builds.

### Notes

- Phase D (cheap-tier model pilot) is deliberately NOT shipped — it piggybacks the next planned review wave per the existing pilot-before-flipping rule.
- etk agent count 4 → **5** (CLAUDE.md, marketplace, README reconciled).

## [2.14.1] - 2026-07-17 — fix: /review-mr silently returned nothing (forked return contract)

`/etk:review-mr` runs `context: fork`, so the fork's **final message is the only thing the caller sees**. But the pipeline emitted the synthesized Phase-6 report mid-run and then ended on a terse Phase-7c hand-off block ("✓ Wrote findings… This skill is exiting now") — so the review was buried, not returned. In the common **zero-findings** case (a clean, low-risk PR) there were no artifacts to write and nothing to hand off, so the fork improvised its final message: sometimes the review (worked), sometimes an empty "Skill execution completed" — the review silently lost. This shipped as a real "the review skill returns nothing" failure (observed on PR #32 this session; noted in the 2026-07-17 handoff as a recurring loose thread).

### Fixed

- **Explicit forked return contract** (`review-mr/SKILL.md` § Output): the fork's final message **MUST** be the Phase-6 synthesized report; artifacts (when there are findings) are written *before* the report; the terse hand-off is never the last thing; a bare "completed" is a skill failure.
- **Zero-findings path** now returns the full report directly (empty Concerns + SHIP/APPROVE) and skips artifact-writing — reconciled across `SKILL.md` (§ Output + phase-table row 7), `references/phase-6-synthesis.md` § 6d, and `references/phase-7-artifacts.md` (intro, § 7c, hard-exit). Independent review verified all four spots agree and no "write artifacts → exit" residue remains.

> Docs/prompt-contract fix only — no code, no `dist`. Behavioral confirmation lands the next time `/etk:review-mr` runs on an installed build carrying this change.

## [2.14.0] - 2026-07-17 — unattended-run governance: two execution contexts, corrected settings-inheritance premise

The 2.13.0 routine docs pointed to a "pending governance-defaults effort" and implied the `.claude/settings.json` model/permission floor would govern routines. Grounding against Claude Code's routines + model-configuration docs proved that premise **false**: `/schedule` **cloud** routines run on Anthropic-managed VMs and do **not** read local `.claude/settings.json` — only server-managed settings reach them, and they run with no permission-mode picker or approval prompts. A governance doc written on the old premise would have shipped guardrails that never load.

### Added

- **`auto-research/references/unattended-governance.md`** — a two-context governance map. **In-session unattended** (`/loop`, `--unattended`, `CronCreate`) honors `.claude/settings.json`, so the `hard_deny` baseline + `enforceAvailableModels` apply (but `soft_deny` is "prompt before" → near-useless with no human). **Cloud routine** (`/schedule`) reads only server-managed settings and is governed by its creation-form scopes: per-routine model selector (cost pin), network access, connector minimization, "unrestricted branch pushes" OFF (→ `claude/` branches), and a propose-only prompt (no approval prompts exist). Includes a rung→control mapping per context and an explicit **"unverified — test before relying"** box for the CC behaviors the docs don't confirm (`autoMode.*` effect on routines, `soft_deny`-with-no-human, `enforceAvailableModels` on routines beyond the selector).

### Fixed

- **`routine-recipes.md` § Governance** — point 2 (shipped in 2.13.0) implied the settings.json floor becomes "the enforced default set for routines." Corrected to the two-context reality and repointed to `unattended-governance.md`.
- **root `CLAUDE.md` § Model & MCP governance** — added a note that those keys govern *local* sessions; cloud routines need **server-managed** settings + creation-form scopes.

## [2.13.0] - 2026-07-17 — routine recipes: skill→routine-safety classifier + BUY-NOT-BUILD scheduling

The autonomy docs mapped the ~6 auto-research *routes* to rungs, but never answered "can I run **this** skill as a scheduled routine, and how?" — the question an installer with ~85 skills actually asks. This adds that layer without adding machinery: routines ride Claude Code's native `/schedule` (persistent cloud routines) and inherit the existing rungs and rails unchanged.

### Added

- **`auto-research/references/routine-recipes.md`** — a new reference with four things that existed nowhere: (1) **buy-not-build** framing — `/schedule` (the claude.ai triggers API, persistent cloud routines) *is* the scheduler; we ship recipes over it, not a daemon; (2) a **skill→routine-safety classifier** — the rule ("produces a report/proposal from observable state with no human in the loop; writes only a ledger") plus the routine-worthy L1 shortlist (`audit-skill`, `verify`, `review-mr`, `doctor`, `check-maintenance`, `continuity-metrics`, `review-stats`, and the by-intent reporters `hipaa-compliance-checker`/`investigate-sentry`) and the three "not routine material" buckets (knowledge libraries, interactive orchestrators, setup/one-shot); (3) scheduled routine recipes with the **nightly `/etk:audit-skill` (L1, read-only)** flagship; (4) a governance handoff to the pending unattended-runs work.
- One pointer line each from `autonomy-ladder.md`, `recipes.md`, and `auto-research/SKILL.md` → the new file. Cite-don't-duplicate: the new file restates **zero** rung definitions, rails, or cadence numbers.

### Fixed

- **Doc-honesty correction** in `unattended-mode.md` and `auto-research/SKILL.md`: both claimed `CronCreate durable:true` persists "across sessions" via "the `/schedule` path". The live `CronCreate` schema is unambiguous — `durable` is a **no-op**, all jobs are session-only, and recurring jobs auto-expire after 7 days. Persistence comes from `/schedule` **cloud routines** (`RemoteTrigger`), a distinct substrate. Split the two flavors correctly so the sibling docs stop contradicting the new one.

## [2.12.0] - 2026-07-17 — four new router routes (ship · triage · compliance · audit-skill) + two tiebreaks

`/etk:auto-research` classified goals into 10 categories across 8 target skills. Four capabilities it should already have reached were unroutable: you could say *"ship it"* or *"is this HIPAA compliant?"* and the router had nowhere to send you. All four targets already carried the trigger vocabulary — no new keywords were authored, only wiring.

### Added

- **`ship` → `/prepare-pr`** (*"ship it"*, *"ready for review"*, *"open a PR"*). The highest-value addition and **the only write-route**: it commits, pushes, and opens the MR/PR. It **gates itself** — `prepare-pr/SKILL.md:17` requires human approval of the drafted body before creating anything — so the router must **not** pass `--no-confirm` through. The router's job is to reach the skill, not to defeat its safety.
- **`triage` → `/investigate-sentry`** (*"sentry issue"*, *"sentry triage"*). Writes an assessment doc; proposes a fix rather than applying one.
- **`compliance` → `/hipaa-compliance-checker`** (*"is this compliant?"*, *"PHI"*, *"BAA"*). Analysis-only.
- **`audit-skill` → `/audit-skill`** (*"skill quality"*, *"prune skill"*, *"sediment"*). The safest possible route — the skill declares `disallowed-tools: Edit/Write/NotebookEdit`, so it is structurally incapable of editing what it audits.
- **Four disambiguation rules**, because the table is applied top-down and three of the four new routes are shadowed by an earlier row on a bare keyword match:
  - **`ship` vs `review`** — the widest collision: `review` sits 6 rows earlier and owns "PR / pull request / review", substrings of nearly every `ship` signal. Does the MR/PR already exist? No → `ship`; yes → `review`.
  - **`triage` vs `fix`/`diagnose`** — `fix` is the **first row** and owns "error", which sits inside `triage`'s own "production error". **The Sentry ID is the tiebreak, not the verb** — present → `triage`, overriding both.
  - **`compliance` vs `verify`** — `verify` owns "check" and sits earlier. A HIPAA/PHI/BAA term present → `compliance`.
  - **`audit-skill` vs `improve-skill`** — both target a `SKILL.md`. *Judging* quality → `audit-skill` (read-only); *changing* the skill → `improve-skill` (mutates, 5-iter budget, human gate).
- Parameter-extraction sections for all four routes in `references/routing-rules.md`, plus disambiguation rules 10–12.

### Fixed

- **The routing map had leaked back into two more places** — the exact drift root `CLAUDE.md:381` names *this skill* as the cautionary example for ("auto-research once encoded its routing map in three places"). The 2.8.3 pass collapsed three encodings inside the skill body but left two outside it: the **frontmatter `description`** and the **command wrapper's `description`** both enumerated all 8 targets, and both went stale the moment a route was added. Neither drove discovery (the `Triggers on:` clause does that) and a model-invoked description is permanent per-turn context rent — so both are now generic ("routes it to the right etk/ctk skill"). The Intent Classification table is the only place the *routing map* exists.
- **A hardcoded route count** — Phase 1 step 2 said *"Classify into one of **10** intent categories"*, which this change would have silently falsified. Replaced with a pointer to the table; the count is no longer restated anywhere.

### Notes

- **Adding a route touches three tables, not one.** The routing *map* (category → target) is single-sourced in the Intent Classification table, but Phase 4 (heartbeat) and Phase 5 (report sections) are keyed **by target** and needed rows for all four new routes — they had silently gone stale, still listing exactly the pre-PR 8. Both now carry an explicit **fallback line** ("any route not listed: single-pass / delegate to the skill's own format") so the next route added is a one-place edit again.
- **Route count is now 14 categories → 12 distinct targets** (some categories share a target: `fix`/`diagnose` → `/fix-bug`, `optimize`/`improve-skill` → `/experiment`).
- **`zoom-out` was deliberately NOT routed.** *"What's the architecture here?"* maps to it perfectly, but it is the only skill in the corpus declaring `disable-model-invocation: true`, justified in-file and explicitly honored by `fix-bug/SKILL.md:59` ("surface the suggestion, don't auto-fire"). Routing to it would reverse a decision documented in two places.
- **No routes from atk (25 commands), dtk, or ftk.** Their commands are *knowledge libraries*, not processes — "build a RAG pipeline" should route to `/develop`, which then loads `atk:rag-retrieval` as context. A router dispatching to a reference doc is a category error, not a missing feature.

## [2.11.0] - 2026-07-17 — real worktree isolation for parallel agents; stop claiming a mitigation we didn't ship

`/etk:start-parallel` runs several agents concurrently against **one shared working tree**, with `.squad/locks/` as the only thing between two agents and a corrupted file — and those locks are advisory: nothing enforces them, so an agent that never checks simply overwrites. Meanwhile the failure-modes table *claimed* worktree isolation we did not implement. This makes the isolation real and the claim honest.

### Added

- **A worktree per agent in `/etk:start-parallel`** (new Step 2). Each terminal gets its own checkout and branch via `git worktree add`, so collision is structurally impossible rather than merely discouraged; `.squad/` locks drop to belt-and-braces. Coordination state (`locks/`, `comms/`) stays shared via `SQUAD_DIR` — only the *code* is isolated. ctk's `WorktreeCreate` hook fires on each, seeding per-agent continuity.
- **Portable teardown**, verified on **git 2.15**: `rm -rf` + `git worktree prune` + `git branch -d`. `git worktree remove` requires **git ≥ 2.17** and is documented as the newer-git equivalent, not the only path — it does not exist on the git shipped with some LTS distros and Xcode CLI tools. Order is called out too: `git branch -d` refuses while the branch is still registered to a worktree, so prune first.

### Fixed

- **`loop-failure-modes.md` claimed a mitigation that did not exist.** Mode 9 (Parallel Collision) listed `` `Workflow` `isolation: 'worktree'` `` as active, strength **"structural + worktree"** — but `grep -rn "git worktree add"` returned **0 hits** and no code configured `isolation`. A guardrail table that overstates coverage is worse than no table: it is exactly what a pre-flight check consults before letting a loop run unwatched. Now claims **structural** (every etk agent excludes `Agent`/`Task`, so a routed skill cannot spawn colliding children at all — we buy collision-safety by *forbidding* fan-out, not by isolating it), plus worktree specifically in `start-parallel`. `Workflow` `isolation: 'worktree'` is noted as the native lever *if* we ever ship `agent()` fan-out; we ship none today.
- **`start-parallel.md` shipped bash that cannot execute.** The lock dashboard's `for lock in .squad/locks/*.lock 2>/dev/null; do` is a syntax error (a redirect is not valid in a `for` list) — proof the block had never been run. Fixed; the `[ -f ]` guard already handled the no-matches case. All 13 bash blocks in the file now pass `bash -n`.
- **`commands/develop.md` pointed at a path that does not exist** (`.claude/skills/development-pipeline/SKILL.md`) and listed **pre-Hypothesize phase numbering** (Plan as Phase 2, Verify as Phase 4) against a skill that has had 6 phases since Hypothesize was added. Both would misdirect anyone running `/etk:develop`. Now names the skill (matching sibling commands) and lists all 6 phases.

### Notes

- Isolation was **verified, not asserted**: a probe worktree was created, written to, and confirmed not to leak into the main tree, then torn down with zero residue — on this machine's actual git 2.15.
- Reading the doc would not have caught the teardown bug. This is the `loop-failure-modes` pre-flight discipline applied to itself: *"if you haven't run the task node-by-node by hand once, you haven't found the failure points."*

## [2.10.0] - 2026-07-10 — adopt Anthropic's review-skill patterns into the review process

Capability adoption from Anthropic's bundled `code-review` / `simplify` / `security-review` / `verify` skills (extracted from the Claude Code binary and compared in `docs/reviews/2026-07-10_anthropic-review-skills-vs-etk.md`). Sharpens `review-mr` and disambiguates `verify` — **capability, not substrate** (the built-ins are cited, never rebuilt). Documentation/skill-definition only — no runtime hook behavior changed, no `dist` rebuild.

### Added

- **Finder-angle taxonomy** (`code-review-playbook/references/finder-angles.md`, new): single-sourced correctness angles **A–E** (line-scan, removed-behavior auditor, cross-file tracer, language pitfalls, **wrapper/proxy correctness**), cleanup angles (Reuse / Simplification / Efficiency / Altitude), and a **Conventions (CLAUDE.md)** angle (quote the exact rule + line, no style vibes). Wired into the always-launched Code Quality agent and referenced from `review-mr` Phase 5 so every agent hunts with the relevant lenses.
- **Security-finding precedents** in `false-positive-filtering.md`: a curated validity gate (framework-safe XSS, client-side authz, trusted env/CLI inputs, path-only SSRF, DOS out of scope, memory-safety in memory-safe languages, test/docs-only) so the Security agent raises only concrete, exploitable findings — complements (does not weaken) the existing "security is never downgraded" exemptions.

### Changed

- **`review-mr` positioning**: added a **local pre-commit layer** note positioning CC's built-in **`/code-review`** (working-tree diff pass, `--fix`/`--comment`) and **`/simplify`** (auto-applied cleanup) as the local layer that precedes an MR-level `review-mr` — alongside the existing `/ultrareview` + `/security-review` cross-references. Cite-don't-duplicate; `review-mr` keeps the policy/grading/dual-VCS-posting layer the built-ins lack.
- **`verify` disambiguation**: `/etk:verify` (static checks — tests / lint / typecheck evidence) vs the built-in `/verify` (runtime observation — runs the app, drives the surface) are now explicitly positioned as **complementary** (same name, opposite method), resolving the collision. The runtime-observation capability is deliberately **not** rebuilt.

## [2.9.0] - 2026-07-09 — new `/etk:prepare-pr` skill (VCS-agnostic) + pipeline wiring (cross-fork adoption)

Cross-fork adoption from the internal toolkit fork. Adds a standardized MR/PR authoring skill and wires it into the pipelines. Adopted **VCS-agnostic** (GitHub `gh` + GitLab `glab`), unlike the fork's GitLab-only version. Documentation/skill-definition only — no runtime hook behavior changed.

### Added

- **`/etk:prepare-pr`** — authors a standardized, structured MR/PR description (**Background** · **High-Level Design** with an API/Infra/Schema/UI/Data change table + mermaid sequence · **Pitfalls & Regressions**) from the branch diff, commit log, and linked ticket; drafts the body **to a file** (output-budgeting rule), runs a HIPAA/PHI redaction pass, gates on human approval, then opens the MR/PR on the detected host (`gh pr create` / `glab mr create`, mirroring review-mr's Phase-0 host switch) and **hands off** (never auto-runs or merges) to `/etk:review-mr` → `/etk:post-mr-comments`. Skill-only (no command wrapper), consistent with the review-mr/post-mr-comments family. Ships `SKILL.md` + 3 references (`description-template`, `section-authoring`, `create-pr-recipe`). Carries none of `/fix-bug`'s bug-only assumptions.

### Changed

- **`/develop`** (command + development-pipeline SKILL Phase 5) — now offers to open the MR via `/etk:prepare-pr` (reusing the Phase-4 verify result), replacing the imprecise "create MR with `/review-mr`" (review-mr reviews an *existing* MR; it never created one).
- **`/fix-bug`** (command Phase 5) — delegates MR authoring + creation to `/etk:prepare-pr` instead of a hardcoded Summary/Changes/Test-Plan heredoc; bug MRs now carry the standard Background / High-Level-Design / Pitfalls description.
- **review-mr Phase 1b** — grades the description against the standardized three-section contract (Background / High-Level Design / Pitfalls) instead of the old ad-hoc checklist, and no longer penalizes a body for lacking a prose "testing approach" section (testing is gated by `/etk:verify` upstream).

### Fixed

- De-fingerprinted `commands/fix-bug.md`: replaced the company Jira project key (`NAPP-###` → `PROJ-###`), the bug label/branch convention (`fixie/…` → `fix/…`), and the hardcoded integration branch (`dev` → the repo's integration branch / resolved target) with neutral placeholders — keeping the command domain-agnostic.

## [2.8.3] - 2026-07-02 — cross-fork adoption: `/etk:audit-skill` + skill-hygiene governance + auto-research single-sourcing + reference-repair sweep

> Ports the company work-copy's etk 2.8.0 + 2.8.1 work into Claude Forge. Because the two forks diverged (Claude Forge already carried the fork's older 2.7.0 auto-research audit as its own 2.8.0, plus 2.7.3–2.7.6 recipe/triple-ceiling/unattended work the fork lacks), each change was re-verified against Claude Forge's **current** files and **merged on top of** them rather than overwritten — via a 10-agent read-only cross-fork diff. Domain-agnostic guardrail held: for the shared `coding-standards` / `testing-strategy-builder` skills only `SKILL.md` was touched; the fork's `member`/`coach`/wellness-fingerprinted satellite files were **not** synced (Claude Forge's neutral satellites stand). Skill-definition + docs only — no runtime hook behavior changed, no `dist/` rebuild.

### Added

- **`/etk:audit-skill`** — new skill + command. Audits any `SKILL.md` against the repo's Skill Authoring Rules and emits *candidate flags* for human review (CSO compliance · >150-line progressive-disclosure review · no-op/sediment/duplication · completion criteria). Read-only by design (`disallowed-tools: Edit/Write/NotebookEdit`) — never edits or deletes; points back to root `CLAUDE.md` as the single source of truth rather than restating the rules. Brings etk to **25 skills / 20 commands**.
- **Skill-hygiene governance (root `CLAUDE.md`)** — folded in three net-new authoring rules (a context-load/"context-rent" rationale on CSO; a no-op/sediment pruning discipline **with** a repetition-as-steering carve-out; checkable-and-exhaustive completion-criterion guidance) + a soft >150-line progressive-disclosure review flag, and added the recurring `/etk:audit-skill` gate to the Release Checklist. Adapted from Matt Pocock's `writing-great-skills` (mattpocock/skills, MIT). Fixed a typo carried in the source ("every modified *model*" → "every modified *file*").

### Changed

- **auto-research routing single-sourcing** — collapsed the routing map from three overlapping authoritative encodings (the When-to-Use table, the ASCII Routing Decision Tree, the Intent Classification table) to **one**: the Intent Classification table is now authoritative and the other two are explicit derivative pointers, so adding a route is a one-place edit. Merged against Claude Forge's diverged copy — all Claude Forge-only sections (Stop-Conditions, Recipe Presets, Unattended/Propose-Only Mode, the triple ceiling / `--tokens`, the `Connected MCP sources` note, the autonomy-ladder pointer) preserved verbatim. Added an Advanced-Modes maturity note **adapted** to include Claude Forge's live `--unattended` mode (which the fork lacks).

### Fixed

> A reference-repair sweep surfaced by the `/etk:audit-skill` audit — seven skills carried pointers that resolved to nothing, orphaned satellites nothing pointed to, or a self-contradictory default. Each defect was re-confirmed present in Claude Forge's current copy before fixing.

- **security-checklist**: repointed 18 dead `references/` pointers to the real, previously-orphaned `checklists/owasp-top-10-checklist.md`; dropped the compliance pointer with no target (the inline GDPR/SOC2 checklist stands); corrected the false "963 → 245 lines" footer.
- **testing-strategy-builder**: repointed 12 dead `references/` pointers (incl. a phantom `framework-specific/` dir and `../../instructions/test-selectors.md`) to the real `references/code-examples.md`; removed pointers with no target; corrected the false "485 → 290 lines" footer. (This also removed a stray `platform patterns` fingerprint line.)
- **quality-gates**: wired the orphaned `templates/` worksheets (gate-check, complexity-assessment, requirements-checklist) into the Templates section; removed two dangling pointers to a non-existent `breakdown-template.md`.
- **architecture-decision-record**: wired the orphaned `checklists/adr-review-checklist.md` into a new "Reviewing an ADR" section.
- **experiment**: aligned the `max_iterations` default — SKILL.md/playground said 10 while `config-schema.md`/`safety-guardrails.md` said 20 (now 20 everywhere, incl. `playground.html`).
- **coding-standards**: made the Quick Reference the single source for the numeric limits — collapsed the redundant "Standards by Check Type" re-listing and pointed the per-language quick-checks at it.
- **evidence-verification**: made `references/quality-standards.md` the single source for tier thresholds; SKILL.md now summarizes and defers instead of restating the numbers (which had already drifted: `>70%` vs `>=70%`).

## [2.8.2] - 2026-06-27 — loop-engineering adoption: failure-mode checklist + autonomy ladder

> Adopts the three genuinely net-new ideas from `cobusgreyling/loop-engineering` (MIT) as cite-don't-duplicate reference docs that index machinery this repo already ships. A 24-agent adversarial research pass found ~11 of 14 loop-engineering concepts already covered (often more strictly — review-mr's checker auto-downgrades unverified findings; the `--tokens` ceiling hard-stops mid-run); its three npm CLIs were declined as domain-coupled dev substrate. Skill-content only — no hook/`dist` change.

### Added

- **Loop failure-mode checklist** (`agent-loops/references/loop-failure-modes.md`) — the 10 named loop failure modes (Infinite Fix Loop, Verifier Theater, Token Burn, Over-Reach, Escalation Failure, …) as a pre-flight checklist, each cross-linked to the guardrail etk/ctk already enforces against it (experiment stuck-detection + readonly allowlists, the unattended hard token cutoff + blocker-stop, review-mr's evidence gate + checker, ctk security-blocker). Wired into the `agent-loops` SKILL.
- **Autonomy ladder** (`auto-research/references/autonomy-ladder.md`) — names the L1 (report-only) → L2 (propose-don't-apply) → L3 (confirmed write-loop) rungs that already ship scattered across `unattended-mode`/`experiment`/`self-improvement`, with a route→rung map and evidence-based promotion gates. Wired into the `auto-research` SKILL Reference Files.
- **`pr-review-watch` recipe** + an **operational-profile table** (cadence / start-rung / token-cost) for every preset in `auto-research/references/recipes.md`. `pr-review-watch` rides `/review-mr` + `/loop` to babysit open PRs. Notes that `error-sweep` already covers loop-engineering's Issue-Triage / CI-Sweeper intent, and that its Changelog-Drafter / Post-Merge-Cleanup / Dependency-Sweeper patterns are skill gaps (no backing skill), not recipe gaps.

## [2.8.1] - 2026-06-26 — atlassian-integration: MCP authentication note

Adds an MCP-auth note to the `atlassian-integration` skill (CC alignment v2.1.193): authenticate the Atlassian MCP server with `claude mcp login atlassian` (CC v2.1.186), the startup notice when a server needs auth, and automatic reconnect on transient 401/403 (CC v2.1.191/193). Skill-content only; no hook/dist change.


## [2.8.0] - 2026-06-25 — auto-research: real `research` route + orchestration-contract hardening

> Ports the company work-copy's auto-research process audit (P0 + P1) into Claude Forge, **merged on top of** our existing recipe / triple-ceiling / unattended-mode work (2.7.3–2.7.6) rather than overwriting it. Skill-definition only — no runtime hook behavior changed, no `dist/` rebuild.

### Added

- **`research` route (P0)** — promoted the decision tree's dangling "Generic research" leaf to a first-class `research` intent that hands off to `/ctk:web-research` (escalating to the `deep-research` harness for multi-source, adversarially-verified reports). Adds an intent-table row + signal words, when-to-use + quick-start examples, a `routing-rules.md` route section + TOC entry + disambiguation rules 8/9, 4 `intent-benchmark.json` entries, and heartbeat / Result / budget / Related-Skills coverage. Reconciled "8 intent categories" → 10.
- **`--resume` flag** — resume an interrupted run from the last reported state.
- **Model-economics guardrail** — Safety & Budget Enforcement notes auto-research is the highest-fan-out entry point and must not spawn children that undercut the repo's model-economics guidance. Adapted to Claude Forge's advisory "Model economics for subagent dispatch"; the company's *enforceable* governance layer (`enforceAvailableModels` / Fable soft-deny) is not yet in this repo (separate adoption).
- **Interrupt & clean-state contract** — auto-research performs no rollback of its own; relies on the target skill's clean-exit guarantee, warning for routes (`/develop`, `/brainstorming`) that lack one.

### Changed

- **Fan-out cost front-loaded (P1)** — the Phase-2 plan format and Phase-3 confirm box gained a `Fan-out:` line so a multi-agent dispatch (e.g. `design`→~11 agents) is approved deliberately, not blind.
- **Canonical multi-agent dispatch phrasing (P1)** — Phase-4 step 1 now says "dispatch all agents in a single response by emitting multiple Agent tool calls in the same message" for fan-out routes (prevents serialization).
- **Fail-loud blocker surfacing (P1)** — Phase-4 step 4 defines what counts as a blocker and emits a canonical `STATUS:` line alongside the human-readable `Result:` enum (now includes `RESEARCH_COMPLETE`).
- **`--no-confirm` scoped (P1)** — honored only for read-only/single-pass routes (`verify`, `review`, `research`, `--dry-run`, `--replay`); ignored for write routes.

### Preserved (Claude Forge-specific, absent from the company copy)

- Triple ceiling (iterations / minutes / **tokens**), recipe presets, and unattended / propose-only mode were kept intact — the audit deltas were merged on top, not overwritten.

## [2.7.8] - 2026-06-25 — rebrand to Claude Forge

Suite renamed `claude-dev-kit` → **Claude Forge**. Updated repository/homepage URLs, the `continuity-recommendation` hook's install hint (`/plugin install ctk@claude-forge`), and install commands; dist rebuilt. Re-add the marketplace and reinstall as `etk@claude-forge`.


## [2.7.7] - 2026-06-24 — genericize company-specific domain references

Part of a monorepo-wide pass removing company-specific domain references and genericizing example data across every plugin. Skill-prose only (no hook/dist rebuild).

### Changed

- **Genericized engineering skill examples** — removed company member/coach references and company repo paths from `hipaa-compliance-checker` (checklist + templates), `investigate-sentry` (PHI examples), `fix-bug`, `review-mr`, `post-mr-comments`, `develop`, and `auto-research`.

## [2.7.6] - 2026-06-22 — auto-research: unattended / propose-only watcher mode

Phase 2 (first PR) of adopting OrchestKit's loop capabilities in our idiom (capability, not substrate — see `docs/plans/2026-06-21_adopt-loop-capabilities-roadmap.md`, roadmap item R4). Skill-prose only (no hook/dist rebuild). Adopts ork's `ci-sentinel` value — a background watcher that observes and reports — without ork's substrate (no daemon, no server, no coordination DB).

### Added

- **Unattended / propose-only mode — `/auto-research --unattended <goal>`.** Runs the loop as a background watcher that self-schedules on CC-native primitives (`ScheduleWakeup` session-bound, default; `Cron` / `/schedule` persistent), re-checks state freshly each wake, and reports to a findings ledger. Governed by one safety invariant — **propose-don't-apply**: it never mutates source, commits, or pushes; its only write is the ledger. Write-routes (`/cover`, `/experiment`, `/fix-bug`, `/develop`) are degraded to propose-only (change lands in the ledger as a diff with an `apply with:` line). New `references/unattended-mode.md` with the four hard rails, cadence guidance, ledger format, and termination conditions.
- **`--ledger <path>`** — findings-ledger path (default `docs/artifacts/unattended/<goal-slug>.md`, gitignored so propose-only output stays local).
- **`--max-wakeups N`** (default 24) and **`--deadline <ISO-date>`** — bounded-lifetime caps for an unattended run; `--deadline` is kept distinct from the stop-condition selector `--until` to avoid overloading one flag with two value grammars. A loop that can't describe how it ends doesn't run unattended.

### Changed

- **Token ceiling hardens in unattended mode.** The `--tokens` axis of the triple ceiling becomes a **hard mid-run cutoff** (not just a between-iteration check) when `--unattended` is set — the cost brake for running unwatched. Realizes the forward-reference left in 2.7.5 (`SKILL.md` Budget Passing) that this was "Phase 2 of the loop-capability roadmap."
- **Confirmation model under `--unattended`** moves from per-change to once-at-setup: the invocation is the confirmation and implies `--no-confirm` for the iterations — but never permission to apply.

## [2.7.5] - 2026-06-21 — auto-research: recipes, token ceiling, composable stop-conditions

Phase 1 of adopting OrchestKit's loop capabilities in our idiom (capability, not substrate — see `docs/plans/2026-06-21_adopt-loop-capabilities-roadmap.md`). Turns `/auto-research` into the hub for the loop-quality features, all skill-prose (no hook/dist rebuild).

### Added

- **Recipe presets — `/auto-research --recipe <name>`.** Named goal+stop-condition templates (`coverage-90`, `perf-p95-200ms`, `error-sweep`, `docs-drift`, `flake-hunt`) that expand to the right target skill + budget + stop-condition, overridable inline. Adopts ork's loop recipe book through our routing instead of a parallel `/goal` command. New `references/recipes.md` catalog.
- **Token/cost ceiling — `--tokens N`.** The budget is now a **triple ceiling** (iterations / minutes / **tokens**); the loop stops as soon as any one is hit. Adopts ork's budget caps; makes long runs cost-safe.
- **Composable stop-conditions — `--until <goal|streak=N|holdout-wins|budget>`.** First-class, selectable, shown in the plan's `Stop:` line. Includes a global **integrity law**: a stop-condition may only count *fresh* runs, never a stale/cached/skipped prior pass (generalizes the 2.7.4 streak fix).

## [2.7.4] - 2026-06-21 — streak gate hardening: fresh runs only

Hardening of the 2.7.3 streak gate, prompted by researching OrchestKit's parallel work — they shipped the same gate, then hit a race (their #2554) where a stale prior "pass" satisfied the streak with **zero fresh runs**. Our `/cover` had a latent version of that bug via Phase 0 fingerprint caching.

### Fixed

- **`/cover --streak=N` now forces fresh runs.** `--streak` bypasses Phase 0 fingerprint gating for streaked tests — a cached or skipped result (a prior `pass`) can no longer count toward a streak, so a fingerprint-cached test is re-run N times rather than vacuously marked green. Closes a false-green hole where `/cover --streak=3` on an unchanged file ran the test **0 times**.
- **`/verify --streak=N` clarified**: the N runs are N *fresh* executions this pass; no prior or cached result counts toward the streak.

## [2.7.3] - 2026-06-20 — streak gate for verify + cover (flaky-test defense)

Adopted the one genuinely-new pattern from the Forward Future "Loop Library" assessment of OrchestKit (the rest — recipe presets, holdout-promotion, cross-model reviewer — were either redundant with our existing loop engine or deferred; holdout-promotion is being built upstream in ork milestone #161, so we watch-and-adapt).

### Added

- **`/verify --streak=N`** — re-run the test suite N times and report success only if every run passes (typecheck/lint run once, being deterministic). The structured form of "run it again to rule out flakiness"; default `--streak=1` preserves single-pass behavior. See `verify/SKILL.md` Step 2b.
- **`/cover --streak=N`** — a generated test is kept only after it passes N consecutive runs; a test that can't hold the streak is flagged flaky and re-enters the heal loop rather than being counted as green. Composes with `--target` (new tests must hold the streak before their coverage gain counts). See `cover/SKILL.md` Phase 5.

## [2.7.2] - 2026-06-19 — security: review-mr injection defense; trust-boundary notes; sentry scrub

Skills-security audit hardening (`docs/reviews/2026-06-19_skills-security-audit.md`).

### Security

- **`review-mr`**: the MR diff/title/description are now framed as untrusted, attacker-controlled input in the shared agent Scope block (phase 5), with an injection / finding-suppression sanity check in synthesis (phase 6) — a malicious PR can no longer silently steer the review.
- **Trust-boundary notes** added to `atlassian-integration` (MCP-fetched Jira/Confluence content is untrusted) and `cmux` (WKWebView page content is untrusted).
- **`investigate-sentry`**: parameterized the hardcoded company org-slug, 1Password vault path, and example issue ID (work→public sanitization residue) — now uses `<your-org>` / `<your-vault>` placeholders.

### Changed

- **`auto-research` now directs research toward connected MCP sources.** When a goal references internal context (a ticket, an internal doc, a prior decision), the orchestrator consults the session's connected MCP servers (Atlassian, Google Drive, …) as first-class sources alongside web search, discovering tool names via ToolSearch. Pairs with `/ctk:web-research`'s internal-plus-web blend; MCP results are treated as untrusted data.

## [2.7.1] - 2026-06-17 — skill namespacing fix, CSO trigger suffixes, cmux skill

### Fixed

- **`tdd-implementer` agent skill preloads namespaced** with the `etk:` prefix (`coding-standards`, `testing-strategy-builder`, `evidence-verification`), matching the sibling `quality-reviewer` agent and the monorepo namespacing convention. CC silently drops unresolvable bare-name preloads, so the agent was starting without its core domain context.

### Changed

- **CSO `Triggers on …` suffixes added** to 6 skill descriptions (`agent-loops`, `architecture-decision-record`, `evidence-verification`, `quality-gates`, `tool-wrapper-patterns`, `hipaa-compliance-checker`) for better skill discoverability.

### Added

- **`cmux` skill** (24th skill) — drives the third-party `manaflow-ai/cmux` native macOS terminal app via its CLI / Unix socket: workspaces, panes, surfaces, WKWebView browser automation, and the markdown viewer. macOS 14+ only; no-ops safely when the cmux socket is absent, so it is inert for everyone else.

## [2.7.0] - 2026-06-14 — first open-source release

Engineering-practices toolkit: ADR, TDD, code review, quality gates, brainstorming, Sentry investigation, and workflow orchestration. 23 skills, 4 agents, 19 commands.

### Highlights

- **`/etk:review-mr` + `/etk:post-mr-comments` support both GitLab MRs and GitHub PRs.** Reviews fan out to domain-aware agents, then post inline-anchored comments via `glab` (`/discussions`) or `gh` (`pulls/{N}/comments`), with an out-of-hunk top-level fallback and anchor verification. See `code-review-playbook` for the per-VCS recipes.
- MIT licensed.

_First public release at 2.7.0; earlier version history was internal and has been omitted._
