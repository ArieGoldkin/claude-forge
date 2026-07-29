# Issue #80 — empirical probe: do plugin-registered `CwdChanged` / `FileChanged` hooks fire?

> Date: 2026-07-28 · CC **2.1.220** · ctk **2.10.0** (the copy actually loaded — see §2)
> Method: live instrumentation + captured markers. **No inference from the binary.**
> Verdict: **the issue's stated hypothesis is REFUTED for `CwdChanged`.** `FileChanged` is a
> different problem than the issue describes. One question remains, testable only in a fresh session.

---

## 0. What the issue claimed

> the `CwdChanged` emitter's call site gates on `Fie()`/`Wne()` (settings hooks) and **never consults
> `gQ()`**, the plugin-hook registry … If the gate genuinely skips the plugin registry for these
> events, both are **silently inert**.

That is the claim under test. It was explicitly filed as *flagged, not asserted*.

## 1. Probe design

`ctk`'s `CwdChanged` and `FileChanged` entries are **not** TypeScript handlers — they are `command`
hooks invoking `hooks/bin/monitor-forward.sh`. That script forwards to an optional HTTP endpoint and
**leaves no trace** when `CONTINUITY_MONITOR_URL` is unset (it is unset here), which is why no
passive log evidence existed.

Two properties made a no-restart probe possible:

- **`hooks.json` is read at plugin load, but the script it invokes is read at exec time.** Editing
  `monitor-forward.sh` changes behaviour *without* re-registering anything, sidestepping the repo's
  "a plugin change is inert in the session that makes it" trap. The wiring under test was the wiring
  already loaded at session start.
- **`monitor-forward.sh` is also wired to `PostToolUse`** — a high-frequency event on the *same
  script, same plugin, same load path*. That is the built-in control: it isolates the **event** rather
  than the mechanism. If `PostToolUse` markers appear and `CwdChanged` markers do not, the event is
  the anomaly, not the instrumentation.

Instrumented **both** on-disk copies with distinct tags (`A-marketplace-clone`, `B-cache-2.10.0`) so
the probe would also reveal which copy CC actually loads. A **settings-level** `CwdChanged` hook was
added as a second control to answer the question the `PostToolUse` control cannot: *would this event
have fired for a settings hook?* Without that, "no marker" is unfalsifiable — it could mean the event
never fires on a Bash `cd` at all.

## 2. Which copy CC loads — an incidental finding

**All 24 plugin-side markers carried tag `B-cache-2.10.0`. Tag `A-marketplace-clone` fired zero times.**

CC loads from `~/.claude/plugins/cache/claude-forge/ctk/<version>/`, not from the marketplace clone
at `~/.claude/plugins/marketplaces/claude-forge/`.

Separately: `installed_plugins.json` records `installPath … /ctk/2.10.2`, and **that directory does
not exist**. The highest version present is `2.10.0`, which is what ran. The recorded metadata and
the on-disk reality disagree. Not pursued here; worth its own look.

## 3. Results

Six rounds, raw markers in the session scratchpad (`issue80-markers.tsv`, 39 lines).

| Round | Condition | Real cwd changes | plugin `CwdChanged` | settings `CwdChanged` |
|---|---|---|---|---|
| 1 | **before any `ConfigChange` this session** | 2 | **0** | (not registered) |
| 2 | after settings hook added (`ConfigChange` 20:10:40) | 2 | **2** | **2** |
| 3 | **settings hook REMOVED** (`ConfigChange` 20:11:28) | 2 | **2** | **0** |
| 5 | no config edit since 20:11:28 | 2 | **2** | (not registered) |

Controls: `PostToolUse` fired **24** times on the same script throughout, so the instrumentation and
the plugin command-hook mechanism were live in every round, including round 1.

Every cwd change was verified real by `pwd` before and after, not assumed from the `cd` exit code.

### 3a. `CwdChanged` — hypothesis refuted

**Round 3 is decisive.** With the settings-level hook removed and only the *plugin* registration
present, the plugin hook fired for both cwd changes. Round 5 reproduced it with no config activity at
all.

**Plugin-registered `CwdChanged` hooks do fire. The gate does reach the plugin registry.** The
issue's central claim is false as stated.

### 3b. `FileChanged` — zero firings, and *not* a plugin-registry question

`FileChanged` fired **zero** times, from the plugin hook **and** the settings hook, across six varied
mutations: Write-tool file creation, Edit-tool mutation, three shell appends, and a `touch`.

Because the **settings** hook is equally silent, this cannot be the plugin-registry defect the issue
describes. Either `FileChanged` fires on some other trigger entirely (an external/IDE file-watcher
path?), or it does not fire in this environment. **Its actual trigger is unknown and unclaimed.**

## 4. The one open question — the arming anomaly

Round 1 is unexplained. Before any `ConfigChange` occurred this session, two genuine cwd changes
produced **zero** `CwdChanged` markers — while the `PostToolUse` control on the same script fired
normally. From the first `ConfigChange` onward the event fired reliably and kept firing without
further config activity ("armed once, stays armed").

Best-fit hypothesis: **plugin-registered `CwdChanged` is not armed until the first config reload.**

If that holds, it matters: in a normal session where the user never edits settings, ctk's
`CwdChanged` wiring would never fire — reaching the issue's *conclusion* (effectively inert) by a
different *mechanism* than the issue's stated cause. That is a materially different defect and a
different fix.

**This is not testable in-session** — the condition is "no config reload has happened yet", and this
session has had three. It needs a fresh session with the instrumentation in place and no settings
edits.

## 5. Limits of this determination — stated, not buried

- **The `FileChanged` settings-hook entry was never independently observed firing.** Its sibling
  `CwdChanged` entry — written in the same edit, same file, structurally identical — demonstrably did,
  so the registration *mechanism* is proven. The specific `FileChanged` entry is not. This is the
  "a must-fail control proves only the half it touches" caveat, recorded rather than glossed.
- **No static/binary verification was done.** Issue questions (1) "is that really the only emitter?"
  and (3) "defect or intended?" remain **open**. The empirical result outranks the static claim for
  question (2), but a second emitter would change the explanation of round 1.
- **Single environment**: macOS, CC 2.1.220, one ctk version, Bash-tool `cd` as the only cwd-change
  mechanism. Other cwd-change paths were not exercised.
- One intermediate tally in-session read **4** plugin firings where the raw file shows **6** — the
  read raced the probe mid-round. Counts here are from the raw 39-line file, not from that tally.

## 6. Recommendation

**Do not change any wiring yet.** The issue's premise is refuted, so the change it implies (remove
the hooks as inert) would be made for a reason now known to be wrong.

Next step is the fresh-session arming test in §4. Its outcome decides between:

- *fires normally from session start* → **close #80**, no code change; correct the issue's static
  reading.
- *needs a config reload to arm* → re-scope #80 to the arming defect, and treat `FileChanged` as a
  **separate** issue, since its trigger is unidentified and settings hooks are silent for it too.

## 7. Restoring the probe

Instrumentation is **still in place** to permit the fresh-session test. Both copies have backups
alongside them:

```
~/.claude/plugins/cache/claude-forge/ctk/2.10.0/hooks/bin/monitor-forward.sh.issue80-bak
~/.claude/plugins/marketplaces/claude-forge/plugins/continuity-toolkit/hooks/bin/monitor-forward.sh.issue80-bak
```

Restore by moving each `.issue80-bak` back over its `monitor-forward.sh`. Settings hooks added for
this probe have already been removed; `.claude/settings.local.json` is back to the `TeammateIdle`
dumper only, and the working tree is clean.
