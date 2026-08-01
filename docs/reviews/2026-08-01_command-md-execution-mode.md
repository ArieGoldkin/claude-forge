# Are bash blocks in command `.md` files executed, or interpreted?

**Date**: 2026-08-01 · **Question owner**: #110 (and it retro-scopes #109)
**Answer**: **Interpreted.** CC never executes them. They are prompt text the model reads and re-authors.

---

## Why this needed an unusual instrument

The question is about what *the model* does with a block — and the investigating agent **is** the model.
A probe designed and then run by the thing under observation cannot distinguish "CC executed this
verbatim" from "I read it and chose to run it." So new self-run probes were ruled out in favour of
**past, unwitnessed invocations**: 33 session transcripts under
`~/.claude/projects/-Users-ariegoldkin-Arie-projects-claude-plugins-main/`, 188 MB, written by
sessions that had no idea they would be studied.

## Instrument A — behaviour across 26 unwitnessed sessions

`/ctk:doctor` was **never invoked** in any of the 33 sessions, so the #109 loops have no direct
record. `/ctk:resume-session` was invoked **27 times**, and its `.md` carries a literal executable
line (`resume-session.md:38`):

```bash
LEDGER=$(ls .claude/continuity/ledgers/CONTINUITY_*.md | head -1)
```

**Pre-registered predictions** (recorded before looking, to prevent post-hoc rationalisation):

| If… | Then transcripts show… |
|---|---|
| executed verbatim | a Bash call byte-identical to the block |
| interpreted | Bash calls that diverge; the model substitutes |
| never run | no Bash call at all; output narrated |

**Result**: 27 of 29 invocations began with a `Bash` call — so the model does reach for the shell.
But **not one executed the block**. Every session composed its own command:

```
[088fb19f] ls -t <abs>/handoffs/*.yaml | head -5; echo "---LEDGERS---"; ...
[5d3963c3] ls -1t <abs>/handoffs/*.yaml | head -5; echo "---LEDGERS---"; ...
[62bdcf53] ls -t .claude/continuity/handoffs/*.yaml | head -5; ...        # relative, not absolute
[6b2df705] echo "=== HANDOFFS ===" && ls -t ...                            # different delimiters
[90b35f5b] ls -1t .claude/continuity/handoffs/*.yaml | head -5; ...
```

Three signals, each independently sufficient:

1. **Divergent authorship.** `ls -t` vs `ls -1t`, absolute vs relative paths, `---LEDGERS---` vs
   `=== LEDGERS ===`. Sessions copying a block would agree; sessions implementing a spec vary.
2. **Code that exists nowhere in the source.** The `.md` expresses sort order as *prose* —
   `Sort: By date (newest first)` — and every session rendered it as `-t`. The model wrote code for
   an instruction that was never code. That is interpretation by definition.
3. **The literal line, when it appears, is embedded and edited.** Only 3 sessions' commands
   contained the `.md`'s literal `LEDGER=$(...)`; all three wrapped it inside a larger self-authored
   command, and `c051b792` **added a `-t` flag the source does not have**.

## Instrument B — the delivery mechanism

The decisive record, from session `088fb19f` (not the investigating session): after the
`<command-name>/ctk:resume-session</command-name>` marker, the **entire command body — including the
literal `LEDGER=$(ls ...)` line — appears as a `role=user` message.**

The body is *injected as prompt text*. CC does not run it. Everything that happens afterwards is the
model electing to act on what it read.

### What was NOT established

CC's documented syntax for genuinely executing shell inside a command is the inline form
`` !`command` `` (paired with `allowed-tools` frontmatter). A search for it across every installed
plugin returns **zero** genuine uses — so the positive control **could not fire**, and the "our
commands don't use it" observation proves nothing on its own. It is recorded here as unconfirmed and
carries no weight in the conclusion; instrument B rests on the transcript record above, not on it.

⚠ The first pass of that search reported a hit in Vercel's `deploy.md` and it was a **false positive
of my own regex**: line 115 is prose — `` `ERR!`, or `FATAL` `` — where `!` from `ERR!` is followed
by the next backtick. Caught before it reached a conclusion.

### A confound that survives

`resume-session.md`'s block is prose-heavy (`List:` / `Sort:` / `Select:`), while `doctor.md`'s
Steps 2/3/7 were unusually pure, runnable bash. No past invocation exists of a command carrying a
*pure runnable* block, so **"the model runs pure blocks verbatim more often than prose-mixed ones"
is not excluded** by instrument A. It is excluded by instrument B for the *mechanism* — CC executes
neither — but the model's own propensity on pure blocks is unmeasured.

## Consequences

### #110 — severity drops sharply

`archive-ledger.md:163` reads `echo "$LEAN_LEDGER" > "$LEDGER"` with `$LEAN_LEDGER` unassigned and
`$LEDGER` correctly pointing at the live project ledger. Under literal execution that truncates the
ledger. **Literal execution does not happen.** A model reaching Step 6 constructs the lean ledger
from Steps 1–5 and writes that. #110 is a **spec-ambiguity defect, not a data-loss bug.** It should
stay open — an ambiguous instruction still produces inconsistent behaviour — but not as a
destructive-risk item.

### #109 — the fix stands; the stated mechanism does not

Shipped in the PR #111 body, `ctk/CHANGELOG.md` 2.17.3, and the issue comment:

> "all three iterated an empty list … an empty loop emits nothing and exits 0"

That describes literal execution, **which never occurs**. What was actually wrong: the blocks were
an *ambiguous spec*. A model reading Step 2 had to invent both the plugin list and `$PLUGIN_ROOT`
before it could act — and instrument A shows literal text from a block **does** propagate into the
commands a model composes (3 of 26 sessions), so a wrong literal is not inert.

The fix is unaffected and arguably better motivated: an unambiguous, executable, verified spec
replaces one that forced every reader to guess. The four defects it exposed — the wrong
`hooks.json` path, the `"matcher"` count reading 0 for four plugins, `grep -c … || echo 0` yielding
`0\n0`, and Step 7 on the legacy tree — were all **real**, and all remain real regardless of
execution mode, because they are wrong *as instructions* too.

**What needs correcting is the severity language in three shipped artifacts**, not the code.

## Method notes worth keeping

- **When the investigator is the subject, prefer archives to experiments.** The transcript store is
  a record of behaviour by agents who were not being watched — the only uncontaminated evidence
  available for a question of this shape.
- **Pre-register predictions before opening the data.** All three outcomes were written down first;
  the observed result was the one that would have been easiest to rationalise away afterwards.
- **A control that finds nothing has not fired.** Two searches here returned zero and were nearly
  read as confirmation. One was a mis-specified regex; the other genuinely has no instances. Neither
  is evidence.
