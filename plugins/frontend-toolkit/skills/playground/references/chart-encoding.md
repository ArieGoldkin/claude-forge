# Chart Encoding — defer the data-mark layer to `/dataviz`

> **Load when:** a playground renders **quantitative data marks** — a bar, line, area, heatmap,
> KPI tile, meter, or sparkline (the `data-explorer`, `strategy-brief`, `code-map` templates all can).
> **Skip for:** pure chrome/controls with no chart, or a monochrome ASCII fallback.
>
> Adapted from orchestkit's `chart-encoding-standard.md` (yonatangross/orchestkit, MIT).

**This skill does not own chart form or color.** Claude Code ships a bundled **`/dataviz`** skill
that does — form selection, an accessible categorical/sequential/diverging/status palette, and a
CVD/contrast validator. Defer to it exactly the way the Visual Standard defers general aesthetics to
`frontend-creative-design`: it's an upstream dependency, not something to reinvent. The playground
owns the **domain** (what the chart is about) and the **chrome** (frame/persona); `/dataviz` owns the
**marks** (which form, which colors, is it accessible).

## The one rule that actually bites: chrome ≠ marks

Chrome and data marks are **different pixels** — never let the persona palette color the data:

```
❌ WRONG:  <rect fill="var(--pg-accent)">   <!-- persona HSL accent as a bar color:
                                                 silently fails color-blind readers, never validated -->
✅ RIGHT:  <rect fill="var(--series-1)">     <!-- --series-1 from the /dataviz validated palette;
                                                 --pg-accent stays for the frame only -->
```

Define both palettes side by side in the chart's `<style>`. A data mark never wears a persona accent.

## Three steps, all via `/dataviz`

1. **Form** — first ask *is it even a chart?* A single value is a **stat tile**; a ratio-to-limit is a
   **meter**; >7 classes is a **table**. Only then pick bar/line/heatmap by the data's job.
2. **Color** — every mark color does one job: categorical (fixed hues/order), sequential (one hue,
   light→dark), diverging (two hues + neutral mid), or status (fixed scale, always icon+label). No hand-picked hex.
3. **Validate** — run `/dataviz`'s palette validator; a contrast/CVD warning obligates a relief channel
   (direct labels or a table-view twin).

## Probe — never hard-require

`/dataviz` is CC-bundled but disableable (`disableBundledSkills`). **Probe for it** before relying on
it; if it's absent or the validator hard-fails, **fall back to a simple single-hue mark or an ASCII-card**
— the zero-dependency floor. `/dataviz` *upgrades* a playground's charts; it never blocks them. (This
keeps the Visual Standard's "single HTML file, zero external deps" rule intact — the fallback needs nothing.)
