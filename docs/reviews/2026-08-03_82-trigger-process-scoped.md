# #82 — the trigger is process-scoped, not machine-scoped

> Investigation date: 2026-08-03 · Route: `/etk:auto-research` → `diagnose` → `/etk:fix-bug` (OHAOI)
> Status: **root cause identified with a mechanism for the persistence and scope; the initial
> perturbation remains bracketed but not proven.** #82 should stay open — see "Not established".
> Read-only investigation. Nothing was repaired, installed, or updated during it, because the
> issue's own instruction is that repair destroys the evidence.

## The one-sentence answer

The 2026-07-29 outage was **confined to a single Claude Code OS process**, not to the machine:
a concurrent CC process was firing claude-forge hooks normally throughout the same hours. Plugins
are resolved **once, at process startup**; the process that started at `03:28:15.598Z` resolved
**zero** claude-forge plugins and could never recover, which is why it stayed silent for ~15.5
hours across many resumed sessions and why repairing on-disk state at `03:33` changed nothing.

This is why every global artifact the issue examined looked healthy. **They were healthy.**

## Timeline (all UTC, all measured)

| Time | Event | Source |
|---|---|---|
| `2026-07-27 17:48:20` | marketplace clone last moved, to `b0144c9` | reflog |
| `2026-07-29 03:27:13.443` | last prompt of the healthy session | `history.jsonl` |
| `2026-07-29 03:28:10.856` | user runs **`/exit`** | `history.jsonl` |
| `2026-07-29 03:28:14.469` | `.last_inuse_sweep` written (**+3.6 s**) | issue #82 |
| `2026-07-29 03:28:15.598` | **process starts, 0 forge hooks** (**+1.13 s**) | `b0a7c248` transcript |
| `2026-07-29 03:28:20.501` | `/rc` → bridged to claude.ai/code | `history.jsonl` |
| `2026-07-29 03:28:23.073` | **`/resume`** → into `1ffd512a` | `history.jsonl` |
| `2026-07-29 03:33:09` | marketplace pull `bb30ede` — **the credited "repair"** | reflog |
| `2026-07-29 03:33:11.874` | ctk `installedAt` rewritten | `installed_plugins.json` |
| `2026-07-29 ~04:00–18:00` | **still zero forge hooks**, across many resumes | `1ffd512a` |
| `2026-07-29 18:13:29` | marketplace pull `47b31a7` | reflog |
| `2026-07-29 ~19:00` | forge hooks **return** on a fresh SessionStart | `1ffd512a` |

## Established by measurement

### 1. The symptom is unique and precisely localized
Across **114 sessions** carrying SessionStart records (2026-06-30 → 2026-08-02), exactly **one**
has zero claude-forge SessionStart hooks: `b0a7c248`. Healthy baseline is **6** forge hooks
(`session-loader`, `repo-access-guard`, 4× `continuity-recommendation`) plus cmux and one null.

### 2. The outage was ~15.5 hours, not "a whole session"
`1ffd512a` is a single transcript that brackets the event with a healthy before *and* after:

| Window | forge hook firings |
|---|---|
| 07-28 19h–20h | 6 SessionStart, 98 PreToolUse, 37 PostToolUse |
| **07-29 03h → 18h** | **0, every hour** |
| 07-29 19h onward | 6 SessionStart, then normal |

### 3. ⚠ The failure was PROCESS-SCOPED — this is the finding
During the identical hours, the concurrent session `93ea1008` fired forge hooks **normally**:
41 in the 03h window, 60 at 12h, 142 at 14h, 85 at 18h. Two CC processes, one machine, one disk,
one instant — **one with plugins, one without.**

No shared on-disk artifact can explain that. It positively rules out every global-state
hypothesis, including the ones #82 was still holding open.

### 4. The mechanism for persistence: resolve-once-at-startup
Plugins are resolved when the process starts. The broken process resolved zero and held that set
for its whole life. Every `/resume` inside it inherited the empty set. This explains, without
further assumption:
- why it persisted ~15.5 h across many sessions;
- why `claude plugin list` honestly reported all five enabled (**separate process**, reading a
  healthy disk);
- why the `03:33` repair did nothing;
- why only a **new process** (~19:00) recovered.

### 5. The credited repair did not repair anything
The issue credits `claude plugin marketplace update claude-forge` with restoring loading
"mid-session, without a restart". Measured: that pull landed at `03:33:09`, and forge hooks did
**not** return — they stayed at zero for another ~15 hours. Recovery coincides with a fresh
process at ~19:00, after the `18:13:29` pull. The repair changed on-disk state that was already
fine and could not reach the running process.

## Refuted by measurement

| Hypothesis | Refutation |
|---|---|
| Marketplace clone staleness | **47 healthy sessions ran a staler clone** than the broken one (121,195 s), up to **129 h**. |
| `plugin-catalog-cache.json` corruption | It contains only the **official** catalog — LSP plugins and `security-guidance`. **No claude-forge entries at all.** Cannot be the mechanism. |
| Exit→start race (timing alone) | **Nine** other sessions started **3–8 s** after an `/exit` and all nine loaded plugins normally. The broken one sits mid-band at 5 s. |
| Any global on-disk cause | Refuted outright by finding 3 — a sibling process was healthy at the same instant on the same disk. |

## Not established

- **What the sweep actually did at `03:28:14.469Z`.** The 1.13 s adjacency to the broken process
  start is the tightest bracket available, and the sweep is the only state-mutating event in the
  window — but this is **n=1 correlation, not mechanism**. `.last_inuse_sweep` holds a single
  overwritten timestamp, so no sweep history exists and the "9 healthy sessions at 3–8 s" control
  **cannot** confirm a sweep even ran at those exits. Do not upgrade this to a cause.
- **Why that process resolved zero plugins.** Bracketed to a 4.7 s window; the perturbation itself
  is unobserved. A live recurrence is still required — but see the next section, which changes what
  a recurrence would cost to catch.

## Consequence for ctk 2.18.0 (the shipped liveness reader)

`hook-liveness.ts` states in its header that the reader *"would **not** have caught the 2026-07-29
event, and must not be described as closing #82."* **That is correct about `b0a7c248` and too
strong about the event.** The predicate is:

```ts
return promptAt - stampedAt > graceMs ? 'suspect' : 'healthy';
```

- For `b0a7c248` — brand-new session, no hook ever ran, **no marker** → `unknown` → silent. As documented.
- For `1ffd512a` — **resumed**, so the session id is reused and a marker **already existed** from its
  healthy 07-28 period. Users prompted repeatedly through 07-29. `promptAt - stampedAt` ≈ **hours**
  versus a 30 s grace → **`suspect`**.

So the reader would have stayed silent for the first few seconds and then fired for the remaining
~15.5 hours — i.e. for the part that actually cost something.

This does **not** close #82, and the header's core reasoning stands. It does mean the shipped
reader's value on this incident class was **understated**, and the header's blanket sentence should
be narrowed to the session-start case it actually describes.

### ✅ The contingency is now discharged (measured 2026-08-03)

This section originally labelled itself **contingent** on the tmp marker surviving the ~7.5 h gap,
which was the one unmeasured link in what shipped to #82. It has since been measured, in the two
halves it decomposes into:

**Survival** — on the same `/var/folders/…/T` that `sessionScopedTmpPath` writes to:

| Question | Measurement |
|---|---|
| Passive survival (mtime == atime, never re-read) | **≥25.3 h** — 3.4× the gap |
| Survival where a read refreshes atime | **98 h** |
| Reboot inside the incident's gap? | **No.** Reboots bracket it: Jul 15, then Jul 29 `19:15Z` — *after* the `03:28Z` resume |
| Would a reboot have wiped it anyway? | **No.** A file **46 h older than the last boot** is still present |
| Does any ctk code unlink markers? | **No.** The two `unlinkSync`/`rmSync` sites are a `.json`-only snapshot pruner and a `~/.claude/cache` root — neither reaches tmp |

**Predicate** — driving the real module (not a reimplementation), 8/8 including a must-fail control:

| Case | Verdict |
|---|---|
| Marker 7.5 h stale, prompt 1 min ago | `suspect` ✅ |
| Marker 15.5 h stale (full outage) | `suspect` ✅ |
| **Fresh stamp (must-fail control)** | `healthy` ✅ |
| No marker (the `b0a7c248` case) | `unknown` ✅ |
| Stale marker, no genuine prompt (long turn) | `unknown` ✅ |
| 29 s stale / 31 s stale (grace boundary) | `healthy` / `suspect` ✅ |

**Third dependency, also checked**: the reader runs at all inside a zero-plugin process, because
ctk's statusline launcher (`~/.config/claude/continuity-statusline.sh`) resolves its script with a
filesystem `find` over the plugin cache — not through plugin resolution.

⚠ **One refinement the original text got slightly wrong.** The banner does *not* fire at the instant
of resume: at that moment the newest prompt still predates the stamp, which is `healthy` by
construction. It is the first **new** prompt in the resumed session that makes the gap evidence.

`hook-liveness.ts`'s header has been narrowed accordingly. The correction is comment-only —
`dist/**/*.js` is byte-identical, so no version bump.

## Suggested next steps (proposed, not applied)

1. ✅ **DONE (2026-08-03)** — **Narrowed the `hook-liveness.ts` header claim** to the
   brand-new-session case, and recorded that a resumed session with a surviving marker evaluates to
   `suspect`. The tmp-marker survival assumption was measured first; see "The contingency is now
   discharged" above.
2. **Update #82** with the process-scoped finding, the corrected repair attribution, and the
   refutation table. The issue currently directs a future investigator at global artifacts that are
   now measured healthy.
3. **Revise the issue's "what to capture if it recurs" list** — it is aimed at global state. The
   discriminating capture is now: which *process* is affected, whether a sibling process is healthy,
   and `claude --output-format stream-json -p test | jq '.init.plugin_errors'` run **inside the
   affected process's environment**.

## Reproduction of the measurements

Scripts used are in the session scratchpad; each is re-runnable read-only:
`join-v2.sh` (session ↔ exit/pull join, **UTC-correct**), `window-activity.sh`,
`sessionstart-census.sh`.

⚠ **Two probe defects were found and fixed mid-investigation**, both of which had produced
confident wrong answers:
- `date -j -f` without `-u` parsed UTC transcript timestamps as local (+0300), shifting every
  session start 3 h and corrupting **both** joins. Caught only because a sanity check demanded the
  broken session show ~4 s and it showed 329,815 s.
- `2>/dev/null` on a `jq` extraction hid the resulting mismatch. Same class as the ledger's
  existing stderr-suppression note.
