---
name: quickviz
description: "Use when the user wants something shown visually right now in the chat — status, progress, comparisons, trade-offs, architecture, blast radius, or an ad-hoc 'show me X' — and wants the picture immediately rather than a file. For a persisted HTML explorer use playground; for diagrams written into a doc use ascii-visualizer. Triggers on quickviz, visualize this, show me visually, draw me a diagram, diagram this, render this as a chart, what does this look like, sketch this out"
effort: low
disallowed-tools:
  - Edit
  - Write
  - NotebookEdit
---

# Quickviz — render it now, inline

> Adapted from the `quickviz` skill in **OrchestKit** by **Yonatan Gross**
> ([yonatangross/orchestkit](https://github.com/yonatangross/orchestkit), MIT), at upstream
> `a64613c8442d` (2026-08-06), with thanks. The render-now contract, shape→form routing, the closed
> glyph vocabulary, and the Blast Radius / Reversibility Timeline patterns originate there.
> Divergences from upstream — the glyph-class palette rule, the glyph/emoji placement rule, the
> dropped `⏸`, and alignment-as-prose — are recorded in `docs/reviews/2026-08-06_quickviz-adoption-brief.md`.

Render the answer as a diagram in the reply, immediately. No setup, no questions, no files.

**Core principle:** encode information into *structure*, not decoration. Every element must carry meaning — if removing it loses nothing, it was decoration.

## Execution — run, do not ask

**There is no setup phase. Asking first defeats the skill.**

1. **Render immediately.** Do NOT call `AskUserQuestion` to pick a format. Do NOT spawn an `Agent`. Do NOT create tasks. Choose the form yourself from the shape of the data.
2. **With no topic given, the topic is the current conversation** — the open work, the decision just reached, the state of the thing being discussed. Render that; do not ask what to draw.
3. **Emit inline in the reply. Never write a file** — this skill has no `Write` tool by design, and you must not route around that with `Bash`. If the user wants a persisted artifact, hand off: `playground` for an HTML explorer, `ascii-visualizer` for a diagram in a document. This is a chat answer, not an artifact.
4. **Lead with the visual.** Prose comes after, and only if it adds something the diagram cannot carry.
5. **Stay honest.** If a number is unknown, print `?`. **Never invent one.** A confident-looking chart built on guesses is worse than plain prose, because it launders a guess as a measurement.

## Pick the form from the shape of the data

| Topic shape | Form |
|---|---|
| state / progress / health | status box + fill meters |
| A vs B, options, trade-offs | side-by-side boxes or comparison table |
| steps, pipeline, hand-offs | left-to-right flow with `──▶` |
| containment, layers, layout | nested boxes / tree |
| ranked list, scores, counts | table + fill meters |
| over time | milestone track or sparkline |
| what a change touches | **Blast Radius** (concentric rings) |
| what can still be undone | **Reversibility Timeline** |

## Vocabulary

### Status glyphs — these go INSIDE diagrams

Closed set: **11 semantic slots, 15 characters** (three slots hold a triple).

```
●  active / current        ○  inactive / pending
✓  passed / done           ✗  failed / blocked
⚠  warning                 ◆  primary / focused
◇  secondary / unfocused   ▶  running
▷  awaiting input          ↑↓→ trend
▓▒░ fill: high / med / low
```

Every one is **1 column** in a Western locale, so none of them widens a row the way an emoji does. ⚠ **That is not the same as "safe everywhere":** 11 of the 15 are East-Asian **Ambiguous** and render 2 columns in a CJK locale. Only `✓ ✗ ⚠ ░` are unconditionally narrow.

Semantic only, never decorative. `✓` means *passed* — a plain list of items is not passing, so use `●`/`○` or an unmarked `-`.

### Emoji — these stay OUTSIDE diagrams

✅ ❌ ⚠️ 🔄 💡 🚨 🎯 🔥 📜 🤖 ⚡ — for prose, bullets, and headers.

⚠ **Measured: all 11 render 2 columns wide.** One emoji inside a bordered row shifts that row's right edge and breaks the box. Keep them out of anything with a right border. (Upstream also lists `⏸`; it is dropped here because the `▷` glyph already means *awaiting input*, and unlike the rest `⏸` is 1 column — keeping it would make "all are 2 columns" false.)

## Alignment discipline

A misaligned box looks broken and discredits the whole answer. Speed applies to *choosing* the form, never to letting it drift.

- **Every line of a box must be the same display width.** Count it — do not eyeball it.
- **Prefer alignment-robust forms.** Flows, trees, and meters have no right border to match, so they cannot misalign. Full bordered boxes are the expensive option — use them when the structure earns it.
- **One character set per diagram.** Do not mix `┌─┐` with `+-+` in the same drawing.
- **Emoji and CJK text are 2 columns**, and so are `●◆◇▶▷↑↓→▓▒` in a CJK locale.
- ⚠ **In an unknown locale, do not draw a bordered box at all.** Swapping in "safe" content glyphs cannot rescue it: **every border character** — `─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼ ╔ ═ ╗ ║ ╚ ╝` — is itself Ambiguous, so the frame doubles no matter what sits inside it. Use indentation, a flow, or a plain table instead; those have no width to match.

> This discipline is not theoretical. The upstream project's own worked example — the one labelled *"Correct"* in `rules/ascii-architecture.md` at `a64613c8442d` — measures **55, 57 and 56** columns across its three border lines. Upstream may fix it; the measurement is pinned to that commit so the claim stays checkable either way.

## Palette

```
Boxes     ┌─┐ │ └─┘        light, the default
          ╔═╗ ║ ╚═╝        heavy, reserve for a top-level frame
Connect   ├─┤ ┬ ┴ ┼
Arrows    ──▶  ◀──  ▲  ▼
Fill      ████████░░  ▓▒░
Bullets   •  ◦
```

Avoid anything needing a non-default monospace font, and any ASCII-art logo.

## Which skill, which palette

| You want | Skill | Palette |
|---|---|---|
| A picture in the chat, now | **quickviz** (this) | Unicode boxes `┌─┐ │` |
| A diagram written into a file | `ascii-visualizer` | **by glyph class** — see below |
| An interactive HTML explorer | `playground` | n/a |

⚠ **The rule is per glyph class, not per skill.** `ascii-visualizer` is **not** "ASCII only" — its own file-tree examples use `├── └── │` and it contains ~94 box-drawing characters. What it actually holds is:

| In a file | Palette | Why |
|---|---|---|
| **Bordered boxes** | ASCII `+ - \|` | Every box-drawing border char is East-Asian Ambiguous, so a framed diagram can double in width in another locale. A file may be read anywhere. |
| **File trees** | Unicode `├── └── │` | The established convention `tree(1)` itself emits; no right border to misalign, so the Ambiguous risk costs nothing. |

**In chat, bordered boxes may use Unicode** — one client renders it, and the locale is known.

**Do not carry this skill's bordered-box palette into a file.** File trees are the exception and always were.

## Patterns

### Blast Radius — what a change touches

```
        ┌─ Ring 3 · tests (8) ──────────────┐
        │  ┌─ Ring 2 · transitive (5) ───┐  │
        │  │  ┌─ Ring 1 · direct (3) ─┐  │  │
        │  │  │    CHANGED FILE       │  │  │
        │  │  └───────────────────────┘  │  │
        │  └─────────────────────────────┘  │
        └───────────────────────────────────┘

Direct      auth.py, routes.py, middleware.py
Transitive  app.py, config.py, utils.py, cli.py, server.py
```

### Reversibility Timeline — what can still be undone

```
Phase 1  ████████████████  reversible    add nullable column
Phase 2  ████████████████  reversible    new endpoint, additive
Phase 3  ████████░░░░░░░░  partial       backfill data
         ─────── POINT OF NO RETURN ───────
Phase 4  ░░░░░░░░????????  IRREVERSIBLE  drop old column
```

The divider is the point of the diagram. Place it explicitly, or the form carries no more information than a list.

## Related Skills

- **`ascii-visualizer`** — the craft reference for diagrams written into files. ASCII-only palette; alignment rules, templates, and worked examples live there.
- **`playground`** — single-file interactive HTML explorers, when the deliverable is a persisted artifact rather than a chat answer.
