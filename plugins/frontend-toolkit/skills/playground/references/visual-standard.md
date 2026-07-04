# Playground Visual Standard

> The design contract for a single-file HTML playground. Every rule carries a
> **concrete, falsifiable value** — a rule without a measurable threshold is not
> shippable. The difference between a considered product demo and a generic AI
> dashboard is the specific values in this file.
>
> **Load when:** building a playground the viewer can *operate* — a control panel,
> a story player, or a drag-to-decide board.
> **Skip for:** a plain read-and-decide brief (its own template — `strategy-brief.md` —
> already governs it), or a throwaway data/config dump where the card layout is fine.
>
> Adapted (principles, not verbatim assets) from orchestkit's `playground-visual-standard.md`
> (yonatangross/orchestkit, MIT). This file keeps the playground-specific, measurable
> rules; it **defers to sibling ftk skills** for the general ground they already own —
> `frontend-creative-design` (aesthetic direction, anti-generic reasoning, typography/persona
> depth), `interaction-patterns` (drag-and-drop internals, ARIA live regions), and
> `design-system-tokens` (token pipelines, OKLCH). Don't restate those here; cite them.

---

## §0 Archetype routing — decision, not vibe

Before styling anything, count the operate-it signals. This replaces "pick the closest
template and adapt" with a checkable rule:

```
This is an OPERATE-IT playground (apply this standard) if ≥2 are true:
  □ device mockup (phone/tablet/app frame)     □ playback / step controls (▶ ‹prev next›)
  □ cause→effect flow arrows                    □ narrative user-story copy
  □ drag-and-drop decision surface              □ copy-prompt bar (a "build / decide" affordance)

Then pick ONE archetype:
  • CONTROL PANEL   → adjust-and-copy: live controls on one side, live preview on the other
                      (the design / data / concept-map / code-map templates).
  • USER-STORY PLAYER → the playground plays a flow over ≥2 steps/screens (device frame +
                      transport + cause→effect arrow). Build from §6 component specs.
  • DECISION BOARD  → the core is prioritization via drag-and-drop with a live score
                      (RICE/WSJF) + copy-prompt. Build from the §6 drag-and-drop engine.
  • (<2 signals) → not a full playground. A data/config dashboard is fine with the card
                      layout — but still take the §1 tokens and the §5 reduced-motion gate.
```

A read-and-decide document (roadmap, build-vs-buy, option matrix) is a **different genre** —
route it to `strategy-brief.md`, not here.

---

## §1 Persona & tokens

Pick **one** persona up front and don't mix — aesthetic primes emotion in <100ms, before
copy is read. Depth on choosing a creative direction lives in `frontend-creative-design`
(`references/aesthetic-guidelines.md`); here, the two playground defaults:

- **warm-glass** — amber/emerald accents, frosted surfaces, rounded. Consumer / family / approachable.
- **cool-glass** — indigo/violet/teal accents, tighter radii. Developer / enterprise / data.

Define tokens as CSS custom properties prefixed `--pg-`. **Use HSL, not hex** — you can derive
a lighter shade from `hsl(248 84% 68%)` by hand; you cannot from `#7c6cf0`. Every color carries
a **role** (token pipelines & OKLCH: see `design-system-tokens`):

| Token | Example (cool) | Role |
|---|---|---|
| `--pg-bg` | `hsl(232 26% 7%)` | Page background — rich + dark (≤8% L), **never `#000`** |
| `--pg-ink` / `--pg-muted` / `--pg-faint` | `hsl(220 18% 93%)` / `…64%` / `…46%` | Text: primary (never pure white) / secondary / tertiary |
| `--pg-glass` / `--pg-glass-edge` | `hsl(0 0% 100% / .06)` / `…/ .18` | Glass fill / border (see §4) |
| `--pg-accent` (+`-deep`) | `hsl(248 84% 68%)` | Primary action / active state / flow arrow |
| `--pg-warm` | `hsl(38 95% 60%)` | Secondary accent |

**Scales — one value per role** (the failure this targets is *arbitrary* spacing: `13px` here
and `15px` there for the same element, not the existence of an `11px` button inset):

- **Spacing** snaps to `4 · 8 · 12 · 16 · 24 · 48 · 96`.
- **Radius** `sm 9px · md 16px · lg 24px · device-bezel 40px · device-outer 54px`. Glass cards ≥16px.
- **Gradient-mesh background:** 2–3 radial-gradients in accent hues over `--pg-bg`,
  `background-attachment: fixed`, **hue span ≤30°** (wider reads as garish).

---

## §2 Hierarchy — emphasize by de-emphasizing

The most-violated rule in generic AI playgrounds: everything competes at full strength.

- Assign every element a tier **before** styling: Primary (the mockup / the board), Secondary
  (transport / controls), Tertiary (copy-prompt bar / metadata).
- Competing elements drop to ~60% opacity or `--pg-faint` and lose their borders. Primary text
  weight 600–700; tertiary 400; `tabular-nums` on any live numbers.
- Don't give two elements the same visual weight and expect one to read as primary.

---

## §3 Glass system

Glass reads as glass only against a dark, contrasted backdrop with a visible edge.

- **Do:** fill `rgba(255,255,255, .05–.12)`; 1px border `rgba(255,255,255, .15–.25)`;
  `backdrop-filter: blur(12–20px)` (+ `-webkit-` prefix); a top-left light source
  (`inset 0 1px 0 rgba(255,255,255,.1–.2)`); a two-part shadow (ambient
  `0 20px 60px -22px hsl(…/.7)` + tight `0 4px 12px -6px hsl(…/.5)`).
- **Don't:** glass on a light background (invisible); >2 stacked glass layers; radius <16px;
  a glow halo (`box-shadow: 0 0 40px accent` — the "generic AI glowing card"); glass as a
  hierarchy signal.

---

## §4 Motion budget

- **Exactly four durations:** step/screen transition `300ms`; panel/arrow appear `200ms`;
  button press/highlight `100ms`; device slide-in on load `500ms`. Ease
  `cubic-bezier(.2,.8,.25,1)`. **Everything else animates `0`.**
- Allow **one signature moment** (usually the step transition or the drop-settle) — animation
  everywhere is the fastest path to "AI-generated."
- Ship the reduced-motion gate **verbatim** (non-negotiable — every playground):
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
  }
  ```

---

## §5 Component specs

- **Device frame:** outer radius 54px, bezel 12–16px, inner screen radius 40px
  (`overflow:hidden` — content never escapes the bezel). Notch optional but consistent.
- **Transport bar:** ▶ play / ‹ prev / next ›; primary button `--pg-accent`; disabled at the
  ends; a "step N of M" hint.
- **Flow arrow:** connects cause→effect; `--pg-accent`; **RTL-sensitive** — flip with
  `transform: scaleX(-1)` when `dir="rtl"` (see §7).
- **Copy-prompt bar:** mono text + one `<button>`; **1 click to clipboard** (no modal/toast to
  dismiss); icon→✓ for ~1500ms then revert. The prompt is a natural-language instruction that
  only mentions non-default choices — not a value dump (this repeats the SKILL's core prompt rule).
- **Drag-and-drop decision surface** (full internals in `interaction-patterns`; the
  playground-critical rules):
  - **Do NOT use native HTML5 DnD** (`draggable="true"`) — it is mouse-only and inaccessible.
    Use **Pointer Events** (mouse + touch + pen): floating ghost clone, dimmed source, drop
    indicator, hit-test via `elementFromPoint`; `touch-action: none` on cards.
  - **Keyboard is mandatory:** cards `tabindex="0"`; arrow keys move the focused card;
    `:focus-visible` ring; re-focus the card after re-render.
  - **ARIA:** `role="button"`, `aria-roledescription="draggable card"`, and an
    `aria-live="polite"` region announcing every move ("X moved to Should").
  - Patterns: Impact×Effort 2×2 · ranked-list reorder · MoSCoW / Now-Next-Later buckets, with a
    live RICE/WSJF score + copy-prompt.

---

## §6 RTL / i18n

- Use CSS **logical properties everywhere**: `margin-inline-start`, `padding-inline-end`,
  `inset-inline-start` — never `left`/`right`/`margin-left`.
- Flag flow arrows and any directional position math as RTL-sensitive (flip / invert the
  pointer-X→value mapping when `dir="rtl"`).
- Reserve +50% width for labels (text expands in other languages); never truncate the prompt bar.

---

## §7 Anti-"generic AI aesthetic" checklist (falsifiable DO-NOTs)

The general anti-generic reasoning ("why Inter + purple-on-white reads as templated") lives in
`frontend-creative-design/references/anti-generic-patterns.md`. These are the playground-specific,
*measurable* ones:

1. Pure black `#000` background or text → §1 (`≤8% L`, never pure white).
2. Gradient with >30° hue span → §1.
3. Two elements at equal visual weight → §2.
4. Glow-halo cards (`box-shadow: 0 0 40px accent`) → §3.
5. More than one signature animation → cut to one (§4).
6. *Arbitrary, inconsistent* spacing for one role → one value per role on the §1 scale.
7. Hex colors in tokens → convert to HSL (§1).
8. Native `draggable="true"` DnD → the §5 pointer + keyboard engine.
9. Physical `left`/`right` CSS in a playground that may be RTL → logical properties (§6).
10. Copy-prompt that dumps values instead of a natural-language instruction → §5.

---

## §8 Self-audit — run before declaring done

- [ ] Routing (§0): correct archetype chosen; this standard actually applies.
- [ ] One persona, no warm/cool mix (§1).
- [ ] Tokens are HSL with roles; spacing/radius/motion on the scales (§1, §4).
- [ ] Hierarchy: the primary element is unmistakably dominant (§2).
- [ ] Glass passes the do/don'ts; no glow halos (§3).
- [ ] Motion ≤4 durations, one signature moment, reduced-motion gate present verbatim (§4).
- [ ] If a decision surface exists: mouse **and** keyboard work, live region announces, touch ok (§5).
- [ ] RTL: toggle `dir="rtl"` — layout + arrows mirror correctly (§6).
- [ ] Single file, zero external deps; copy-prompt is 1-click and natural-language.
- [ ] Ran the §7 checklist; zero hits.
