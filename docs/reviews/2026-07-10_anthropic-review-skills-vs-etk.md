# Anthropic's bundled review skills vs. our etk review stack

> Research brief · 2026-07-10 · via `/etk:auto-research` (routed to source-extraction, not web)
> Ground truth: Anthropic's `code-review` / `review` / `simplify` / `security-review` / `verify` were
> extracted **verbatim from the compiled Claude Code binary** (v2.1.187; descriptions match live v2.1.205).
> They are **native commands compiled into the binary**, not on-disk `SKILL.md` files — only `verify`
> and `security-review` are authored as markdown; `code-review`/`simplify`/`review` are assembled from
> JS template constants at runtime.

## TL;DR

- Anthropic's built-ins are a **local, working-tree / diff-scoped** review layer (pre-commit, on your machine). Our **etk** stack is the **MR/PR, team, policy, posting** layer. They **compose** — they are not competitors.
- Their `code-review` is a beautifully compact, **effort-tiered** (`low→max→ultra`) single skill built on a sharp **finder-angle taxonomy + adversarial 1-vote verify + sweep**. Our `review-mr` is a heavier **7-phase pipeline** with domain agents, policy config, evidence gating, composite grading, and a YAML→human-edit→post workflow on **both GitLab and GitHub**.
- **We are ahead** on: dual-VCS inline posting, policy/CI/incremental/spec modes, composite grading, business-invariants, HIPAA. **They are ahead** on: the crisp finder-angle prompts, `--fix`/`simplify` auto-apply, and a genuinely different **runtime-observation `verify`**.
- **One awkward finding:** our `/etk:verify` and Anthropic's `/verify` have the **same name and opposite philosophies** — ours runs tests/lint/typecheck; theirs explicitly forbids that and demands *running the app*. See §6.

---

## 1. What Anthropic's review family actually is

Five native commands (not editable skill files):

| Command | One-liner | Shape |
|---|---|---|
| **`code-review`** | Review the current diff for bugs + cleanups at an effort level | Effort-tiered `low/medium/high/xhigh/max/ultra`; finder-angles → verify → sweep; `--comment` (GitHub inline), `--fix` (apply to tree); `ultra` = cloud multi-agent |
| **`review`** | Review a GitHub PR | Thin wrapper that fetches a PR diff via `gh` and runs the **medium** `code-review` pipeline |
| **`simplify`** | Clean up changed code without changing behavior, then apply | 4 cleanup agents in parallel (Reuse/Simplification/Efficiency/Altitude) → **applies fixes**; explicitly *not* a bug hunt |
| **`security-review`** | Security review of branch changes | HIGH-confidence (>80%) vuln scan; huge false-positive exclusion list + precedents; sub-task fan-out; markdown report |
| **`verify`** | Confirm a change works by **running the app** | Runtime observation; **"Don't run tests. Don't typecheck."**; surface table; drive→probe→capture; PASS/FAIL/BLOCKED/SKIP |

### `code-review` internals (the interesting part)

- **Effort ladder** (self-describing header on each tier):
  - `low` → 1 diff pass, no verify, ≤4 findings, no subagents (hunk-only, skips tests/fixtures)
  - `medium` → 3 correctness + 3 cleanup + altitude + conventions angles × 6 candidates → 1-vote verify → ≤8
  - `high` → same but recall-biased verify → ≤10
  - `xhigh`/`max` → **5** correctness angles × 8 candidates → verify → **sweep** → ≤15
  - `ultra` → the cloud/workflow-backed variant (the `/ultrareview` we already reference)
- **Finder angles** (each a separate subagent):
  - **A** line-by-line diff scan · **B** removed-behavior auditor (name the invariant each deleted line held; find where it's re-established) · **C** cross-file tracer (callers/callees) · **D** language-pitfall specialist · **E** **wrapper/proxy correctness** (a cache/proxy/decorator that routes back through a registry/session instead of the delegate — recurses/re-enters)
  - Cleanup: **Reuse** (re-implements an existing helper) · **Simplification** · **Efficiency** (incl. closure-captured long-lived objects = memory leak) · **Altitude** (right depth, not a bandaid) · **Conventions** (check diff against the governing **CLAUDE.md** files — quote the exact rule + line, no vibes)
- **Verify (Phase 2):** one verifier per candidate, returns **CONFIRMED / PLAUSIBLE / REFUTED**; keep non-REFUTED. Recall tiers default to PLAUSIBLE unless refutable from the code.
- **Sweep (Phase 3, xhigh/max):** a fresh reviewer looks *only* for gaps the first pass missed.
- **Output:** JSON `{file, line, summary, failure_scenario}`, most-severe first, correctness outranks cleanup.

### `security-review` internals

A markdown SKILL with an unusually **disciplined false-positive regime**: >80% confidence floor, ~17 hard exclusions (DOS, disk secrets, rate-limiting, outdated deps, log spoofing, path-only SSRF, React/Angular XSS unless `dangerouslySetInnerHTML`, client-side authz, shell-script cmd-injection, notebooks…), ~12 precedents, and a 3-step sub-task flow (find → parallel FP-filter → keep confidence ≥8). Output is a fixed markdown vuln format.

---

## 2. What we have (etk)

| Ours | Role | Notable strengths |
|---|---|---|
| **`review-mr`** | 7-phase MR/PR review pipeline | Quick/standard/deep/incremental/spec/**ci** modes; domain-aware agent selection; risk scoring; evidence gate; **composite grade**; policy config; **dual-VCS** (glab+gh); delegates posting |
| **`code-review-playbook`** | The shared review "library" review-mr loads | Conventional comments (labels+decorations), structured findings w/ confidence tiers + anti-FP rules, **business-invariants**, architectural-dimension rubric, checklists |
| **`post-mr-comments`** | Inline-anchored posting | Posts to **GitLab discussions AND GitHub PR review comments**; YAML→post; dry-run; anchored/fallback tracking |
| **`quality-reviewer`** (agent) | Bug/security/perf/lint/type/coverage specialist | Dispatched by review-mr |
| **`verify`** (etk skill) | Tests + lint + typecheck evidence | Stack auto-detect, streak gate, structured evidence |

Our `review-mr` **already positions** two of Anthropic's built-ins as complementary: it cites `/ultrareview` (cloud) and `/security-review` (fast security-only) in its own SKILL.md.

---

## 3. Head-to-head

| Dimension | Anthropic `code-review` | etk `review-mr` |
|---|---|---|
| **Scope** | Working-tree / diff (local, pre-commit) | MR/PR (post-push, team) |
| **VCS posting** | `--comment` = **GitHub only** | **GitLab + GitHub** inline (via post-mr-comments) |
| **Tiering** | `low→max→ultra` effort ladder, one skill | quick/standard/deep/incremental/spec/ci modes |
| **Verify** | 1-vote CONFIRMED/PLAUSIBLE/REFUTED | confidence 0–100 tiers + anti-FP rules + evidence gate |
| **Auto-apply** | **Yes** (`--fix`, and `simplify`) | **No** — report → human edits YAML → posts |
| **Grading** | severity-ranked list | **composite letter grade** + blocking gate |
| **Config** | fixed pipeline | policy JSON (thresholds, weights, escalation) |
| **Domain awareness** | generic angles | domain-selected agents + HIPAA + business-invariants |
| **CI mode** | — | `--ci` fail-closed, machine-readable JSON |
| **Cleanup pass** | first-class angles + `simplify` auto-apply | inside agents, report-only |

---

## 4. Where each is genuinely better

**Anthropic ahead:**
1. **Finder-angle taxonomy** — the A–E correctness angles + Reuse/Simplification/Efficiency/**Altitude**/**Conventions** decomposition is sharper and more explicit than our agent prompts. Angle **E (wrapper/proxy correctness)** and the **Conventions (CLAUDE.md)** angle are things our prompts don't call out by name.
2. **`--fix` / `simplify` auto-apply** — a "review then fix the working tree" mode we simply don't have.
3. **Runtime `verify`** — see §6; a real capability gap.

**etk ahead:**
1. **Dual-VCS inline posting** — theirs is GitHub-only across `--comment`, `review`, `ultrareview`. Ours posts inline on GitLab too.
2. **The draft-before-post discipline** — YAML artifact → human edit → deliberate post. Safer for team review than auto-`--comment`.
3. **Policy / CI / composite grading / incremental / spec** — none of which the built-ins have.
4. **Domain + compliance** — business-invariants, HIPAA, domain-aware agent selection.

---

## 5. Adoption recommendations (ranked)

1. **[HIGH · cheap] Fold the finder-angle taxonomy into `review-mr`'s agent prompts.** Add explicit **Angle E (wrapper/proxy correctness)** and a **Conventions/CLAUDE.md angle** (quote the exact rule + the exact violating line — no vibes) to `phase-5-agent-prompts.md`. This is a prompt sharpening, not new machinery. (Angle E is exactly the bug-class adjacent to today's rtk proxy work.)
2. **[HIGH · zero-maintenance] Extend the "complementary built-ins" positioning.** review-mr already cites `/ultrareview` + `/security-review`. Add a short note positioning **`/code-review`** (local pre-commit working-tree pass) and **`/simplify`** (cleanup auto-apply) as the *local* layer that precedes an MR-level `review-mr`. Cite-don't-duplicate.
3. **[MEDIUM-HIGH] Resolve the `verify` collision (see §6)** — decide whether to (a) clarify our verify's scope in its description, (b) point users to the runtime `/verify` for behavioral observation, or (c) add a runtime-observation mode / `verifier-*` bootstrap. This is the biggest *capability* gap.
4. **[LOW-MED · philosophical] Auto-apply.** We deliberately keep MR review report-only + human-gated. But for **local working-tree cleanup** (not posting), an apply mode is safe. Likely best handled by **citing `/code-review --fix` and `/simplify`** rather than building our own.
5. **[DON'T] Rebuild the built-ins.** Our value is the MR/PR/team/policy/posting layer. Adopt the *capability* (angles, positioning), not the substrate — same discipline as the rtk and cross-fork adoptions.

---

## 6. The `verify` naming collision (surfacing, not burying)

Our **`/etk:verify`** and Anthropic's bundled **`/verify`** share a name and hold **opposite philosophies**:

| | etk `verify` | Anthropic `verify` |
|---|---|---|
| Method | **runs** tests, lint, typecheck; collects evidence | **"Don't run tests. Don't typecheck."** Build + **run the app**, drive the surface, observe |
| Evidence | green/red check results | stdout / response bodies / screenshots from the *running app* |
| Verdict | all-clear / warnings / failures / blocked | PASS / FAIL / BLOCKED / **SKIP** (no runtime surface) |
| Thesis | CI-readiness signal | *"Running tests proves you can run CI — not that the change works."* |

Anthropic's `verify` explicitly derides the exact thing our verify does ("not as a warm-up, not 'just to be sure'"). Both are legitimate — they answer different questions ("is it green?" vs "does it actually work when run?") — but the **same command name for opposite methods is a real UX trap** for anyone who has both. This is the single most worth-discussing item in this brief.

> Note: this repo *also* has a bundled `verify` skill entry in the session skill list ("exercise it end-to-end and observe behavior… bootstraps this repo's project verify skill") — i.e. the runtime-observation `verify` is already present as a built-in, distinct from `/etk:verify`. The collision is live today.

---

## 7. Method note (auto-research)

Classified as **research**. The suggested route was `/ctk:web-research`, but the authoritative source was the **compiled binary on disk**, extracted via an Explore agent using Glob/Read (Bash `find` on `/private/tmp` is blocked by our own `security-blocker`). Binary extraction beats web docs for "what's in it," so web research was skipped as redundant. Confidence: **high** on content (verbatim), **medium** on version currency (extracted v2.1.187; live v2.1.205 descriptions match).
