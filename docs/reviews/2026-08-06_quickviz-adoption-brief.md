# Adoption brief — ork `quickviz` → claude-forge

**Date:** 2026-08-06
**Source:** `yonatangross/orchestkit` @ `main` (pushed 2026-08-06T16:27:44Z), **MIT licensed**
**Path:** `plugins/ork/skills/quickviz/` (mirrored at `src/skills/quickviz/`)
**Scope:** research + recommendation only. No files written, no version bumped, no PR.
**Verdict:** **ADOPT AS A NEW SKILL in ftk — not a merge** (one binding decision to relay first)

---

## 1. What `quickviz` actually is (measured, quoted)

Frontmatter, verbatim:

```yaml
name: quickviz
license: MIT
compatibility: "Claude Code 2.1.220+."
description: "Render an answer as ASCII art plus semantic emojis inline, right now, with no setup
  questions. Use for a fast visual take on status, comparisons, trade-offs, architecture, or any
  ad-hoc 'show me X visually' ask. For a full multi-artifact plan playground, use visualize-plan instead."
context: inherit
allowed-tools: [Read, Grep, Glob]
effort: low
complexity: low
user-invocable: true
```

Body, the load-bearing parts:

> **Core principle:** Encode information into structure, not decoration.

> ## Execution (run this, do not ask first)
> The whole point is speed, so there is no setup phase.
> **Render immediately.** Do NOT call `AskUserQuestion` to pick a format, do NOT call `TaskCreate`,
> do NOT spawn an `Agent`. … Asking first defeats the skill.

> **With no argument, the topic is the current conversation.** Measured over a real 13-prompt
> session: zero asks supplied a self-contained topic…

> **Stay honest.** If a number is unknown, print `?` rather than inventing one. A confident-looking
> chart built on guesses is worse than prose.

Ships alongside the SKILL.md: `primitives.json`, `tokens.json`, `tokens.schema.json`,
`test-cases.json`, `CONTRIBUTING.md`, `rules/` (5 files), and **`tests/evals/skills/quickviz.eval.yaml`**.

Its `rules/visual-style.md` defines a **fixed twelve-glyph emoji vocabulary** (✅ ❌ ⚠️ 🔄 ⏸ 💡 🚨 🎯
🔥 📜 🤖 ⚡), paired-only risk/rank glyphs, and a box-drawing palette — with a `single-set` lint rule
enforcing one character set per diagram.

## 2. Overlap table — it is NOT a duplicate

| Dimension | **ftk `ascii-visualizer`** (ours) | **ork `quickviz`** |
|---|---|---|
| Nature | **Craft reference manual** — palettes, alignment, mistakes | **Behavioral dispatch contract** — render now, inline |
| Trigger | Passive; `paths:` gated to `**/*.md`, `**/*.txt`, `docs/**` | Active; user-invocable, no-arg = the current conversation |
| Output target | Diagrams authored **into documentation** | **Inline chat answer**, "never write a file unless asked" |
| Emoji | **None** (0 occurrences measured) | 12-glyph semantic vocabulary, "semantic never decorative" |
| "Don't ask first" rule | **Absent** (0 occurrences of immediately/inline/don't-ask) | Explicit and central |
| Evals | **None** | `quickviz.eval.yaml` + `test-cases.json` |
| Size | 263 lines + `references/` + `templates/` | 9,072 B + 5 rules + 4 JSON files |

| vs `playground` | vs `json-render` |
|---|---|
| No overlap. `playground` builds single-file **HTML** explorers — that is the analogue of ork's *`visualize-plan`*, which quickviz explicitly defers to: *"For a full multi-artifact plan playground, use visualize-plan instead."* | No overlap. `json-render` is generative UI component catalogs. |

**They share the word "ASCII" and almost nothing else.** Ours answers *"how do I draw a good diagram
into this doc?"* Theirs answers *"show me where we are, right now, in the chat."* The second job is
one ftk currently does not do.

## 3. ⚠ The blocking conflict — our own skill forbids their vocabulary

`ascii-visualizer`'s **Common Mistakes** table, verbatim:

| Mistake | Fix |
|---|---|
| Unicode box-drawing chars | Use ASCII only: `+`, `-`, `\|` |

quickviz's palette **mandates exactly what that row forbids**: `┌─┐ │ ┘─└` (light), `╔═╗ ║ ╝═╚` (heavy).

This is a genuine house-style fork, not an oversight to paper over:

- **Our ASCII-only rule** buys maximum portability — renders identically in any font, any terminal,
  any CI log, any proportional-font fallback.
- **Their Unicode rule** buys much better-looking output and is safe in practically every modern
  terminal and on GitHub, at the cost of font-dependence.

**Adopting quickviz as-shipped would silently contradict a rule ftk already states.** That is the
decision to make before any code moves — see §6.

## 4. What is genuinely worth taking

1. **The "render immediately, never ask" contract.** The strongest idea here. A visualization skill
   that interrogates you before drawing has defeated itself — and this is a real failure mode, not a
   hypothetical. Directly relevant to this repo *today*: we just shipped #134, where a skill's
   interactive assumptions were the whole defect.
2. **The topic-shape → form table.** Six rows, maps data shape to diagram form. Cheap, high value,
   and `ascii-visualizer` has nothing equivalent — it organizes by *diagram type*, which assumes the
   user already knows what they want.
3. **"No argument = the current conversation."** Clever, and *measured* ("zero asks supplied a
   self-contained topic") rather than asserted — the evidence standard this repo prefers.
4. **"Stay honest — print `?` rather than inventing."** This is our own culture stated in one line.
   Worth taking verbatim (with attribution) regardless of the rest.
5. **Semantic-not-decorative emoji with a closed vocabulary + PR-to-extend.** The closed-set
   discipline is what keeps it from becoming noise.
6. **The `single-set` lint rule.** We have "mixed box widths" in Common Mistakes but nothing barring
   mixing *character sets* within one diagram.

**Explicitly NOT worth taking:** the `primitives.json` / `tokens.json` / `tokens.schema.json`
substrate. Same call as the two prior ork rounds (ftk 2.3.7 / 2.3.8) — take the ideas, decline the
substrate. It is machinery whose benefit accrues to a maintainer building a token pipeline, not to
an installer who wants a diagram, which fails the end-user adoption lens.

## 5. Incidental finding — our `ascii-visualizer` violates our own CSO rule

Found by comparison, unrelated to the adoption decision but worth a fix:

```yaml
description: "Clear ASCII diagrams for architecture, workflows, tables, and file trees.
  Monospace-safe, aligned box-drawing output"
```

Root `CLAUDE.md` requires a description to **"MUST start with 'Use when...'"** and to **"End with
`Triggers on <keyword1>, <keyword2>`"**. This one does neither — it is pure capability description
with no trigger surface. Since it is model-invoked, it pays permanent per-turn context rent while
being hard to actually trigger.

⚠ Also note it declares no `effort:`, where quickviz sensibly declares `effort: low`.

## 6. ✅ DECIDED 2026-08-06 — (c) SPLIT BY SURFACE

**The character-set rule is split by output surface:**

| Skill | Surface | Palette |
|---|---|---|
| `ascii-visualizer` (existing) | files on disk (`**/*.md`, `docs/**`) | **ASCII only** — `+ - \|` |
| new quickviz-derived skill | **inline chat output** | **Unicode box-drawing** — `┌─┐ │` |

**Rationale:** a committed file may be read in any font, any diff viewer, any CI log; a chat reply is
rendered by one client. The portability argument that justifies ASCII-only for files is genuinely
weak for a chat answer, so the two surfaces get different rules rather than one compromise.

⚠ **The stated cost is the implementation requirement**: the boundary **must be written into BOTH
skills**, not just the new one. A rule that exists in one file and not its neighbour is how the next
author picks the wrong palette — and `ascii-visualizer`'s Common Mistakes row currently reads as
absolute. It needs to be scoped to its surface, which is a small user-visible edit to a shipped
skill and therefore needs a CHANGELOG line of its own.

<details>
<summary>Options as originally presented (for the record)</summary>

**Which character-set rule wins in ftk?**

- **(a) Keep ASCII-only.** Adopt quickviz's *behavior* (render-now, shape→form, honesty, emoji) but
  re-express its palette in `+ - |`. House style stays coherent; output is plainer than ork's.
- **(b) Switch ftk to Unicode box-drawing.** Adopt closer to as-shipped; **amend `ascii-visualizer`'s
  Common Mistakes row**, which is a user-visible behavior change to an existing skill.
- **(c) Split by surface.** ASCII-only for files-on-disk (`ascii-visualizer`'s `paths:` domain);
  Unicode allowed for inline chat output (the new skill's domain). Defensible — the portability
  argument is much weaker for a chat reply than for a committed file — but it means two rules and a
  reader has to know which surface they are on.

No recommendation is forced here; (c) is the most honest to the actual constraint, (a) is the
cheapest, (b) is the most consistent. **This is a house-style call, not a technical one.**

</details>

## 7. If adopted — mechanics

| Item | Value |
|---|---|
| Destination | **ftk** (frontend-toolkit) |
| Form | **New skill**, not a merge into `ascii-visualizer` (different job — see §2) |
| Version | ftk **2.3.14 → 2.4.0** (new skill = minor) |
| Counts | ftk skills **17 → 18** — CI-enforced (check 7), and enumerated lists are checked **by name** |
| Release-checklist sites | all 7: `plugin.json`, `marketplace.json`, ftk `CHANGELOG.md`, ftk `CLAUDE.md`, root `README.md`, root `CLAUDE.md` tree, ftk `README.md` |
| Attribution | MIT — attribute OrchestKit in the SKILL.md and CHANGELOG |
| Cross-links | Add "Related Skills" entries both ways with `ascii-visualizer` and `playground`, so the three-way boundary is navigable |

## 7b. Findings from the remaining rules files (read 2026-08-06)

### There are TWO vocabularies, not one — and the distinction is load-bearing

`visual-style.md` defines **12 emoji**; `status-glyph-vocabulary.md` defines a separate **closed set
of 11 text glyphs**, frozen at v1 with semver rules (12th glyph = MINOR bump; repurposing one =
MAJOR). Measured display widths:

| Vocabulary | Width | Safe inside a bordered box? |
|---|---|---|
| Status glyphs `● ○ ✓ ✗ ⚠ ◆ ◇ ▶ ▷ ↑↓→ ▓▒░` | **all 1 column** | ✅ yes |
| Emoji `✅ ❌ ⚠️ 🔄 …` | **11 of 12 are 2 columns** (only `⏸` is 1) | ❌ **no** |

**This resolves the alignment objection raised at §4/demo.** The rule is *glyphs inside diagrams,
emoji outside them*. ork does not state this explicitly, but the two sets exist for exactly this
split.

⚠ **Caveat ork does not state:** most glyphs are East-Asian **Ambiguous** width (`●○◆◇▶▷↑↓→▓▒`),
so they render **2 columns in CJK terminal locales**. Only `✓ ✗ ⚠ ░` are unconditionally narrow.
The portability risk our ASCII-only rule guards against is real — it is just correctly scoped to
files rather than chat under the §6 decision.

### ⚠ ork's own "Correct" example is misaligned — measured

`ascii-architecture.md`'s flagship *"Correct — layered architecture diagram"* measures **55 / 57 /
56 columns** across its three border lines. All three differ. The same file also mixes Unicode
`┌───┐` (architecture diagram) with ASCII `+---+` (blast-radius diagram) — **violating their own
`single-set` lint rule inside the file that teaches it.**

Not a reason to decline. It is evidence for a specific adaptation: **alignment must be checked
mechanically, not by eye.** Building the demo for this brief, the author misaligned boxes **twice**
and only a width-check caught it. This is the third consecutive ork round where our standard lands
stricter than the source's — consistent with ftk 2.3.7 and 2.3.8.

### Patterns worth taking that were NOT in the SKILL.md

- **Blast Radius Visualization** — concentric rings (changed file → direct → transitive → tests)
  with the file lists underneath. We have nothing like it and it maps directly onto review work.
- **Reversibility Timeline** — phases as fill bars with an explicit `--- POINT OF NO RETURN ---`
  divider between reversible and irreversible. Strong fit for migration and rollout planning.

### Naming convergence

`_sections.md` is titled **"ASCII Visualizer Rule Categories"** — ork's quickviz rules are literally
an *ascii-visualizer* ruleset. Independent convergence on the same concept as ftk's existing skill,
which supports the §2 read that the two are complements rather than duplicates.

## 8. Not verified / open

- ~~I did not read all 5 `rules/` files~~ — **RESOLVED 2026-08-06, all 5 now read; see §7b.** The
  unread files did change the design: they contained a second vocabulary that resolves the alignment
  objection, and two patterns worth taking that the SKILL.md never mentions.
- **I did not read `CONTRIBUTING.md`, `test-cases.json`, or the eval yaml** beyond noting existence.
- **The second half of `visual-style.md` ("Per-Surface Rules") is only partly read** — its
  chat-output section was read; its file/repo-surface sections were not.
- **The eval harness is a separate opportunity, deliberately out of scope here.** Root `CLAUDE.md`
  states we have **no behavioral eval harness**, which is why `/etk:audit-skill` can only emit
  *candidate* flags for human review. ork ships one. Whether that is worth adopting is its own
  question and should not ride along on this decision.
- **quickviz declares `compatibility: "Claude Code 2.1.220+"`.** Live CC here is 2.1.222, so this is
  satisfied today — but we do not otherwise use a `compatibility:` key, and whether CC enforces it or
  it is decorative is **unmeasured**.
- **Whether ork's `visualize-plan` has ideas for `playground`** was not examined; out of scope.
