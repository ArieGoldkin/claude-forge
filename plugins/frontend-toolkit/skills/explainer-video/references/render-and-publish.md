# Render and publish

The render step takes a Composition + spec and produces an `.mp4`. The publish step moves the output to `docs/artifacts/` and writes a small report.

## Render command

```bash
npx remotion render <CompositionId> out/<name>.mp4 --codec h264 --crf 23
```

Where `<CompositionId>` matches what you passed to `<Composition id="..." />` in `src/Root.tsx`. Convention: PascalCase derived from the topic (e.g., `ReviewMrPipeline`, `EventLambdaTopology`, `MrCreationSequence`, `SubscriptionLifecycleFsm`).

### Flags worth setting

- `--codec h264` — broadly compatible, good size/quality balance. Default works but explicit is clearer in logs.
- `--crf 23` — quality factor (lower = better, 18-28 is the sane range; 23 is the sweet spot for explainer content).
- `--concurrency <N>` — defaults to half your CPU cores; set explicitly for CI to avoid noisy-neighbour resource issues.
- `--scale 0.5` — for quick draft renders at half-resolution to iterate faster. Always full-resolution for the final output.

### Render-time expectations

| Video length | First render (cold Chromium) | Subsequent renders |
|---|---|---|
| 30s @ 1080p | ~60-90s | ~20-40s |
| 60s @ 1080p | ~90-150s | ~30-60s |
| 90s @ 1080p | ~150-240s | ~60-90s |

These are rough on a modern laptop (M-series Mac or recent Intel/AMD). Renders are CPU-bound; faster cores help more than core count past ~8.

If a render takes 2× the expected time, suspect:

- Unoptimized assets (large PNG backgrounds, uncompressed images in `public/`).
- A composition that uses heavy SVG paths re-computed each frame instead of memoized.
- A Lottie composition (their official skill covers this; but Lottie is render-heavy by nature).

## First-render warning

The first time `npx remotion render` runs in a project, `@remotion/renderer` downloads Chromium (~150 MB). On cold-start environments (CI runners, fresh containers, new dev machines) this adds 60-90 seconds the FIRST time. Surface this to the user when running `npx remotion render` for the first time.

For CI: cache `node_modules/@remotion/renderer/.cache/` (or whatever the equivalent path is for the Remotion version installed) to avoid re-downloading on every CI run.

## Output paths

Convention: `docs/artifacts/explainer-video-<topic>/<name>.mp4`.

Examples:
- `docs/artifacts/explainer-video-review-mr/review-mr-pipeline-v1.mp4`
- `docs/artifacts/explainer-video-event-arch/lambda-topology-v1.mp4`

Include a version suffix even on first render — you'll re-render with adjustments, and `-v2`, `-v3` is cheaper than overwriting and losing the comparison.

## Companion report

Next to each `.mp4`, write a small `report.md`:

```markdown
# Explainer video — <topic>

- **Pattern**: flow-pipeline
- **Spec source**: `specs/review-mr.yaml` (committed)
- **Composition id**: `ReviewMrPipeline`
- **Duration**: 90s @ 30fps (2700 frames)
- **Render time**: 92s on M2 Pro, render started 2026-05-04T15:00:00Z
- **Output size**: 18.2 MB
- **Output**: `docs/artifacts/explainer-video-review-mr/review-mr-pipeline-v1.mp4`
- **Narration**: ElevenLabs voice 21m00Tcm4TlvDq8ikWAM (default)
- **Caption track**: rendered (also visible in video for accessibility)
```

Three reasons this matters:
1. Future-you re-rendering the same content needs to know the spec source.
2. CI / shared-drive uploads need consistent metadata.
3. When NotebookLM / external tools embed the video, having a sibling markdown gives them indexable content.

## Publish (gitignore + sharing)

`.mp4` files in `docs/artifacts/explainer-video-*/` should be **gitignored**. They're regenerable, large, and not diff-able. The `report.md` files are committable (small text, useful for indexing).

Add to root `.gitignore`:

```
docs/artifacts/explainer-video-*/*.mp4
docs/artifacts/explainer-video-*/*.mp3
docs/artifacts/explainer-video-*/*.wav
```

Share videos via Drive, Confluence, Slack — never via committing them to the repo. This is the same lesson as the earlier onboarding-media cleanup.

If a stakeholder needs the video and can't access Drive: re-render and upload to whatever channel they can reach. Do not make exceptions for "just this once" — the precedent compounds.
