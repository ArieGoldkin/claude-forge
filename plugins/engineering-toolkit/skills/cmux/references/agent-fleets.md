# Agent Fleets — Composing cmux into Multi-Agent Teams

How to assemble cmux primitives (workspaces, panes, events, layouts) into an operating
multi-agent fleet: tiered teams, race dispatches, and running `/etk:develop` over cmux.
Pattern source: disler/learning-cmux-with-agents (adapted); verbs verified on cmux 0.64.20.

## Where tiers are legal (read first)

The dispatch ladder's structural constraint — *agents cannot spawn agents; the main loop
IS the orchestrator* (`agent-loops/references/dispatch-policy.md`) — applies **within one
Claude Code session**. A cmux fleet routes *around* it, not through it: every pane runs
an **independent CC session**, each its own main loop with its own L0–L3 dispatch rights.

```
you (orchestrator session)          ← drives cmux via send/read/events
└── workspace "team-<feature>"      ← one team = one workspace
    ├── pane: lead session          ← an independent main loop
    │     └── may run its own L1/L2 subagents (in-session, ladder applies)
    └── panes: worker sessions      ← independent main loops, one lane each
```

So "orchestrator → lead → worker" is **cross-process composition**, not nested
delegation. Each session still obeys the ladder internally; the fleet is how you get a
third tier without violating it.

## Layout conventions

- **Placement first** (conduct's Container axis): **one workspace = one workflow.** When the
  CURRENT workspace is for this work, the team lives UNDER it — the caller's pane
  orchestrates and every worker is its own **terminal pane**
  (`new-pane --type terminal`, then `send` + `send-key enter` to launch its role agent).
  **Never `--type agent-session` for a driven lane**: those surfaces reject `send`,
  `send-key` and `read-screen`, so the lane opens empty and cannot be collected from
  (SKILL.md § Nesting agents under the current workspace). **One team = one workspace** is
  the shape when no matching container exists; at team-of-teams scale, prefer a
  **workspace-group anchored on the current workspace** over loose siblings — collapsible,
  color/icon-labeled, `ungroup`-teardown. Reuse the open window; never close a workspace
  you didn't create.
- **Invariant: workers are `new-pane` targets — never `new-workspace`, never a background
  tab** — with exactly **two** named exceptions: (1) race dispatch, below, where per-racer
  workspaces identify the winner by event `workspace_id`; (2) the **sidebar-dashboard tier**
  (§ Visibility — 5–8 lanes or a run watched as a board), where each lane needs its own
  workspace because state pills and progress bars are workspace-scoped. Both still confirm at
  conduct's Phase 3 like any multi-session pattern.
- Lead in the left pane, workers in a grid to the right (`new-split` from named refs).
- Boot the whole team in **one call** with `workspace create --layout '<json>'`
  (SKILL.md § Declarative layout): each surface's `command` launches its role agent.
- **Roster discipline**: capture refs from `--json` at creation and write a roster file
  (`role → surface ref`). Anchor re-attachment to the **window UUID** — short refs
  renumber (Critical Rule 7); rediscover them at use time via `list-pane-surfaces`.

## Identity — a lane is a teammate: job title + assignment, never an index

A fleet you can't tell apart is a fleet you misroute. Name lanes the way you'd introduce
an engineering team: **who they are (title) on what (assignment)** — `📊 Auditor·etk`,
`🔨 Builder·be` — never by position (`shard-2`, `agent-3`). An index identifies nothing:
when the fan-in reports a drop you want it to read like a standup ("Auditor·dtk-atk didn't
report"), naming the missing *work*, not a number you must dereference. The **orchestrator**
labels every lane at spawn (proven pattern: agents never label themselves), and **re-labels
on hand-off** — a pane titled with yesterday's ticket doing today's work misroutes the human.

**The roster** — a small closed set; the *assignment* varies per lane, the titles don't:

| Glyph | Title | Responsible for (one sentence — it IS the banner line) |
|---|---|---|
| 👑 | Lead | dispatches, collects, merges, decides — never does lane work (exactly one per fleet) |
| 📐 | Planner | turns the ticket into a plan with acceptance criteria |
| 🔨 | Builder | implements one bounded piece — assignment says which (`Builder·be`, `Builder·fe`) |
| 🧪 | Tester | writes/runs tests against the plan's criteria |
| 🔍 | Reviewer | critiques a diff/doc; finds what's wrong, fixes nothing |
| 📊 | Auditor | counts, scans, measures one slice; reports numbers |
| 🩹 | Medic | reproduces and fixes one bug — in a race, assignment names the *approach* (`Medic·null-guard`) |
| ✅ | Verifier | tries to REFUTE the winner/candidate before acceptance |
| 👁 | Watcher | observes a long run the human wants visible; touches nothing |

Rules that make it work:
- **Glyph = title, text = assignment. Same job → same glyph.** Distinguish lanes by glyph
  *shape*, never by color-circle emojis — 🔵🟢🟡 render as identical dots at tab size
  (measured 2026-07-29: three tabs all showing "●"). 👑📊🧪 survive any rendering.
- **Assignment slugs are shell-safe and become filenames**: lowercase `a-z0-9-`; the result
  file is `$TEAM/<title>-<assignment>.md` (`auditor-etk.md`, `medic-null-guard.md`) so
  every collect/fan-in line names the work. Never use lane names as shell *variable* names
  (dashes are invalid in variable names — live-hit 2026-07-29).
- **Tab title** (one call, the 90% case): `cmux rename-tab --workspace "$WS" --surface "$S"
  "📊 Auditor·etk"` — fits the ~15 visible chars of a tab.
- **In-pane banner** where tabs aren't enough (same-workspace grids): print title +
  responsibility INTO the pane — surfaces have no color attribute, so identity is printed
  content. One line is the idiom (no multi-line ASCII art):
  ```bash
  ident() {  # $1=surface $2="TITLE·assignment" $3=bg 1-6 $4=glyph $5=responsibility
    cmux rename-tab --workspace "$WS" --surface "$1" "$4 $2"
    cmux send --surface "$1" "clear; printf '\033[1;97;4${3}m  $4 %s  \033[0m— %s\n' '$2' '$5'"
    cmux send-key --surface "$1" enter
  }
  ident "$S" "Auditor·etk" 4 "📊" "counts SKILL.md files >150 lines under etk only"
  ```

## Visibility — the sidebar is the dashboard, the file is still the truth

Identity says *who*; these say *how it's going*. All verified live on cmux 0.64.20:

- **State pill** (`set-status`): `cmux set-status state "working" --workspace "$W"
  --color '#1565C0' --icon gearshape` — flip on each `collect_lane` return:
  `0` → `done` `#196F3D` · `2` → `BLOCKED` `#C0392B` + `trigger-flash` · still-running →
  leave `working`. **The pill mirrors the result file, never replaces it** — state shown
  anywhere outside the file is liveness/attention, not verdict (§ Fan-in's contract is
  unchanged by anything visual).
- **Progress**: `cmux set-progress 0.66 --label "2/3 collected" --workspace "$W"` — drive it
  from the fan-in census (`got/expected`), the one number that cannot overstate.
- **Activity line**: `cmux log --workspace "$W" "auditor-etk ✓ 19 (file verified)"` — an
  append-only audit trail per workspace, free to write, survives scroll.
- **Attention**: `cmux trigger-flash --surface "$S"` — the non-destructive "look HERE" for
  an escalated lane; never `focus-*` (Critical Rule 2).
- **Workspace color** (workspace-per-lane fleets): `cmux workspace-action --action set-color
  --workspace "$W" --color Blue` — 16 named colors or hex; 👑 Lead's workspace is always
  Purple, one per fleet.
- **Container ladder** (extends conduct's Container axis): **≤4 lanes** → panes in the
  current workspace, the grid is the dashboard · **5–8 or watch-heavy** → one colored
  workspace per lane, the sidebar is the dashboard (this is the Container axis's **named
  exception 2** — legal because pills/progress are workspace-scoped; conduct still
  confirms it at Phase 3) · **>8, multi-role** → `workspace-group`
  per title (collapse the 🔍 Reviewers, scan the 🔨 Builders) · **separate concerns** → one
  window per concern, same socket drives all. ⚠ Group teardown: `workspace-group ungroup`
  keeps the member workspaces; **`delete` closes every workspace in the group** — never use
  `delete` on lanes you didn't create.

> **Do not re-import the upstream playbook's collect step.** These visibility patterns are
> adapted from disler/learning-cmux-with-agents (prompts 13/22/26/31) — but its fan-in
> (prompt 12) and `.team` contract collect by polling `read-screen` for a sentinel, which is
> exactly the false-green measured and removed in etk 2.26.0. Adopt its *visual* layer only;
> collection stays file-based per § Fan-in.

## Dispatch contract (into a pane agent)

1. **One task = one line.** `send` submits a separate prompt per newline (SKILL.md
   § Send Input). Inline structure: `Steps: (1) … (2) … (3) …`.
2. **Dictate a result FILE in the dispatch, and collect from it.** Give every lane its own
   path (`$TEAM/<title>-<assignment>.md`, § Identity) and require the Subagent Status Protocol line
   (`STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`) as that file's **last
   line**. The file is the completion contract; `collect_lane` (read-and-notify.md §1) is the check.
   **Never grep the sentinel off `read-screen`** — the screen also shows the dispatch you
   typed, so the token is present before the lane has done anything, and a crashing lane
   reports DONE (measured 2026-07-29; full mechanism in `references/read-and-notify.md` §1).
   SCOPE-restate rules (root `CLAUDE.md`) apply to pane agents exactly as to `Agent`-tool
   subagents.
3. **Lane restrictions are advisory** — a prompt rule ("only touch backend/") does not
   prevent collisions. For parallel *writes*, give each worker session its **own git
   worktree + branch** (`/etk:start-parallel` Step 2); cmux workspaces isolate the view,
   worktrees isolate the files. **Worktrees do NOT isolate the active venv** — a stale
   `VIRTUAL_ENV` from a sibling worktree silently leaks into `uv run`/`pytest`; dispatch
   Python lanes with `env -u VIRTUAL_ENV uv run --with pytest pytest` (live-verified).
4. **Wait on events, not polls** — the full doctrine (event stream, verify-after-event,
   refusals-notify-too) is `references/read-and-notify.md`. Cite it; don't reinvent it.
5. **Shared memory as files**: the same `$TEAM` directory that holds each lane's result file
   (item 2) also carries the roster and any cross-lane notes. `$TEAM` must be an **absolute**
   path outside system temp — `read-and-notify.md` §1 has the rule and why both halves bite.
   This is not merely cheaper than screen-scraping — it is the only sound way to read a
   conclusion, for the reason in item 2.

## Race dispatch (same task, N diverse agents, first verified answer wins)

Deliberate duplicate attempts **invert** the usual dedup discipline (one lane per unit of
work), and are exempt from the fan-out-theater failure mode
(`agent-loops/references/dispatch-policy.md` § Failure modes) *only when diversity of
attempt is the goal* (a hot fix needed now; heterogeneous models/tools attacking one
problem). Recipe:

**Race topology**: give each racer its **own workspace** (exception to one-team-one-workspace —
a race is N one-agent teams), so the completion event's `workspace_id` identifies the winner.
Label racers by **approach**, not index — `🩹 Medic·null-guard`, `🩹 Medic·revert-path`
(§ Identity) — so "the winner" names a strategy. Result files stay **workspace-keyed**
(`racer-$ws.md`): the event only carries `workspace_id`, so the file must be derivable from
it. Bridge the two with one roster line per racer at dispatch —
`printf '%s\t%s\n' "$ws" "Medic·null-guard" >> "$TEAM/roster.tsv"` — and translate in the
report; do not rename the files themselves (that would re-key a tested recipe on data the
event doesn't carry).

```bash
cmux hooks setup                                        # completion → notify, once
# dispatch the same one-line task to N racer surfaces (send + send-key enter)

# The FIRST EVENT IS NOT THE WINNER — a racer that refused or errored fires one too. So this
# MUST be a loop over the event stream, NOT `events --limit 1`: with --limit 1 there is no
# "next event" to fall through to, and a bare `|| continue` outside a loop does not skip —
# bash only warns ("continue: only meaningful in a for/while/until loop") and then RUNS THE
# NEXT LINE, reaching the gate for a racer that failed collection. That is a fail-open in the
# race gate. Use process substitution, not a pipe: a pipe runs the body in a subshell, so the
# winner's $ws/$s would be lost after the loop.
winner_ws=""
while IFS= read -r evt; do
  ws=$(jq -r '.workspace_id // empty' <<<"$evt")        # match by workspace — NOT jump-to-unread (focus steal)
  [ -n "$ws" ] || continue
  collect_lane "$TEAM/racer-$ws.md" || continue         # no terminal verdict → not the winner, keep waiting
  winner_ws="$ws"; break
done < <(cmux events --name notification.created --no-heartbeat)

[ -n "$winner_ws" ] || { echo "no racer produced a verdict" >&2; exit 1; }
s=$(cmux list-pane-surfaces --workspace "$winner_ws" --id-format both | head -1)  # resolve the racer's surface
cmux read-screen --surface "$s" --scrollback --lines 60 # context only; defaults to the CALLER's surface otherwise
# verdict came from the file → now gate it:              losers: scoped close-surface each
```

**The winner's change must pass `etk:adversarial-verifier` before acceptance** —
first-to-green is not verified-green. Then close the losers individually (Critical
Rule 8), and record the outcome in the roster/notes dir.

## Fan-in (sweep / broadcast) — reconciling N slices into one answer

The race gate above picks **one** lane's answer. Sweep and broadcast instead **combine every**
lane's answer, and that needs its own gates. `collect_lane` is necessary but **not sufficient**:
it validates the *sentinel*, while the reconcile reads a *different field* — so a lane can be
honestly `DONE` and still poison the aggregate.

**Measured 2026-07-29** (`docs/reviews/2026-07-29_conduct-shard-fanin-e2e-test.md`): with a
`collect_lane`-only gate, three failure shapes pass as `DONE` and corrupt the total — a lane that
omits the field, one that writes a non-numeric value, and one that restates the field twice. Five
distinct lane failures all silently produced **30 where the truth was 50**: same value, no warning,
indistinguishable from each other *and* from a legitimate 30. `$((total + n))` treats an empty **and**
a non-numeric `n` as `0`, in **bash and zsh alike** — unlike the race recipe's `|| continue`, no shell
accidentally saves you.

```bash
# THREE gates. Dropping any one of them reintroduces a silent wrong answer.
#   (1) collect_lane        — did the lane finish?      (no file / empty / BLOCKED)
#   (2) payload validation  — is the datum usable?      (missing / non-numeric / restated)
#   (3) slice-count assert  — did EVERY slice arrive?   (the one that makes a gap loud)
set -- auditor-etk auditor-dtk-atk auditor-ftk-rest   # exactly what you dispatched — title-assignment
expected=0; got=0; total=0; dropped=""                # slugs (§ Identity), so a drop names the WORK
# `set --` + "$@", NOT `for s in $STRING`: zsh does not word-split an unquoted expansion, so a
# space-separated string collapses to ONE slice (expected=1) and the assertion below rejects
# every valid fleet. Verified in both shells 2026-07-29. Do not "simplify" this back to a string.
for s in "$@"; do
  expected=$((expected + 1)); f="$TEAM/$s.md"
  collect_lane "$f" >/dev/null; rc=$?
  case $rc in
    0) ;;                                                          # finished → check the payload
    2) dropped="$dropped $s(escalate)"; continue ;;                # BLOCKED/NEEDS_CONTEXT — surface it
    *) dropped="$dropped $s(no-verdict)"; continue ;;              # never wrote / died mid-write
  esac
  k=$(grep -c '^COUNT:' "$f")                    # exactly ONE field line, or it is not a datum
  [ "$k" = 1 ] || { dropped="$dropped $s(COUNT x$k)"; continue; }
  v=$(grep '^COUNT:' "$f" | awk '{print $2}')
  case "$v" in ''|*[!0-9]*) dropped="$dropped $s(non-numeric:$v)"; continue ;; esac
  total=$((total + v)); got=$((got + 1))
done
# The assertion is the whole point: a partial fleet must NEVER publish a total.
[ "$got" = "$expected" ] || {
  printf 'INCOMPLETE FAN-IN: %s/%s slices; dropped:%s — no total published\n' \
         "$got" "$expected" "$dropped" >&2; exit 1; }
printf 'TOTAL: %s (all %s slices accounted for)\n' "$total" "$expected"
```

`COUNT:` is the example field — substitute whatever datum the slices emit. **The gates generalize,
the field does not.** For non-numeric aggregates (findings lists, file maps) keep gates (1) and (3)
verbatim and replace (2) with a shape check on that payload; the failure mode is identical — a
missing or malformed section silently shrinks the merged result.

> **Never publish a partial aggregate as if it were whole.** `routing-map.md` §5's *"do not silently
> drop it"* is this code. Prose cannot execute, which is exactly how the fail-open survived: the race
> path got a hardened recipe in 2.26.0 and this path got a sentence.

## Give-up bound — when to STOP re-dispatching

The census refuses a partial aggregate but never says how many times to try again. Driven once live
(`docs/reviews/2026-07-30_redispatch-fleet-test.md`): a refused 2/3 census named the dropped lane,
**one** corrected re-dispatch into the same pane landed, and round 2 published **260 = ground truth
260** (per-lane 98/73/89 exact). That is the success path. Unbounded retry is the expensive failure —
a round costs **~$0.57 per lane**, and one outage-bound lane measured **$8.43 in a single round**.

**A retry is only a retry if you changed something.** The re-dispatch that worked was not the same
dispatch sent twice: the orchestrator had diagnosed the cause (a relative `$TEAM` path,
`read-and-notify.md` §1) and corrected it. Re-sending an identical dispatch into identical
conditions re-bills the full context for the same answer. So the bound is on **undiagnosed** rounds:

| Gate result | Blind retries | What to do instead |
|---|---|---|
| rc=2 — `BLOCKED` / `NEEDS_CONTEXT` | **0, ever** | The lane says it lacks something you did not give it, so an identical dispatch earns the identical answer. Read its file, then either **answer the block and dispatch again carrying the answer** — a new dispatch, still counted — or escalate the blocker text verbatim. `collect_lane`'s *"escalate, don't retry blindly"* is this row. *(Undriven: derived from the contract, not executed.)* |
| rc=1 — no file / no terminal verdict | **1**, with a named cause | Diagnose with `read-screen --scrollback` **before** deciding: a bounded no-scrollback read once reported a *working* lane as dead (`read-and-notify.md` §4). If you cannot name what you are changing, do not spend the round. |
| payload gate — `COUNT x0` / non-numeric / `COUNT x2` | **1**, cause is quotable | The file is in hand, so the correction is exact — quote the lane its own output and restate the field contract. *(Undriven: reasoned from the three measured shapes.)* |
| platform signature — classifier block, 529, visible API-retry loop | **0 — wait or escalate** | The cause is not in your prompt, and every round re-bills the whole context. This is the **$8.43** lane: ~19 blocked retries inside one session, ~8× its peers for identical work. **An outage is a stop condition, not a retry condition.** |

**Two ceilings — and a round cap is not a cost cap.** Rounds alone do not bound spend, because one
round is not a bounded cost (the outage row above is a single round). Check both before granting
another round.

**(1) Round cap — executable.** `MAX_ROUNDS=2` (initial + one corrected re-dispatch) is a **default,
not a measured optimum**: one corrected round is what has actually been driven, and it sufficed.

```bash
# Per-lane round counter — a file, like all fleet state ($TEAM absolute, read-and-notify.md §1).
MAX_ROUNDS=2
case "$MAX_ROUNDS" in ''|*[!0-9]*) echo 'MAX_ROUNDS must be an integer' >&2; exit 1 ;; esac

rounds_of() {                    # → integer, or 'bad' when the file exists but is unusable
  local f r; f="$TEAM/.rounds/$1"                 # `local`: the census uses $f too — do not leak
  [ -e "$f" ] || { echo 0; return; }              # no file = never dispatched
  r=$(cat "$f" 2>/dev/null)
  case "$r" in ''|*[!0-9]*) echo bad ;; *) echo "$r" ;; esac
}
bump_round() {                   # call once per dispatch of that lane
  local n; mkdir -p "$TEAM/.rounds"; n=$(rounds_of "$1")
  case "$n" in ''|*[!0-9]*) n=$MAX_ROUNDS ;; esac  # unusable → pin at the bound, never wrap to 1
  echo $(( n + 1 )) > "$TEAM/.rounds/$1"
}
may_retry() {                    # $1=slug $2=shape → 0 retry-eligible, 1 give up. FAILS CLOSED.
  local n
  case "$2" in                                     # SHAPE first — the table's rows, in code
    blocked|platform)   return 1 ;;                # the two "0, ever" rows: never a blind retry
    no-verdict|payload) ;;                         # eligible — still subject to the round cap
    *)                  return 1 ;;                # unknown shape → STOP, never guess
  esac
  n=$(rounds_of "$1")
  case "$n" in ''|*[!0-9]*) return 1 ;; esac       # unreadable counter → STOP, never retry blind
  [ "$n" -lt "$MAX_ROUNDS" ]
}
drop_or_retry() {                # $1=slug $2=shape → 0 retry it, 1 dropped for good (reason appended)
  may_retry "$1" "$2" && return 0
  dropped="$dropped $1(gave-up:$2 x$(rounds_of "$1"))"
  return 1
}
```

**Wire it into the census, or the bound is only prose.** § Fan-in's `case $rc` branches must tag a
**shape** and route through `drop_or_retry` — otherwise `may_retry` is never consulted and the
give-up reason below is never emitted. The shape names are exactly the table's rows:

```bash
  case $rc in
    0) ;;                                                  # finished → check the payload
    2) drop_or_retry "$s" blocked    && retry="$retry $s"   # rc=2: always gives up (0, ever)
       continue ;;
    *) drop_or_retry "$s" no-verdict && retry="$retry $s"   # eligible → queue for ONE retry
       continue ;;
  esac                                                     # payload-gate drops → shape `payload`
```

> **Both branches `continue` unconditionally — do not write `drop_or_retry … || continue`.** `||`
> short-circuits when the lane *is* retry-eligible (rc=0), so control falls through into the payload
> gate with a file that has no verdict — a fail-through in the middle of the fix for a fail-open.
> Caught by executing the wired census, not by reading it: with `||`, the retryable lane reached the
> payload gate; with the form above, only the finished lane does (asserted in both shells).

> **The `case` guard in `may_retry` is the whole safety property.** The first draft compared the
> counter directly, and `[ garbage -ge 2 ]`, `[ "" -ge 2 ]` and `[ 2x -ge 2 ]` all evaluate as
> **retry-eligible in bash *and* zsh** — so a corrupt or truncated counter retried forever. That is
> worse than having no bound, because it reads as protection. A give-up bound must fail **CLOSED**:
> anything you cannot parse means STOP. Found by executing the block, not by reading it (18 checks
> in both shells, including all five corrupt shapes).

**(2) Spend ceiling — an operator check, not a script.** A lane's cost is read from its own session
footer, so this is deliberately **not** wrapped in a helper: there is no scriptable source for it.
Before granting another round, compare the lane's spend to the median of the healthy lanes —
**≳3× is environmental, not promptable**; stop and escalate. The multiplier is a chosen heuristic;
the ~8× spread it derives from (outage row above) is measured.

When both ceilings are spent, **do not retry and do not publish a total.** Re-run the census, let it
exit 1, and hand the human the *named work* — never an index (§ Identity):

```
INCOMPLETE FAN-IN: 2/3 slices; dropped: auditor-ftk-rest(gave-up:no-verdict x2) — no total published
```

> **Round 2 recomputes from files over EVERY slice — never add a delta to round 1's total.**
> Verified live: the round-2 census re-read all three result files and published 260 with per-lane
> 98/73/89 exact, so the recompute is double-count-safe by construction. Accumulating a delta would
> count a re-collected lane twice — a *silent* wrong total, the exact class § Fan-in exists to prevent.

## Running /etk:develop over cmux

The pipeline is the process; cmux is the transport:

- Run `/etk:develop <feature>` as the **lead** pane's session.
- Phase-4 `--parallel` workers → sibling panes, one git worktree each
  (`/etk:start-parallel`), completion wired via `cmux hooks setup`.
- Collect event-first (read-and-notify.md § 7. Composed dispatchers); the join point is the last
  `STATUS:` line of each worker's **result file**, not anything on its screen.
- Phase-5 verification stays **inside the pipeline** — do not substitute the race gate
  or fleet telemetry for `/etk:develop`'s own quality gates.

## Native bridge: claude-teams (experimental)

```bash
cmux claude-teams [claude-args...]      # codex-teams for Codex
```

Launches Claude Code with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, teammate mode
defaulted to auto, and a tmux shim on PATH so **CC's native agent-teams mode materializes
teammates as cmux splits** — the harness spawns the panes instead of you scripting them.
Experimental flag (0.64.19): verify behavior on your build before relying on it, and note
it spawns sessions outside this repo's dispatch-site conventions (no SCOPE restate is
injected for you — the ladder and status protocol still apply to what you run inside).
