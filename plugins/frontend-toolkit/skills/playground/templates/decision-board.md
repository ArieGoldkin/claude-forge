# Decision Board Template

Use this template when the playground's core job is **prioritization by direct manipulation**: the
viewer drags items across an Impact×Effort matrix, reorders a ranked list, or sorts them into
Now/Next/Later (MoSCoW) buckets, watching a **live RICE/WSJF score** update, then copies a decision
prompt back to Claude. It is the "operate-it" counterpart to the read-and-decide `strategy-brief.md`:
a brief *argues* a prioritization; a decision board lets the viewer *perform* one.

Governed by the **Visual Standard** (`../references/visual-standard.md`) — persona/tokens (§1),
glass (§3), motion budget (§4), and especially the accessible drag-and-drop rules (§5). DnD internals
beyond the playground-critical subset live in the `interaction-patterns` skill. Build one HTML file,
zero external deps.

## Layout

```
+------------------------------------------------------------+
|  h1 · lede · [ Matrix | List | Buckets ] segmented control |
+------------------------------------------------------------+
|  #stage — the active lens:                                 |
|   • Matrix : Impact (y) × Effort (x) 2×2, cards positioned |
|   • List   : ranked vertical list, drag to reorder         |
|   • Buckets: Now / Next / Later columns                    |
+------------------------------------------------------------+
|  live score rail (RICE per card + total) · copy-prompt bar |
+------------------------------------------------------------+
```

One `state = { view, order, bucket }` and one data model drive all three lenses — switching the
segmented control re-renders from the same `ITEMS`, never a separate DOM.

## Data model — one array you swap

```javascript
const ITEMS = [
  { id: 'sso',  title: 'SSO login', reach: 4, impact: 5, confidence: 3, effort: 3, bucket: 'now' },
  // reach/impact/confidence/effort each 1–5 → RICE; bucket ∈ now|next|later
];
const rice = it => Math.round((it.reach * it.impact * it.confidence) / it.effort);
```

Keep the engine generic — everything below reads `ITEMS`/`state`, nothing hard-codes a specific card.

## The drag engine — Pointer Events, never native HTML5 DnD

Native `draggable="true"` is mouse-only and inaccessible. Use Pointer Events (mouse + touch + pen):

```javascript
stage.addEventListener('pointerdown', e => {
  const card = e.target.closest('.card'); if (!card) return;
  const ghost = card.cloneNode(true);          // floating clone follows the pointer
  ghost.className = 'card ghost'; document.body.append(ghost);
  card.classList.add('dragging');              // dim the source
  const move = ev => { positionGhost(ghost, ev);
    const t = document.elementFromPoint(ev.clientX, ev.clientY); // hit-test drop target
    markDropTarget(t); };
  const up = ev => { commitMove(card, ev); ghost.remove();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up); announce(moveMsg); refocus(card); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});
```

CSS: `.card { touch-action: none; }` so touch-drag doesn't scroll the page; `.ghost` gets zeroed
transform under the §4 reduced-motion gate.

## Keyboard is mandatory (not an add-on)

```javascript
// cards render with tabindex="0"; arrow keys move the FOCUSED card, meaning per view:
stage.addEventListener('keydown', e => {
  const card = e.target.closest('.card'); if (!card) return;
  const dir = state.rtl ? -1 : 1;              // RTL inverts the effort/left-right axis (§6)
  if (e.key === 'ArrowUp')   nudge(card, 'impact', +1);   // matrix: move up a quadrant
  if (e.key === 'ArrowRight')nudge(card, 'effort', +dir); // list: reorder; buckets: next column
  // …Down/Left symmetric; then re-render and refocus:
  render(); refocus(card);                     // focus is lost on innerHTML rebuild — restore it
});
const refocus = card => requestAnimationFrame(() =>
  stage.querySelector(`[data-id="${card.dataset.id}"]`)?.focus());
```

`:focus-visible` ring on every card. Every move — drag **or** keyboard — routes through the same
`commitMove`/`nudge` so the two input paths never diverge.

## Announce every move (screen readers)

```html
<div class="sr-only" id="live" role="status" aria-live="polite"></div>
```
```javascript
const announce = msg => { live.textContent = '';         // clear so identical text re-announces
  requestAnimationFrame(() => live.textContent = msg); }; // "SSO login moved to Now"
```

## Live score + copy-prompt

Recompute the RICE rail on every render; the copy-prompt bar assembles a **natural-language**
decision (only the non-default placements), not a value dump — the same contract as every playground:

```javascript
function updatePrompt() {
  const now = state.order.filter(id => byId[id].bucket === 'now').map(id => byId[id].title);
  prompt.textContent = `Prioritize now: ${now.join(', ')}. Ranked by RICE. Proceed?`;
}
```

## Defaults & presets

Load with items already placed (never an empty board) and 3–5 named presets that snap the whole
board to a stance — e.g. "Quick wins" (high-impact/low-effort → Now), "De-risk first", "Balanced".

## Writing rules for this genre

- **One data model, three lenses** — matrix/list/buckets are views of the same `ITEMS`, not three boards.
- **Drag and keyboard are equals** — if a card can be moved by mouse, it moves by keyboard, and both announce.
- **The score must be load-bearing** — show *why* the ranking changed (RICE inputs), not a bare number.
- **RTL-safe** — the effort/left-right axis inverts under `dir="rtl"` (§6); test both directions.
- Run the Visual Standard **§8 self-audit** before declaring done — the decision-surface row is mandatory here.
