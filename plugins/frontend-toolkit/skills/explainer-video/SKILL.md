---
name: explainer-video
description: "Generate Remotion-based explainer videos for software architecture and process-flow demonstrations. Use when documenting multi-phase pipelines, system architectures, agent dispatch flows, sequence diagrams, or state machines as motion+narration. Triggers on: explainer video, architecture demo, flow video, remotion, animated diagram, render video, system walkthrough, process video, state machine video, sequence diagram video."
effort: xhigh
context: fork
---

# Explainer Video

A thin "intent → composition pattern" router on top of Remotion. This skill teaches the agent how to translate engineering content (an architecture, a pipeline, an FSM, a sequence) into a rendered `.mp4` video.

**Critical**: this skill does NOT cover Remotion primitives (`<Composition>`, `<Sequence>`, `interpolate()`, audio sync, fonts, captions, etc.). Those live in the official Remotion skill at `remotion-dev/skills`. This skill provides the engineering-specific composition patterns ON TOP of those primitives.

## Two paths

This skill exposes two ways to produce a video. Pick before composing.

| Path | When | Output |
|------|------|--------|
| **Block-based** (monorepo working tree only) | Topic fits the established vocabulary: analogy intro → concrete examples → flow diagrams → fan-out → recap. You want predictable output. | A 60s video assembled from a small TypeScript spec via the shared `BlockExplainer` renderer at `tools/explainer-videos/`. See [`references/BLOCKS.md`](references/BLOCKS.md) — jump to the **"Block-based generation"** section below. |
| **Bespoke 4-pattern** (sections 1-7) | Topic doesn't fit the block vocabulary, or you need a custom layout (timeline, animated curve, narrative cinematic). You're authoring a custom Remotion composition. | A hand-built video using Remotion primitives + the pattern templates in this skill's references. |

**Prerequisite — block-based requires the monorepo working tree.** The block path reads/edits/renders files under `tools/explainer-videos/`, which ships **only** in the monorepo (clone `github.com/ArieGoldkin/claude-dev-kit`) — it is **not** bundled in an installed plugin. If you installed `ftk` from the marketplace without the monorepo checked out, use the **bespoke 4-pattern path** (sections 1-7), which is fully self-contained in this skill. Use block-based only inside a monorepo clone when the topic fits the catalog vocabulary.

## Install gate

Before composing anything, verify the environment.

```bash
node --version       # require ≥ 18
which npx            # require npx
```

Check whether the project has a Remotion scaffold:

```bash
test -f remotion.config.ts || test -f remotion.config.js && echo "scaffold present"
```

If absent, recommend (do not auto-run):

```bash
npx skills add remotion-dev/skills          # install the official Remotion skill
npx create-video@latest --yes --blank --no-tailwind <project-name>
```

**Surface to the user**: first scaffold pulls ~400-600 MB into `node_modules` (includes a headless Chromium download via `@remotion/renderer`). First render after install is ~30-60 seconds slower than subsequent renders.

If the user declines to scaffold, STOP with `STATUS: BLOCKED` and explain the dependency.

## Workflow

```
intent → classify → load pattern reference → validate spec → assemble → render → publish
```

### 1. Intent classification

The user describes what they want in natural language. Map it to one of four patterns. See [`references/intent-routing.md`](references/intent-routing.md) for the full routing table and disambiguation rules.

| Intent signal | Pattern |
|---------------|---------|
| "show our X architecture" / "system diagram" / "components and connections" | `architecture` |
| "walk through the X pipeline" / "explain phases" / "step-by-step process" | `flow-pipeline` |
| "show the sequence" / "actor X talks to Y" / "message flow over time" | `sequence-diagram` |
| "state transitions" / "lifecycle" / "FSM" / "valid transitions" | `state-machine` |

If the intent crosses two patterns (e.g., "show how messages flow through our architecture"), prefer the more time-based one (`flow-pipeline` > `architecture`, `sequence-diagram` > `state-machine`).

If the intent is ambiguous after applying disambiguation rules, **ask ONE clarifying question**. Do not guess.

### 2. Load the pattern reference

Each pattern has a dedicated reference. Load only the one selected:

- [`references/pattern-architecture.md`](references/pattern-architecture.md)
- [`references/pattern-flow-pipeline.md`](references/pattern-flow-pipeline.md)
- [`references/pattern-sequence-diagram.md`](references/pattern-sequence-diagram.md)
- [`references/pattern-state-machine.md`](references/pattern-state-machine.md)

Each reference contains: YAML schema for the pattern's spec, React component template, a worked example (cross-linked to `assets/example-*.yaml`).

### 3. Validate the spec

The user provides a YAML spec (or you draft one with them and confirm). Validate against the pattern's schema. Common required fields:

- A title and (optional) subtitle
- A list of nodes/phases/actors/states
- Transitions or connections between them
- Optional narration script
- Optional duration overrides

Report validation failures and ask the user to fix them before proceeding. Do not invent missing fields.

**Then run the spec-audit checklist from [`references/slop-avoidance.md`](references/slop-avoidance.md)**:

- Every phase's `description` ≤ 15 words OR explicitly flagged narration-only
- No two consecutive phases share `visual_style`
- Exactly one phase has `hero: true`
- Each phase's `duration_frames` ≥ 240 (8s)
- Each phase has a distinct `accent_color`

If any check fails, propose a fix to the spec BEFORE rendering. Re-rendering takes 30-90s minimum; spec-audit takes 30 seconds. Don't render specs that will look boring.

### 4. Compose

Use the Remotion primitives from `remotion-dev/skills` plus the pattern's React template to assemble a Composition. Write the components into the project's `src/` directory. The Composition's id should match the user's topic (e.g., `ReviewMrPipeline`, `EventLambdaTopology`).

**Apply text-animation patterns** from [`references/text-animation.md`](references/text-animation.md) when building visualization beyond basic fades:

- Terminal / code phases that show command output → typewriter via string slicing (NOT per-char opacity)
- Hero phase headline + closing punchline → per-word stagger
- Description prose with one load-bearing word → keyword highlighting
- Phase-to-phase boundaries → `<TransitionSeries>` with `springTiming({ damping: 200 })`

**Apply explanation pacing** from [`references/explanation-pacing.md`](references/explanation-pacing.md) — these are the rules that distinguish *explanation* videos from *marketing* videos:

- Hold ≥ 2 seconds after motion settles (don't keep animating)
- If narration exists, narration leads visuals by ~150ms
- Dim previous phase to ~25% opacity, don't cut (when phases share visual structure)
- Time-on-screen scales with text length: 1-3 words → 3s, 4-7 words → 5s, multi-line → 8s+
- Use `springTiming({ damping: 200 })`, not `linearTiming(8)`

### 5. Narration (optional)

If the spec includes a narration script:

- Pre-render the audio to a single `.mp3` placed in `public/`. See [`references/narration-pipeline.md`](references/narration-pipeline.md).
- Use the official Remotion skill's `<Audio>` component to mount it; align segments with `<Sequence from={N}>`.
- If `ELEVENLABS_API_KEY` is not set, render a silent video with on-screen subtitles instead. Do not block on TTS unavailability.

**Hard rule**: never live-TTS at render time. Pre-render or skip narration entirely.

### 6. Render

```bash
npx remotion render <Composition> out/<name>.mp4 --codec h264 --crf 23
```

See [`references/render-and-publish.md`](references/render-and-publish.md) for output paths, size optimization, and render-time expectations.

### 7. Publish

Move the output to `docs/artifacts/explainer-video-<topic>/<name>.mp4` and write a small `report.md` next to it summarizing:

- Pattern used
- Spec source (YAML path)
- Composition id
- Render duration
- Output file path + size

## 8. Block-based generation (monorepo working tree only)

> **Prerequisite:** this path reads/edits/renders files under `tools/explainer-videos/`, which exists only in the monorepo working tree — it is **not** shipped with an installed plugin. Without the monorepo cloned, use the bespoke 4-pattern flow (sections 1-7) instead.

When working inside a monorepo clone, the block-based generator at `tools/explainer-videos/` produces consistent output from a small TypeScript spec. This bypasses the bespoke 4-pattern flow above (sections 1-7) — you don't write custom Remotion components, just data.

### Workflow

1. **Read [`references/BLOCKS.md`](references/BLOCKS.md)** — the catalog reference. Describes the 5 scene kinds (intro, concrete-flow, flow-row, fan-out, recap), 4 output variants (stamp, code, notes, diff), color palette, and validation rules.
2. **Read `tools/explainer-videos/src/blocks/catalog.ts`** for the source-of-truth TypeScript types.
3. **Read at least one existing spec** to anchor the shape:
   - `tools/explainer-videos/src/specs/hooks-blocks.ts` (8 scenes, airport-security analogy)
   - `tools/explainer-videos/src/specs/delta-cache-blocks.ts` (8 scenes, librarian/sticky-note analogy)
4. **Draft a `BlocksSpec`** at `tools/explainer-videos/src/specs/<topic>.ts`. Pick 6-8 scenes from the catalog. Open with `intro`, close with `recap`. Alternate scene kinds. Reserve `COLORS.warn` (gold) for one optimization-takeaway moment late in the video.
5. **Add a wrapper component** at `tools/explainer-videos/src/<Topic>BlockExplainer.tsx`:

   ```tsx
   import { BlockExplainer } from "./BlockExplainer";
   import { topicSpec } from "./specs/<topic>";

   export const TopicBlockExplainer: React.FC = () => (
     <BlockExplainer spec={topicSpec} />
   );
   ```

6. **Register in `Root.tsx`** — one import + one `<Composition id="TopicBlockExplainer" ...>` entry. Pattern is identical to existing `HooksBlockExplainer` / `DeltaCacheBlockExplainer` registrations.
7. **Show the spec to the user before rendering.** Render takes 30-90s for a 60s video; layout/copy is expensive to fix mid-render. Confirm metaphor + scene order + copy first.
8. **Render**: `cd tools/explainer-videos && npx remotion render TopicBlockExplainer out/<topic>-v1.mp4 --concurrency=2`.
9. **Iterate in the spec only** — atoms and presets shouldn't need editing for content changes.

### What makes block-based fast

- **Shared renderer.** `BlockExplainer.tsx` is ~55 LOC and dispatches to 5 preset components. You write zero rendering code.
- **Validation at mount.** `validateSpec()` throws `SpecError` with readable messages on frame-arithmetic drift, duplicate ids, or per-kind structural violations — before any frame renders.
- **No `startFrame` arithmetic.** Specs declare `durationFrames` per scene; `BlockExplainer` accumulates offsets at render time.
- **Variety levers without code.** `bgPattern: "grid" | "dots" | "diagonal" | "none"` on the spec. Different per video without touching atoms.

### The creative work that's left

The 5 scene kinds and 4 output variants are reusable. The metaphor, copy, and example choices are not — and that's where the video lives or dies.

- **Pick a strong analogy.** Airport security, librarian + sticky notes, post office, traffic light. Concrete and universally recognized. Avoid culturally-specific references (TSA reads as "what's that?" outside the US).
- **Write 5-7-word narration lines.** One per scene, max ~10 words. They double as voiceover script if you ever add audio.
- **Use concrete tiny examples.** `rm -rf /` → DENIED. `token=sk-abc123` → `token=••••••`. Real strings beat abstract descriptions.
- **One gold accent per video.** The "this is the optimization" moment. Use `COLORS.warn` once, late in the video, near the recap.

### Block-based ↔ bespoke fallback

If the topic genuinely needs something the catalog can't express (timelines, charts, narrative cinematics), drop down to the bespoke 4-pattern flow (sections 1-7 above). The two paths coexist — same skill, different output styles.

## Hard rules

These will burn you if violated. See [`references/gotchas.md`](references/gotchas.md) for the full list.

1. **NO CSS transitions, NO Tailwind animation classes.** They render as static. Use `interpolate()` for every visual change.
2. **`useCurrentFrame()` is the only truthful clock.** `Date.now()`, `setTimeout`, `requestAnimationFrame` lie under render.
3. **Fonts load asynchronously.** Use `@remotion/google-fonts` OR `delayRender()` / `continueRender()` for local fonts. Without one of these, first frames render in fallback typeface.
4. **Pre-render narration to a file.** Live TTS at render time desyncs.
5. **First render downloads Chromium (~150 MB).** Surface this on cold-start environments.

## Worked examples

Pre-built specs in `assets/`:

- `example-architecture-event-lambdas.yaml` — 43-Lambda topology with SNS/SQS data flow
- `example-flow-review-mr.yaml` — `/etk:review-mr` 8-phase pipeline
- `example-sequence-mr-creation.yaml` — Developer → glab → GitLab → CI → reviewer message flow
- `example-state-machine-subscription-lifecycle.yaml` — subscription lifecycle FSM with valid + invalid transitions

Use these as both starting points (copy and adapt) and validation oracles (each is a valid spec for its pattern).

## When the user is ambiguous

Ask exactly ONE of these questions, picking the one that resolves the most uncertainty:

- "Is this primarily about WHAT connects to WHAT (architecture), or about WHEN things happen (flow)?"
- "Are you walking through phases of one process, or showing actors exchanging messages?"
- "Is the focus on transitions between defined states, or on message flow between actors?"

Do not ask multiple questions. Pick the highest-leverage one based on signal in the user's prompt.

## Status protocol

Report one of these on completion:

| Status | When |
|--------|------|
| `DONE` | Video rendered, published to `docs/artifacts/`, report.md written |
| `DONE_WITH_CONCERNS` | Video rendered but with caveats (narration skipped, font fallback used, render took >2× expected, etc.). List concerns. |
| `NEEDS_CONTEXT` | Spec incomplete or pattern selection ambiguous after one clarifying question |
| `BLOCKED` | Remotion scaffold absent and user declined to install, or render failed for environment reasons (Chromium download blocked, FFmpeg missing) |

Format: `STATUS: <CODE>` on its own line, then a brief explanation.

## Reference files

- [`references/BLOCKS.md`](references/BLOCKS.md) — block-based catalog: 5 scene kinds + 4 output variants + color palette + validation rules + worked example. Read this when using the block-based path (Section 8).
- [`references/intent-routing.md`](references/intent-routing.md) — natural-language → pattern table + disambiguation rules
- [`references/pattern-architecture.md`](references/pattern-architecture.md) — system-diagram-with-data-flow pattern
- [`references/pattern-flow-pipeline.md`](references/pattern-flow-pipeline.md) — phased timeline pattern
- [`references/pattern-sequence-diagram.md`](references/pattern-sequence-diagram.md) — actor-based message sequence
- [`references/pattern-state-machine.md`](references/pattern-state-machine.md) — FSM walkthrough
- [`references/cinematic-templates.md`](references/cinematic-templates.md) — opinionated visual moves; pick ONE per video for the hero phase
- [`references/slop-avoidance.md`](references/slop-avoidance.md) — text density, timing, hook style, anti-patterns; aesthetic baselines
- [`references/text-animation.md`](references/text-animation.md) — typewriter (string-slice), per-word stagger, keyword highlighting, `<TransitionSeries>` between phases
- [`references/explanation-pacing.md`](references/explanation-pacing.md) — 5 rules from manim/3Blue1Brown/Khan tradition (one-idea-per-beat, narration leads, persistent context, generous on-screen time, slow transitions)
- [`references/narration-pipeline.md`](references/narration-pipeline.md) — script → ElevenLabs TTS → audio sync
- [`references/render-and-publish.md`](references/render-and-publish.md) — `npx remotion render` invocation + output handling
- [`references/gotchas.md`](references/gotchas.md) — Remotion footguns + composition ID hygiene + tiered render-time table
