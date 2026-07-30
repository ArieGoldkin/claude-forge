# Conduct Routing Map — Emission Templates & Worked Examples

Per-pattern: when it fires, what conduct **emits** (the ready-to-run invocation,
parametrized by `{item}` / `{ticket}` / `{lanes}`), and the recipe it hands off to.
Execution mechanics live in the cited references — this file only parametrizes them.
All cmux verbs verified on cmux 0.64.20.
**Lane primitive re-verified by live execution 2026-07-29**
(`docs/reviews/2026-07-29_conduct-cmux-pane-lane-e2e-test.md`): a terminal pane accepts
`send` / `send-key` / `read-screen`; an `agent-session` surface rejects all three with
`invalid_params: Surface is not a terminal`. Check flags against per-command `--help` — the
top-level `cmux --help` signature is abbreviated and omits real flags (e.g. `new-surface`'s
`--working-directory`).

## Placement branch (applies to every cmux pattern below)

The Container axis (SKILL.md Phase 1) decides WHERE a pattern's sessions land. Resolve it
first; the pattern templates below write `{place:…}` where it applies:

- **nest-under-current** — the current workspace is for this work. **One workspace = one
  workflow**: the caller's pane is the **orchestrator**, and each sub-agent gets its **own
  new pane** — a visible split, never a background tab and never a sibling workspace. Get
  the target workspace from `cmux identify` (`caller.workspace_ref`) — **never** from
  `cmux current-workspace`, which reports the *focused* workspace, not the caller's
  (SKILL.md Phase 1 § Fifth axis):
  ```bash
  WS=$(cmux identify | python3 -c 'import json,sys; print(json.load(sys.stdin)["caller"]["workspace_ref"])')
  OUT=$(cmux new-pane --type terminal --direction right --workspace "$WS" --focus false 2>&1)
  case "$OUT" in
    "OK surface:"*) SURF=$(printf '%s\n' "$OUT" | awk '{print $2}') ;;  # OK surface:50 pane:8 workspace:3
    *) printf 'new-pane failed: %s\n' "$OUT" >&2; exit 1 ;;             # NEVER parse an error line
  esac
  # ABSOLUTE and NOT a system temp dir: lanes cd into their own worktree (a relative path
  # makes each lane write a file the orchestrator can't see), and security-blocker denies
  # ^/var/ + ^/private/tmp/, so a mktemp -d lane can never write. Set it once per fleet run:
  TEAM="$(git rev-parse --show-toplevel)/.develop/team/<run-slug>"; mkdir -p "$TEAM"
  RESULT="$TEAM/<title>-<assignment>.md"   # e.g. auditor-etk.md — roster: agent-fleets.md § Identity
  cmux send     --surface "$SURF" --workspace "$WS" "cd <worktree> && claude \"<one-line task>. Write your findings to $RESULT, and make its LAST line exactly: STATUS: DONE\""
  cmux send-key --surface "$SURF" --workspace "$WS" enter
  ```
  **Every dispatched lane names a result file, and collection reads that file** — via
  `collect_lane "$RESULT"` (`etk:cmux` → `references/read-and-notify.md` §1; it normalizes
  the last line, because a bare `tail -n1` false-negatives on a trailing blank line or a
  fence). Never collect by grepping `read-screen`: the screen echoes the dispatch, so the
  sentinel is present before the lane does anything and a crashing lane reports `DONE`
  (measured 2026-07-29).
  **Capture stderr, then gate the parse on the `OK ` prefix.** Both halves matter:
  cmux writes failures to **stderr**, so *without* `2>&1` a failed `new-pane` leaves `$OUT`
  **empty** and the error message is lost — you fail closed but can't say why. *With* `2>&1`
  you capture `Error: invalid_params: …`, on which an ungated `awk '{print $2}'` would yield
  `invalid_params:` and hand that to `send` as a surface ref, producing a confusing
  *secondary* error instead of the real cause. Verified failure path (exit 1):
  `new-pane --placement dock` → `Error: invalid_params: Dock placement is disabled`.
  Pass `--workspace` explicitly: relying on the implicit default is how a lane ends up in
  the focused workspace instead of the calling one. `new-pane` prints the new surface ref,
  so no discovery call is needed.

  **A driven lane MUST be a terminal pane.** `--type agent-session` surfaces are opaque to
  the CLI: `send`, `send-key` and `read-screen` all fail with `invalid_params: Surface is
  not a terminal`, and `new-pane --type` accepts only `terminal|browser`, so a pane can
  never be one. An agent-session lane cannot be dispatched to, keyed, or collected from —
  it opens empty and stays empty. Reserve agent-sessions for a lane a **human** drives by
  hand; never emit one for an orchestrated lane.

  Neither `new-pane` nor `new-surface` takes a `--command`, and **`new-pane` has no
  `--working-directory`** (only `new-surface` does) — so worktree isolation goes into the
  sent command: `cd <worktree> && claude "<task>"`.
- **join-group** — team-scale work anchored on the current workspace:
  `cmux workspace-group create --name "{slug}-fleet"` (`--from` defaults to the caller
  workspace; verify/fix the anchor with `workspace-group set-anchor`), then
  `cmux workspace-group new-workspace <group>` per member. Group gets `set-color --hex` + `set-icon --symbol <sf-symbol>`; teardown with
  `ungroup` (preserves members) — `delete` closes every member workspace, destructive.
- **new-workspace** — mismatch or outside cmux: the pattern's own named-workspace recipe.

**Invariant: workers are `new-pane` targets — never `new-workspace`, never a background
tab.** A worker is a visible split under the orchestrator's workspace. There are exactly **two**
exceptions: (1) the race (pattern 1), where per-racer workspaces are load-bearing — the completion
event's `workspace_id` identifies the winner; (2) the **sidebar-dashboard tier**
(`cmux/references/agent-fleets.md` § Visibility — 5–8 lanes or a run watched as a board), where
per-lane state pills and progress bars force a workspace per lane. Both still confirm at Phase 3.

**Label at spawn, every placement** — and **always pass `--surface`**. Every targeting flag on
`rename-tab` is optional, so a bare `cmux rename-tab "👑 lead"` renames the **selected** tab,
which is the caller's own session, not the lane you just spawned. Capture the ref that
`new-pane` prints and target it:

```bash
OUT=$(cmux new-pane --type terminal --direction right --workspace "$WS" --focus false 2>&1)
case "$OUT" in                                                      # 2>&1 or the cause is lost:
  "OK surface:"*) SURF=$(printf '%s\n' "$OUT" | awk '{print $2}') ;;  # OK surface:50 pane:8 workspace:3
  *) printf 'new-pane failed: %s\n' "$OUT" >&2; exit 1 ;;             # cmux errors go to stderr
esac
cmux rename-tab --surface "$SURF" --workspace "$WS" "📊 Auditor·etk"   # <glyph> <Title>·<assignment>
```

> **Observed failure, 2026-07-29.** A conduct run emitted a bare `rename-tab "👑 PROJ-4990
> conduct"`, which retitled the operator's *existing, unrelated* working session — a live
> PROJ-4890 branch, an hour of context deep — while creating no lane at all. The visible
> symptom was "the agents never opened"; the actual events were one mislabeled tab and zero
> spawns. Untargeted `rename-tab` is destructive to operator context: never emit one.

`set-status` is workspace-scoped by design, so it needs `--workspace` but has no per-surface
target. Vocabulary in agent-fleets.md § Identity; conduct Phase 4 drives both.

## 1 · Race + verify gate — `cmux/references/agent-fleets.md` § Race dispatch

Fires: diversity = race (hotfix, "prod down", first-good-wins).
Sessions: N (default 3) + one verifier agent. Without cmux: degrade to L1 — run the
fitting fix skill solo and say why (racing needs visible parallel sessions).

```
Race 3 diverse agents on: "{item}" — one workspace each (a race is N one-agent teams),
each labeled by APPROACH at spawn (🩹 Medic·{approach}, one roster.tsv line per racer —
agent-fleets.md § Race dispatch), cmux hooks setup first, block on the FIRST completion
event (match by workspace_id, no jump-to-unread). The first event is NOT the winner — a
racer that refused or errored fires one too: confirm that racer's own result file
($TEAM/racer-<ws>.md, STATUS: as its LAST line) and keep waiting if it has no verdict.
Then route the winner's change through etk:adversarial-verifier BEFORE accepting, report
the winner BY APPROACH (via roster.tsv, not a workspace number), and scoped-close the losers.
{ticket → context line}
```

Placement: racer workspaces are the exception to the invariant (event identification
needs them). When nested context matches, make them **members of a workspace-group
anchored on the current workspace** — sidebar-collapsible, and loser teardown stays
scoped (close each racer, then `ungroup`; never group `delete`).

## 2 · Broadcast fan-out + reconcile — `cmux/references/agent-fleets.md` § Fan-in

Fires: diversity = best-of-N ("compare takes", "which model handles this best").
Sessions: N (default 3). Without cmux: N in-session subagents (single message dispatch)
— you lose the visible panes, keep the ensemble.

```
Stand up 3 agents ({place: 3 terminal panes under the CURRENT workspace |
workspace "vote-{slug}" --env-file .env} — --focus false, each dispatched with
send + send-key enter). Give ALL the same task: "{item}". Label each at spawn,
targeting the ref its own new-pane printed
(rename-tab --surface "$SURF" --workspace "$WS" "<glyph> <Title>·take-a/b/c" — the fitting
roster title for "{item}", same title for all N takes, never bare).
Each writes its take to $TEAM/<title>-take-{a,b,c}.md with STATUS: DONE as that file's LAST line.
Read every answer back FROM ITS FILE (collect_lane to confirm, then the body) and synthesize:
agreements, divergences, singletons — the synthesis is the deliverable, not the relay.
Name every take that did NOT arrive; a 2-of-3 ensemble reported as 3 is a false consensus.
```

**Gate the merge per `agent-fleets.md` § Fan-in.** `collect_lane` confirms a take *finished*,
not that it *said anything usable* — an empty or malformed take passes the sentinel gate and
then silently shrinks the ensemble. Assert the arrived-take count before synthesizing.

## 3 · Pipeline solo — `/etk:fix-bug` · `/etk:develop`

Fires: ticket with 1 lane, **or 2–3 lanes without watch** — the pipeline's own Phase-4
in-session fan-out already covers moderate parallelism; visible panes must be asked for.
**Auto-route by kind**: bug → `/etk:fix-bug {ticket}`, feature → `/etk:develop {ticket}`.
cmux adds nothing here unless visibility = watch, in which case wrap it in ONE lead pane
(pattern 6's shell) — never a fleet.

```
/etk:fix-bug {ticket}        # bug
/etk:develop {ticket}        # feature
# optional watch-pane: run the same command inside a single cmux pane (pattern 6)
```

## 4 · develop-fleet — agent-fleets.md § Running /etk:develop over cmux

Fires: ticket with **watch requested, or 4+ lanes** (2–3 lanes background → row 3).
Sessions: 1 lead + up to {lanes} workers **on demand** (lead-only boot; workers appear
only if the pipeline's Phase 4 decomposes — never pre-laid). Without cmux: run
`/etk:develop {ticket}` solo — its in-session Phase-4 fan-out, no visible panes.

```
In cmux: {place: lead runs IN the current workspace (new terminal pane, 👑) |
workspace "dev-{ticket}" (--focus false, its own git worktree)}. Lead → claude →
/etk:develop {ticket}. When Phase 4 fans out, place each lane as a worker PANE
under the lead's workspace IN ITS OWN worktree (/etk:start-parallel; new-pane
--type terminal, then send 'cd <wt> && claude "<task>"' + send-key enter — new-pane
takes no --working-directory, so the cd belongs in the sent command), label at spawn
(📐 Planner / 🔨 Builder·be / 🔨 Builder·fe / 🧪 Tester — roster titles, agent-fleets.md
§ Identity), wire cmux hooks setup, and give each worker its own result file
($TEAM/<title>-<assignment>.md: planner.md, builder-be.md, builder-fe.md, tester.md) —
collect event-first, joining on that FILE's last STATUS: line
(via collect_lane), never on a sentinel grepped from read-screen.
Workers never get their own workspaces (the invariant). Phase-5 verify stays inside
the pipeline. Teardown: close only what you created — panes first, then the sidebar
state the run wrote (agent-fleets.md § Sidebar teardown); a workspace only
if YOU created it (close-workspace pulls focus even after --focus false).
```

Ticket lands in a durable project workspace you're already in? That IS the match —
nest there; do not mint `dev-{ticket}` beside it.

## 5 · Sweep fan-out / fan-in — `cmux/references/agent-fleets.md` § Fan-in

Fires: divisible job ("audit the repo", "map every module", "sweep N dirs").
Sessions: one per slice (cap ~4; more slices → batch). Lanes must be file-disjoint.
Without cmux: in-session subagent fan-out — all Agent calls in a single message.

```
Split "{item}" across {n} cmux agents ({place: terminal panes under the CURRENT
workspace | one workspace per slice}) — each gets ONE slice ({slices}) via send +
send-key enter, labeled at spawn against the ref its own new-pane printed
(rename-tab --surface "$SURF" --workspace "$WS" "📊 Auditor·{slice}" — same title for
every slice of a sweep, never bare, or you rename the caller's tab), works ONLY its
slice, and writes ≤5 bullets to
$TEAM/auditor-{slice}.md with STATUS: DONE as that file's LAST line.
Agents never see each other; you own the merge. Reconcile with the three-gate fan-in
recipe (collect_lane + payload validation + slice-count assertion), and publish NO
aggregate unless every dispatched slice is accounted for; flag any agent that left its lane.
```

**Reconcile with `agent-fleets.md` § Fan-in — do not hand-roll the merge.** A
`collect_lane`-only gate is *insufficient*: a lane can be honestly `DONE` and still omit the
field, emit a non-numeric value, or restate it twice, and a naive `total=$((total + n))`
absorbs all three as `0`. Measured 2026-07-29: five distinct lane failures silently produced
**30 where the truth was 50**, in bash and zsh alike
(`docs/reviews/2026-07-29_conduct-shard-fanin-e2e-test.md`).

**Re-dispatching a dropped slice is bounded — see `agent-fleets.md` § Give-up bound.** A retry
with no named cause is a re-bill, not a fix; `BLOCKED` and platform outages earn **zero** blind
retries.

## 6 · Single agent in a pane — `cmux/SKILL.md` § Nesting agents under the current workspace

Fires: single task + watch ("run it where I can see it", long build/refactor to steer).
Without cmux: degrade to pattern 7 (L0 solo) and say the watch surface isn't available.

```
In cmux: {place: a new PANE — a visible split — under the CURRENT workspace, labeled against
the ref that new-pane printed (rename-tab --surface "$SURF" --workspace "$WS"
"<glyph> <Title>·{slug}" — the fitting roster title for {item}: 🔨 Builder for a build,
🩹 Medic for a fix; 👁 Watcher ONLY if the lane observes and touches nothing) |
workspace "watch-{slug}" (--focus false) in {repo}}, dispatched with send + send-key enter:
  {item}
Write findings to $TEAM/<title>-{slug}.md with STATUS: DONE as the file's LAST line. Collect with
collect_lane on that file after the completion event — never by grepping read-screen.
```

**A watch lane must be a `new-pane`, not a `new-surface`.** A surface is a background *tab*
in an existing pane: the operator sees nothing until they click it, which defeats the only
axis this pattern exists to serve. Observed 2026-07-29 — a row-6 lane emitted as a
`new-surface` was reported as "I don't see any open cmux sessions" while running correctly
all along.

A terminal/browser watcher that should stay visible without occupying the grid can dock:
`new-surface --placement dock` (terminal/browser surfaces only — agent-sessions can't dock).
**Dock is config-gated**: with no `.cmux/dock.json` or `~/.config/cmux/dock.json` it exits 1 with
`Error: invalid_params: Dock placement is disabled`. Treat it as optional and check the exit code
— don't make a lane depend on it.

## 7 · L0 solo — no cmux

Fires: single background task (quick check, one-file change, "does it pass").
Emission is just doing the work — run it in the current session (or the fitting skill:
`/etk:verify`, `/etk:cover`, …). Confirm inline, no box. A pane here is pure overhead.

## Worked examples (the six presets — double as the routing mini-benchmark)

| Item | Classified | → Pattern |
|---|---|---|
| "restore the broken checkout flow" (PROJ-1234, prod down) | single · race · watch | **1 · Race + verify** |
| "build the user preferences page" (PROJ-2200, be+fe+tests+docs) | ticket · 4+ lanes · watch | **4 · develop-fleet** |
| "fix the null-guard in the date parser" (PROJ-1187) | ticket · 1 lane · bug · background | **3 · `/etk:fix-bug PROJ-1187`** |
| "find the top security risks across the repo" | divisible · 4 slices | **5 · Sweep** |
| "design the notifications API — I want three takes" | single · best-of-N | **2 · Broadcast** |
| "does the build pass" | single · background | **7 · L0 solo (`/etk:verify`)** |

Misroute checks (the disambiguations that matter): a ticket that *mentions* frontend and
backend but changes one file is **1 lane** (row 3, not 4 — lanes are file-disjoint work
streams, not nouns in the ticket); "quickly check 3 modules" is one divisible job (row 5),
not a race — race requires the SAME target attempted redundantly on purpose.
