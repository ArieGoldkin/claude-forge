# BLOCKS.md — Catalog reference for block-based explainer videos

The block-based generator in `tools/explainer-videos/` lets you produce a 60-second explainer video from a small TypeScript spec. The renderer is shared (`BlockExplainer.tsx`); each new video is a spec file that picks scenes from this catalog. This document is what you read before drafting a spec.

**When to use this path** (vs. the bespoke 4-pattern Remotion workflow at the top of `SKILL.md`):
- Goal is to produce an explainer that fits the established visual vocabulary (analogy intro → concrete examples → flow diagrams → fan-out → recap).
- Topic is a single concept that benefits from a familiar structure (security model, optimization, architectural pattern, lifecycle, etc.).
- You want predictable output without writing custom React/Remotion code.

**When NOT to use this path:**
- The video needs custom layouts the catalog doesn't cover (timeline charts, animated curves, narrative cinematics).
- The audience is consumer marketing — block-based videos read as engineering documentation, not pitches.

---

## End-to-end workflow

1. **Read this file plus `tools/explainer-videos/src/blocks/catalog.ts`** for the source-of-truth types.
2. **Draft a `BlocksSpec`** as a new file at `tools/explainer-videos/src/specs/<topic>.ts`. Pick 6-8 scenes from the catalog.
3. **Add a thin wrapper component** at `tools/explainer-videos/src/<Topic>BlockExplainer.tsx`:

   ```tsx
   import { BlockExplainer } from "./BlockExplainer";
   import { topicSpec } from "./specs/<topic>";

   export const TopicBlockExplainer: React.FC = () => (
     <BlockExplainer spec={topicSpec} />
   );
   ```

4. **Register the composition** in `tools/explainer-videos/src/Root.tsx` (one new `<Composition id="...">`).
5. **Show the user the spec file** before rendering. Render takes 30-90s and the layout/copy is hard to fix mid-render.
6. **Render**: `cd tools/explainer-videos && npx remotion render TopicBlockExplainer out/<topic>-v1.mp4 --concurrency=2`.
7. **Iterate**: tweak copy / scene order in the spec, re-render. Atoms and presets shouldn't need editing.

---

## Top-level spec shape

```ts
import { COLORS, type BlocksSpec } from "../blocks/catalog";

export const topicSpec: BlocksSpec = {
  videoTitle: "...",          // shown nowhere by default; identifier for humans
  videoSubtitle: "...",       // shown in intro scene only (if intro is used)
  durationSeconds: 60,        // sum of scene.durationFrames must equal this × fps
  fps: 30,                    // typical
  footer: "claude-dev-kit • <topic>",  // optional, bottom-right corner
  bgPattern: "grid",          // optional: "grid" (default) | "dots" | "diagonal" | "none"
  scenes: [ /* see scene catalog below */ ],
};
```

**Hard invariants** enforced at render time by `validateSpec`:
- `Σ scene.durationFrames === durationSeconds × fps` (off-by-frame drift = SpecError)
- All `scene.id` values unique
- Each scene's `durationFrames > 0`
- Per-kind structural minimums (see each scene type below)

**Frame budget for a 60s video at 30fps**: 1800 frames total. Typical 8-scene split:
- intro: 180f (6s)
- concrete examples: 210-240f each (~7-8s)
- flow rows: 210-240f each
- fan-out: 240f
- recap: 270f (9s — give the takeaway room to breathe)

Skip `startFrame` — `BlockExplainer` accumulates offsets from `durationFrames`. The LLM doesn't need to do arithmetic.

---

## The 7 scene kinds

### `intro` — title + analogy cards

Opens the video. Two cards slide in from each side establishing the central metaphor.

```ts
{
  kind: "intro",
  id: "intro",
  durationFrames: 180,
  title: "Hooks: Claude Code's Safety Layer",
  subtitle: "Two checkpoints around every action",
  cards: [
    { label: "PRE-HOOK", role: "SECURITY", icon: "🛂", color: COLORS.pre },
    { label: "POST-HOOK", role: "CUSTOMS", icon: "📋", color: COLORS.post },
  ],
  narration: "Two checkpoints around every action.",
}
```

**Required:** `title`, `subtitle`, ≥2 `cards`, `narration`. Each card needs `label` (small caps), `role` (big), `icon` (single emoji), `color` (semantic accent).

**Use it for**: opening every video. The analogy you pick here is the load-bearing creative decision — keep it concrete and universal (airport security, librarian, post office, traffic light, etc.). Avoid culturally-specific references (TSA reads as "what's that?" outside the US).

---

### `concrete-flow` — input → action → output

The workhorse scene. Three columns: an input box on the left, a mid box where the "action" happens, and an output that reveals the result. Used for showing single concrete examples.

```ts
{
  kind: "concrete-flow",
  id: "denied",
  durationFrames: 210,
  title: "Dangerous request? Refused.",
  accent: COLORS.danger,
  input: {
    label: "REQUEST",
    value: "rm -rf /",
    color: COLORS.danger,
  },
  action: {
    title: "SECURITY",
    sub: "scans the bag",
    icon: "🛂",
    color: COLORS.pre,
  },
  output: { /* one of 4 variants — see below */ },
  narration: "Dangerous bag? Security refuses it at the gate.",
}
```

**Required:** `title`, `accent`, `input` (label + value as monospace code + color), `action` (title + icon + color, sub optional), `output` (one of 4 kinds), `narration`.

**Use it for**: showing one specific scenario end-to-end. Best when the input is short and visceral (a command, a token string, a file path).

#### Output variants

##### `stamp` — slammed-in rotated stamp

Big text + icon, scales in with -8° rotation. Designed to feel decisive (DENIED, ALLOWED, FAILED, etc.).

```ts
output: {
  kind: "stamp",
  text: "DENIED",
  sub: "dangerous command",   // optional
  color: COLORS.danger,
  icon: "🚫",
}
```

##### `code` — monospace value box

Same shape as the input box but on the right. Use when the output is a string transformation (e.g., redacted secret).

```ts
output: {
  kind: "code",
  label: "CLEAN",
  value: "token=••••••",
  color: COLORS.pre,
}
```

##### `notes` — vertical icon+text stack

Three stacked cards that slide in left-to-right (12-frame stagger). Use for showing multiple feedback items (lint errors + saved state + warnings).

```ts
output: {
  kind: "notes",
  notes: [
    { icon: "📝", text: "biome: 2 errors", color: COLORS.warn },
    { icon: "💾", text: "saved state",     color: COLORS.post },
    { icon: "⚠",  text: "TODO pattern",    color: COLORS.warn },
  ],
}
```

##### `diff` — git-style red/green lines

Lines stagger in (10 frames apart). Use when showing what changed between two versions of content.

```ts
output: {
  kind: "diff",
  label: "DIFF ONLY",
  lines: [
    { text: "@@ -3,1 +3,1 @@",                       kind: "context" },
    { text: "- Member email is the primary key.",    kind: "removed" },
    { text: "+ Member id is the primary key.",       kind: "added" },
  ],
}
```

---

### `flow-row` — N boxes in a horizontal row

Scenes that explain a process by showing its stages side-by-side. Boxes appear stagger-in (12-frame gap), arrows draw between them after both endpoints are visible.

```ts
{
  kind: "flow-row",
  id: "pre-flow",
  durationFrames: 240,
  title: "How a pre-hook works",
  accent: COLORS.pre,
  boxes: [
    { title: "Claude", sub: "asks to do something", color: COLORS.warn },
    {
      title: "SECURITY",
      sub: "scans the request",
      bullets: ["dangerous command?", "secret token?", "PHI / restricted path?"],
      color: COLORS.pre,
    },
    { title: "Decision", sub: "allow • deny • redact", color: COLORS.neutral },
  ],
  narration: "Security checks every request before it runs.",
}
```

**Required:** `title`, `accent`, ≥2 `boxes`, `narration`. Each box needs `title`, `color`; `sub` and `bullets` are optional.

**Use it for**: showing a 3-stage pipeline at a structural level. Matches well between two `concrete-flow` scenes — gives the viewer the abstraction after seeing the example.

**Practical limit:** 3 boxes is the sweet spot. 2 works. 4 starts feeling cramped at 1920px width.

---

### `fan-out` — one source, many target badges

A center source box (Card) above a row of small badges (PluginBadge), with dashed arrows fanning down. Targets stagger in left-to-right.

```ts
{
  kind: "fan-out",
  id: "fanout",
  durationFrames: 240,
  title: "ONE crew • EVERY terminal",
  accent: COLORS.warn,
  source: {
    title: "shared/hooks-infra",
    sub: "the shared codebase",
    bullets: ["security checks", "customs reviews", "common library"],
  },
  targets: [
    { label: "ctk",  color: COLORS.pre },
    { label: "dtk",  color: COLORS.post },
    { label: "atk",  color: COLORS.warn },
    { label: "ftk",  color: COLORS.danger },
    { label: "etk",  color: COLORS.neutral },
    { label: "wtk",  color: COLORS.post },
  ],
  narration: "Same officers staff every terminal. Write once.",
}
```

**Required:** `title`, `accent`, `source` (title required, sub + bullets optional), ≥1 `targets`, `narration`.

**Use it for**: showing distribution / replication. One thing serving many. Best with 5-7 targets; ≤4 looks sparse, ≥8 starts label-truncating (font drops to 24px above 7 targets).

---

### `recap` — two comparison cards + footnote

Closing scene. Two cards slide in from each side; a gold footnote callout fades+scales in at frame 60.

```ts
{
  kind: "recap",
  id: "recap",
  durationFrames: 270,
  title: "The takeaway",
  cards: [
    {
      title: "PRE-HOOKS  •  Security",
      color: COLORS.pre,
      bullets: [
        "Block dangerous commands",
        "Redact secrets",
        "Refuse before execution",
      ],
    },
    {
      title: "POST-HOOKS  •  Customs",
      color: COLORS.post,
      bullets: [
        "Lint changed files",
        "Surface error patterns",
        "Save state for continuity",
      ],
    },
  ],
  footnote: "Write once. Run everywhere.",
  narration: "Pre refuses. Post reacts. One codebase, seven plugins.",
}
```

**Required:** `title`, exactly 2 `cards`, `footnote`, `narration`. Each card needs `title`, `color`, ≥1 `bullets`.

**Use it for**: ending the video. The two cards should be the two halves of the central metaphor (pre vs post, before vs after, with vs without). The footnote is the one-line takeaway.

**Hard rule:** `recap` needs exactly 2 cards. The validator throws if you give it any other count. The layout assumes the symmetry.

---

### `title-card` — typewriter announcement

Two stacked lines that type character-by-character. Line 1 types from frame 0; line 2 starts after `gapFrames` (default 12). After both finish, the scene holds for `holdFrames` (default 90 = 3s @ 30fps), then fades. Used for announcement intros and outros.

```ts
{
  kind: "title-card",
  id: "announce-1",
  durationFrames: 210,
  line1: "/etk:review-mr is here",
  line2: "in engineering-toolkit 2.3.2",
  line1Accent: COLORS.post,    // optional, defaults to neutral foreground
  line2Accent: COLORS.muted,   // optional, defaults to muted
  charsPerFrame: 1,            // optional, defaults to 1 (~30 cps @ 30fps)
  gapFrames: 12,               // optional, frames between lines
  holdFrames: 90,              // optional, hold after both lines typed
  narration: "Review your MR with six parallel agents.",  // optional
}
```

**Required:** `line1`, `line2` (both non-empty). Everything else has defaults.

**Use it for**: opening announcement ("X is now available" / "in plugin Y") or closing tagline ("Built with Z" / "Ship faster"). For richer intros with analogy cards, use `intro` instead.

**Hard rule:** `durationFrames` must be ≥ `ceil(line1.length/cpf) + gapFrames + ceil(line2.length/cpf) + holdFrames`. The validator throws if the scene is too short to fit the typing animation. `charsPerFrame` is clamped to (0, 5].

**Frame budget:** at default `cpf=1` and `holdFrames=90`, a card with 30 chars per line takes about 162 frames (~5.4s). Allocate 210 frames (7s) for breathing room or extend `holdFrames`.

---

### `video-clip` — embedded mp4 with hold-then-zoom

Plays an mp4 from `tools/explainer-videos/public/` with an interpolated zoom from `startFraming` to `endFraming` (easeInOut cubic). Holds at `startFraming` for `holdAtStartFrames` before the zoom begins. Used for the demo-recording middle of announcement videos.

```ts
{
  kind: "video-clip",
  id: "demo",
  durationFrames: 240,           // 8s @ 30fps
  src: "review-mr-workflow.mp4", // path inside public/
  startFraming: { scale: 1.0, focalX: 0.5, focalY: 0 },   // top-center, full
  endFraming:   { scale: 1.25, focalX: 0, focalY: 0 },    // top-left, 125%
  holdAtStartFrames: 60,         // hold 2s before zoom begins
  startFromSeconds: 0,           // optional: skip into the source
  audio: false,                  // optional: mute (default true)
  fit: "cover",                  // optional: "cover" | "contain"
  position: "top",               // optional: objectPosition string
  narration: "Six agents review your MR in parallel.",  // optional
}
```

**Required:** `src`, `startFraming`, `endFraming`. Everything else has defaults.

**Asset placement (load-bearing):** the mp4 MUST live under `tools/explainer-videos/public/`. Remotion's `staticFile()` resolves relative to that directory. Files in `docs/artifacts/` or anywhere else WILL NOT load. Copy or symlink the asset into `public/` first.

**Use it for**: announcement videos where you want to play a short demo recording, hold for a beat to let viewers orient, then zoom to a specific region of interest. For pure architecture explainers, prefer `flow-row` or `concrete-flow` instead — they author cleaner without the asset dependency.

**Hard rules:**
- `startFraming.scale` and `endFraming.scale` must be in `[0.5, 3]`.
- `focalX` and `focalY` must be in `[0, 1]` (0 = left/top, 1 = right/bottom).
- `holdAtStartFrames` must be in `[0, durationFrames)`.

**Framing intuition:**
- `scale: 1.0, focal: (0.5, 0.5)` — full canvas, centered (default fit)
- `scale: 1.25, focal: (0, 0)` — zoomed 25%, top-left corner stays put
- `scale: 1.5, focal: (1, 1)` — zoomed 50%, bottom-right stays put

---

## Color palette

Reference colors via the `COLORS` const from `blocks/catalog.ts` — never inline hex values.

| Token | Hex | Semantic role |
|-------|-----|---------------|
| `COLORS.pre` | `#3fb950` (green) | "good / allow / safe / first half of comparison" |
| `COLORS.post` | `#79c0ff` (blue) | "info / second half of comparison / customs" |
| `COLORS.danger` | `#ff7b72` (red) | "blocked / refused / removed" |
| `COLORS.warn` | `#f9e2af` (gold) | "highlight / takeaway / optimization" |
| `COLORS.neutral` | `#c9d1d9` (off-white) | "generic / no semantic weight" |
| `COLORS.muted` | `#6e7681` (gray) | "labels / sublabels — not for accents" |
| `COLORS.bgDeep` | `#0a0e13` | canvas background |
| `COLORS.bgSurface` | `#161b22` | card backgrounds |
| `COLORS.bgRaised` | `#21262d` | code-box inner backgrounds |
| `COLORS.border` | `#30363d` | hairlines |

**Pairing rules:**
- A 2-card recap uses `pre` (left) and `post` (right). Don't reverse.
- The gold accent (`warn`) is reserved for the optimization / takeaway moment. One scene per video at most.
- A scene with `accent: COLORS.danger` should be paired with a stamp output saying DENIED, FAILED, etc. — don't use `danger` accent on success scenes.

---

## Scene-sequence rules (variety enforcement)

The renderer doesn't enforce these — the spec author does.

1. **Open with `intro` or `title-card`, close with `recap` or `title-card`.** Pick `intro` for explainer/tutorial videos (analogy cards set the frame); pick `title-card` for announcement-style videos (typewriter beats over copy).
2. **Alternate scene kinds.** Don't place two of the same kind back-to-back unless content genuinely requires it. A natural rhythm for explainers: `intro → concrete → flow-row → concrete → flow-row → concrete → fan-out → recap`. For announcements: `title-card → <demo or flow-row> → title-card → recap`.
3. **Alternate accents across consecutive scenes.** If scene N is `pre` (green), scene N+1 should be `post`, `danger`, `warn`, or `neutral`.
4. **Reserve `warn` (gold) for one scene.** The "this is the optimization" moment — use it once, late in the video, near the recap.
5. **Match the analogy across scenes.** If the intro frames things as airport security, every action label, icon, and metaphor downstream should fit that frame (boarding pass, customs, gate, baggage). Mixing frames midway breaks the video.

---

## Validation cheat sheet

`validateSpec` throws `SpecError` with a readable message when:

| Check | Error message shape |
|-------|---------------------|
| Frames don't sum | `Scene durations sum to N frames but durationSeconds × fps = M` |
| Duplicate scene id | `Duplicate scene id: "denied"` |
| Zero/negative duration | `Scene "X" has non-positive durationFrames (0)` |
| Intro: <2 cards | `Scene "X" is intro with 1 cards; needs at least 2 (the slide-in animation depends on it)` |
| Flow-row: <2 boxes | `Scene "X" is flow-row with 1 boxes; needs at least 2 (or use a different scene kind)` |
| Fan-out: 0 targets | `Scene "X" is fan-out with no targets` |
| Recap: not exactly 2 cards | `Scene "X" is recap with 3 cards; the layout assumes exactly 2` |
| Title-card: empty line | `Scene "X" is title-card with empty line1 or line2` |
| Title-card: bad cpf | `Scene "X" has charsPerFrame=N; must be in (0, 5]` |
| Title-card: too short | `Scene "X" durationFrames=N is shorter than typing-time + gap + hold (M)` |
| Video-clip: empty src | `Scene "X" is video-clip with empty src` |
| Video-clip: bad scale | `Scene "X" startFraming.scale=N; must be in [0.5, 3]` |
| Video-clip: focal out of [0,1] | `Scene "X" startFraming focal coords out of [0, 1]: (X, Y)` |
| Video-clip: bad hold | `Scene "X" holdAtStartFrames=N; must be in [0, durationFrames=M)` |

If render throws on mount, fix the spec before retrying. The validator is fast (<1ms); the renderer is slow (30-90s for 60s of 1080p).

---

## Worked example — minimum viable spec

```ts
import { COLORS, type BlocksSpec } from "../blocks/catalog";

export const exampleSpec: BlocksSpec = {
  videoTitle: "Example",
  videoSubtitle: "Two-scene minimum",
  durationSeconds: 15,    // 15s = 450 frames at 30fps
  fps: 30,
  scenes: [
    {
      kind: "intro",
      id: "intro",
      durationFrames: 180,
      title: "Example Topic",
      subtitle: "A two-scene demo",
      cards: [
        { label: "BEFORE", role: "PROBLEM", icon: "❓", color: COLORS.danger },
        { label: "AFTER",  role: "SOLUTION", icon: "✅", color: COLORS.pre },
      ],
      narration: "From problem to solution.",
    },
    {
      kind: "recap",
      id: "recap",
      durationFrames: 270,
      title: "The takeaway",
      cards: [
        { title: "Problem", color: COLORS.danger, bullets: ["X is broken"] },
        { title: "Solution", color: COLORS.pre, bullets: ["Y fixes it"] },
      ],
      footnote: "Use Y instead of X.",
      narration: "Problem solved.",
    },
  ],
};
```

This validates and renders. Use as a skeleton when starting a new spec.
