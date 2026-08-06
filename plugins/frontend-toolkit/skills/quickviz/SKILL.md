---
name: quickviz
description: "Use when the user wants something shown visually right now in the chat — status, progress, comparisons, trade-offs, architecture, blast radius, or an ad-hoc 'show me X' — and wants the picture immediately rather than a file. For a persisted HTML explorer use playground; for diagrams written into a doc use ascii-visualizer. Triggers on visualize, show me, draw, diagram this, render, what does this look like, quick viz, sketch, ASCII art"
effort: low
disallowed-tools:
  - Edit
  - Write
  - NotebookEdit
---

<!--
Adapted from OrchestKit's `quickviz` skill (github.com/yonatangross/orchestkit), MIT
licensed, with thanks. Behavior contract, shape→form routing, the closed glyph
vocabulary, and the Blast Radius / Reversibility Timeline patterns come from there.

DELIBERATELY DIVERGENT from the source in three ways, each measured:
  1. Unicode box-drawing is allowed HERE because this skill's output surface is chat.
     `ascii-visualizer` stays ASCII-only because its surface is files on disk. See
     "Which skill, which palette" below — the boundary is stated in BOTH skills.
  2. Glyphs go inside boxes, emoji stay outside. Measured, not assumed: the 11 status
     glyphs are 1 column each; 11 of the 12 emoji are 2 columns and break alignment.
  3. Alignment is prose discipline, not a verifier script — adding executable machinery
     to a shipped plugin needs its own justification.
-->

# Quickviz — render it now, inline

Render the answer as a diagram in the reply, immediately. No setup, no questions, no files.

**Core principle:** encode information into *structure*, not decoration. Every element must carry meaning — if removing it loses nothing, it was decoration.

## Execution — run, do not ask

**There is no setup phase. Asking first defeats the skill.**

1. **Render immediately.** Do NOT call `AskUserQuestion` to pick a format. Do NOT spawn an `Agent`. Do NOT create tasks. Choose the form yourself from the shape of the data.
2. **With no topic given, the topic is the current conversation** — the open work, the decision just reached, the state of the thing being discussed. Render that; do not ask what to draw.
3. **Emit inline in the reply. Never write a file** unless the user explicitly asked for one. This is a chat answer, not an artifact.
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

Closed set. Every glyph is exactly **1 column wide**, so it is safe inside a bordered box.

```
●  active / current        ○  inactive / pending
✓  passed / done           ✗  failed / blocked
⚠  warning                 ◆  primary / focused
▶  running                 ▷  awaiting input
↑↓→ trend                  ▓▒░ fill: high / med / low
```

Semantic only, never decorative. `✓` means *passed* — a plain list of items is not passing, so use `●`/`○` or an unmarked `-`.

### Emoji — these stay OUTSIDE diagrams

✅ ❌ ⚠️ 🔄 💡 🚨 🎯 🔥 📜 🤖 ⚡ — for prose, bullets, and headers.

⚠ **Measured: 11 of these 12 render 2 columns wide.** One emoji inside a bordered row shifts that row's right edge and breaks the box. Keep them out of anything with a right border.

## Alignment discipline

A misaligned box looks broken and discredits the whole answer. Speed applies to *choosing* the form, never to letting it drift.

- **Every line of a box must be the same display width.** Count it — do not eyeball it.
- **Prefer alignment-robust forms.** Flows, trees, and meters have no right border to match, so they cannot misalign. Full bordered boxes are the expensive option — use them when the structure earns it.
- **One character set per diagram.** Do not mix `┌─┐` with `+-+` in the same drawing.
- **Emoji and CJK text are 2 columns.** So are many CJK-locale renderings of `●◆▶↑→▓`. If a diagram must survive an unknown locale, fall back to `✓ ✗ ⚠ ░`, which are unconditionally narrow.

> This discipline is not theoretical. The upstream project's own worked example — the one labelled *"Correct"* — measures 55, 57, and 56 columns across its three border lines.

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
| A picture in the chat, now | **quickviz** (this) | **Unicode** `┌─┐` |
| A diagram written into a file | `ascii-visualizer` | **ASCII only** `+ - \|` |
| An interactive HTML explorer | `playground` | n/a |

⚠ **The split is by output surface, and it is deliberate.** A committed file may be read in any font, diff viewer, or CI log, so it stays ASCII. A chat reply is rendered by one client, so it can afford Unicode. **Do not carry this skill's palette into a file.**

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
