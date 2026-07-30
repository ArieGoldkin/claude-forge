# Read & Notify — Event-Driven Agent Waiting

How an orchestrator knows a cmux-pane agent is done, without busy-polling. Adapted from
disler/learning-cmux-with-agents (patterns doctrine) and re-verified against installed
cmux **0.64.20** (originally 0.64.19, 2026-07-20 — including a live probe of the actual
event cascade; the 0.64.20 bump is additive, nothing here changed). §1's collection contract
was **rewritten 2026-07-29** after a live end-to-end fleet run measured the previous
screen-scraped recipes returning false verdicts
(`docs/reviews/2026-07-29_conduct-cmux-pane-lane-e2e-test.md` §4).

## The rule of thumb

> Three channels, three jobs. Discrete **events** (finished, errored, notified) are
> **pushed** — they tell you *a turn ended*. A lane's **result file** holds the *verdict* —
> written only by the lane, so it is the one channel that can honestly say "not done."
> The **screen** is a *mirror*: it shows liveness and questions, and it also shows your own
> dispatch echoed back, which is why it can never be the verdict.
>
> Events say *something happened*. Files say *what the answer is*. Screens say *is anyone
> home*. Never let a screen answer a question a file should.

## 1. Collect from a FILE, never from the screen

> **The screen is not a channel — it is a mirror.** `read-screen` returns everything the
> surface shows, and that includes **the dispatch you just typed into it**. Any token you
> ask the lane to emit is therefore *already on screen* before the lane has done anything.
> A result you grep off the screen can be your own instruction echoed back.

**This is not hypothetical — both of the recipes this section used to recommend were
measured lying on 2026-07-29** (`docs/reviews/2026-07-29_conduct-cmux-pane-lane-e2e-test.md` §4):

| Old recipe | Contamination | Direction |
|---|---|---|
| `grep 'STATUS: DONE'` off the screen | matches the echoed instruction *"end with STATUS: DONE"* | **fails OPEN** — a lane reports DONE the instant it is dispatched, and kept reporting DONE while it sat in an API-error retry loop having produced nothing |
| `pytest && echo VERDICT=GREEN \|\| echo VERDICT=RED` | the echoed **command** contains *both* tokens, so `tail -1` reads the last one in the command string | **fails CLOSED** as a false `RED` — and only by accident of `\|\|` operand order; swap the operands and it fails open too |

### The contract: one result file per lane

The lane writes its conclusion to a file; the orchestrator reads the file. A file receives
**only what the lane wrote into it** — the dispatch echo lands on the screen, never in the
file — so it cannot be contaminated, it survives TUI scroll, and it is still readable after
the process exits.

```bash
# ABSOLUTE, and inside the repo — NOT a system temp dir. See the two boxes below.
TEAM="$(git rev-parse --show-toplevel)/.develop/team/<run-slug>"; mkdir -p "$TEAM"
RESULT="$TEAM/<title>-<assignment>.md"                   # one file per lane, teammate-named
                                                         # (agent-fleets.md § Identity: auditor-etk.md)

cmux send --surface "$S" --workspace "$WS" \
  "cd <worktree> && claude \"<one-line task>. Write your findings to $RESULT, and make its LAST line exactly: STATUS: DONE\""
cmux send-key --surface "$S" --workspace "$WS" enter
```

Collect by reading the file, and **anchor on the sentinel's position, not its presence** —
last line, not "appears somewhere". Position cannot be satisfied by text quoted earlier in
the file:

```bash
# Last MEANINGFUL line: skip blank lines, skip a closing code fence, strip CR and any
# surrounding markdown emphasis. A bare tail -n1 is too brittle — see the table below.
verdict_of() {
  awk '{ gsub(/\r$/,"");
         if ($0 ~ /^[[:space:]]*$/) next;                             # blank
         if ($0 ~ /^[[:space:]]*([`~]{3,}|[*_]+)[[:space:]]*$/) next; # fence / rule
         l=$0 } END{ print l }' "$1" \
    | sed -E 's/^[*_`[:space:]]+//; s/[*_`[:space:]]+$//'
}

collect_lane() {                    # $1=result file  → 0 done, 1 not done, 2 escalate
  [ -s "$1" ] || { echo "no result file — lane never wrote anything"; return 1; }
  case "$(verdict_of "$1")" in
    "STATUS: DONE"|"STATUS: DONE_WITH_CONCERNS") return 0 ;;
    "STATUS: BLOCKED"|"STATUS: NEEDS_CONTEXT")   return 2 ;;   # escalate, don't retry blindly
    *) echo "no terminal verdict — still running, or died mid-write"; return 1 ;;
  esac
}
```

`-s` is load-bearing: it separates *"never started"* from *"started, no verdict yet"* —
two states the old screen grep reported identically as DONE.

**Why not a bare `tail -n1`.** An agent asked to end a markdown file with a sentinel very
often adds a trailing blank line, bolds it, or wraps it in a fence. Measured against 13 file
shapes — the first draft of this recipe used `tail -n1` and got **5 false negatives**:

| Result file ends with | `tail -n1` | `verdict_of` |
|---|---|---|
| `STATUS: DONE` (clean, or no final newline) | DONE | DONE |
| `STATUS: DONE` + trailing blank line | *not done* ✗ | DONE |
| `STATUS: DONE   ` (trailing spaces) / CRLF | *not done* ✗ | DONE |
| `**STATUS: DONE**` / wrapped in a code fence | *not done* ✗ | DONE |
| `STATUS: BLOCKED` | escalate | escalate |
| `see: STATUS: DONE when finished` (prose) | not done ✓ | not done ✓ |
| `Write findings … LAST line exactly: STATUS: DONE` (the instruction) | not done ✓ | not done ✓ |
| `STATUS: DONE` present but **not** last | not done ✓ | not done ✓ |
| blank file / no file | not done ✓ | not done ✓ |

Every `tail -n1` miss failed **closed** — safe, but it makes the orchestrator re-dispatch
lanes that already succeeded, at roughly $0.57 a lane. Crucially, **exact match on the
normalized line is what keeps the safety property**: the echoed instruction, the sentinel in
a sentence, and a sentinel that is not last are all still rejected. Do not loosen this to a
substring or `grep -q` match — that reintroduces the false green this whole section exists
to remove.

> **`$TEAM` MUST be an absolute path.** Lanes are dispatched with `cd <worktree>` for write
> isolation, so a *relative* path like `team/auditor-etk.md` resolves inside **each lane's own
> worktree** — every lane writes a file the orchestrator never finds, and every collect reads
> a missing file. Resolve it once from the main checkout and pass the absolute path in the
> dispatch.

> **Do NOT put `$TEAM` in a system temp dir** — `mktemp -d`, `$TMPDIR`, `/tmp`, `/var/folders`
> all fail. ctk's `security-blocker` denies writes matching `^/var/` and
> `^/private/tmp/(?!claude-\d+/)`, so the lane's very first `Write` is blocked and it can
> never produce a result. **Live-verified 2026-07-29**: a lane dispatched with
> `TEAM=$(mktemp -d "${TMPDIR:-/tmp}/cmux-fleet-XXXXXX")` on macOS got
> `BLOCKED: System directory modification blocked … Pattern matched: ^\/var\/`, and a
> `/tmp/...` retry hit the `/private/tmp` rule. Use a path **inside the repo, under a
> directory the repo already ignores** (this monorepo: `.develop/`) so fleet runs leave no
> untracked files.
>
> Worth noting *why this was safe to get wrong*: a lane that cannot write its file now
> collects as **NOT DONE**. The failure is closed. The old screen-scraped recipe would have
> reported `DONE` for the very same blocked lane — which is the whole argument for this
> contract in one accident.

For a **shell command** rather than an agent, write the branch that actually ran into the
file. Only one token can reach the file, so the both-tokens defect cannot occur:

```bash
cmux send     --surface "$S" --workspace "$WS" "if pytest -q > $TEAM/api.log 2>&1; then echo VERDICT=GREEN > $TEAM/api.verdict; else echo VERDICT=RED > $TEAM/api.verdict; fi"
cmux send-key --surface "$S" --workspace "$WS" enter
# collect:  cat "$TEAM/api.verdict"     ← one token, written by the branch that executed
```

This is the mechanism **`references/agent-fleets.md` § Dispatch contract already named**
("shared memory as files … beats screen-scraping"). It is the collection contract, not an
optional upgrade.

### What the screen is still good for: liveness and attention

Reading the screen remains correct for *"is this lane alive / is it stuck waiting on me"* —
questions about **state**, never about **results**:

```bash
cmux read-screen --surface "$S" --lines 15 | grep -qiE '\(y/n\)|approve\?|continue\?|\[Y/n\]|press enter|❯[[:space:]]*$'
```

The idle-prompt glyph in Claude Code's TUI is `❯`, **not** `>` — a `>`-based readiness
regex false-negatives every time (live-verified, 12 misses in one demo). Both this glyph
check and any screen sentinel are **liveness hints only**: never promote either to a
completion verdict. The verdict comes from the result file.

## 2. The event stream (`cmux events`)

`cmux events` is a reconnectable NDJSON feed — subscribe once and cmux **pushes a line
per event**. First line is an `ack` envelope (protocol, `subscription_id`, resume-cursor
seq info); events follow.

```bash
cmux events --name notification.created --name agent.hook \
            --reconnect --cursor-file /tmp/team.cursor --no-heartbeat |
while IFS= read -r evt; do
  ws=$(jq -r '.workspace_id // empty' <<<"$evt")
  # decide by reading, not by trusting the event (see §5)
done
```

Flags that matter: `--name <event>` / `--category <category>` filter server-side;
`--reconnect` + `--cursor-file <path>` give a durable cursor (no missed or
double-processed events across restarts); `--no-heartbeat` silences keepalives;
`--limit N` exits after N events (useful for "first one wins").

**The notify cascade (verified live on 0.64.19):** one `cmux notify` emits BOTH
`notification.requested` (the request — carries `method: notification.create_for_caller`
and the caller's `preferred_surface_id`) and `notification.created` (the durable store
event — carries `notification_id`, `is_read`, content *lengths*). Subscribe to
`notification.created` (+ `agent.hook` for hook-wired agents); `notification.requested`
is useful when you need the *emitting surface*.

**Payload privacy:** `title`/`subtitle`/`body` are **redacted** in event payloads
(`redacted_fields`) — the event is the *doorbell*. Get the text from
`cmux list-notifications` or by reading the surface.

**Match on `workspace_id`.** In hook-emitted events `surface_id` is often null; anchor
routing to the workspace. Do not use `jump-to-unread` to find the emitter — it steals
the user's focus (Critical Rule 2); resolve refs from the event fields instead.

## 3. Completion hooks (who emits `agent.hook`)

`cmux events` only sees agent completions if the agent's lifecycle hooks call cmux:

```bash
cmux hooks setup            # wires Stop-hook → `cmux notify` for detected agents
cmux hooks setup codex      # specific agent
```

Claude Code, Codex, OpenCode, Copilot and others are supported. For a non-hooked tool,
append a manual notify to its command:

```bash
long_task && cmux notify --title "worker-7" --body "done"
```

## 4. The one honest poll (content, bounded)

When there is no hook and no sentinel event — e.g. watching a TUI settle — poll the
*content*, cheaply and bounded:

```bash
wait_for_marker() {  # $1=surface $2=regex $3=max_tries
  for _ in $(seq 1 "${3:-20}"); do
    cmux read-screen --surface "$1" --lines 12 | grep -qE "$2" && return 0
    sleep 3
  done; return 1
}
```

Keep `--lines` small so each poll is cheap — but **a small window is for polling, never for
diagnosis.** When you are working out *why* a lane looks wrong, always pass `--scrollback`:
a bounded no-scrollback read can return a blank or mid-repaint viewport, which reads exactly
like "the lane never received its dispatch." Live occurrence 2026-07-29: a 25-line
no-scrollback read of a working lane showed an empty screen and was reported as a failed
dispatch; `--scrollback` showed the prompt present and the lane mid-retry. **A bounded read
that finds nothing is not evidence that nothing is there.**

## 5. Verify after the event — refusals notify too

**Verified failure mode:** a notification fires on turn-completion **even when the agent
refused the work** or stopped to ask a question. An event means "the turn ended," not
"the task succeeded." After every event:

1. **Read the lane's result file** (§1 `collect_lane`) — this is the verdict.
2. `read-screen` the surface once, for *context only*: which question it is asking, what it
   refused, where it died.
3. Branch: done → next task · question → answer it · refused/failed → re-dispatch or escalate —
   **bounded**: how many rounds each failure shape earns, and when to stop, is
   `agent-fleets.md` § Give-up bound. A retry with no named cause is just a re-bill.

> **Why the file and not the sentinel:** this section's whole premise is that an event means
> *the turn ended*, not *the work succeeded* — so the check has to be able to fail. A screen
> sentinel **cannot** fail: the dispatch that asked for it is echoed on the same screen (§1),
> so a refusing agent and a succeeding agent produce an identical "sentinel present" result.
> Checking the sentinel on screen defeated the exact safeguard this section exists to provide
> (measured 2026-07-29). An absent or verdict-less **file** is a real negative signal.

## 6. `wait-for` — rendezvous, not completion detection

`cmux wait-for <name> [--timeout N]` is a **named-token semaphore you signal yourself**
(`cmux wait-for -S <name>`), not an agent-completion watcher. Use one token per task
(`build-api`, `seed-db`) to fan several workers back in:

```bash
cmux wait-for migration --timeout 600            # orchestrator blocks here until signaled
# … worker, when done:
cmux wait-for -S migration                        # releases the waiter
```

For multi-token fan-in, background one waiter per token (`cmux wait-for build-api --timeout 600 &`, …) and `wait` on them all.

## 7. Composed dispatchers

**Queue dispatcher** (M tasks / N agents): subscribe once; on each completion event
`collect_lane` that lane's **result file** (§1), then `send` the next task; drain the queue.
Zero sleep loops. Give each task its own result file (`$TEAM/<title>-<task-slug>.md` — in a
queue, the *assignment* is the task) — a reused path
makes the previous task's verdict satisfy the next one's check.

**Race** (same task to N diverse agents, first *verified* answer wins): the full recipe —
including the mandatory verification gate on the winner — lives in
**`references/agent-fleets.md`**; its wait mechanics are exactly this file's
(loop the event stream — **not** `--limit 1`, since the first event may be a racer that
refused and you must be able to wait for the next — match by `workspace_id`, and decide on
the racer's result file).

Fused: *pushed by events, decisions made by reading, polling only the content you
actually have to inspect.*
