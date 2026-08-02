# ADR-0002: `security-blocker` is a best-effort advisory layer, not an enforceable boundary

- **Status**: Accepted
- **Date**: 2026-08-02
- **Deciders**: Arie Goldkin
- **Tracking**: consolidates issues [#116](https://github.com/ArieGoldkin/claude-forge/issues/116) · [#117](https://github.com/ArieGoldkin/claude-forge/issues/117) · [#118](https://github.com/ArieGoldkin/claude-forge/issues/118) · [#121](https://github.com/ArieGoldkin/claude-forge/issues/121)

> **This ADR exists to set a stopping rule, not to lower the bar.** Nothing here removes a
> protection or reverts a fix. It states what the layer can and cannot do, so that the next
> spelling we find is triaged instead of automatically becoming a bug.

## Context

`security-blocker` protects sensitive resources by matching the **text** of a Bash command
against a list of literal patterns. Over eight days it accumulated **8 issues** — half the
repo's total bug traffic in that window:

| Issue | Class | State |
|---|---|---|
| #65 | matches command TEXT, so harmless commands are denied and a deny is terminal | closed |
| #98 | the hook's `if` conditions never gated at all | closed |
| #99 | the system-dir pattern was too broad for macOS per-user temp paths | closed |
| #114 | patterns required a trailing separator, so `cd`-then-read split them | closed |
| #116 | glob / case / quote-split spellings bypass every literal rule | open |
| #117 | a protected name is matched only as the LEADING path component | open |
| #118 | qualified rules have no left boundary, so ordinary relative paths are denied | open |
| #121 | recursive readers rooted at an unprotected ancestor reach the same material | open |

Every one of the four open issues is real and measured. **None of them is an independent
defect.** They are four instances of one limit, which the source file states in its own
comments three separate times:

> *"deciding 'is this path the target of a write?' requires a shell parse, and no regex over
> unparsed text can answer it."*

The evidence that this does not converge is the filing history itself: **#116 came from
reviewing PR #115. #118 came from fixing #116. #121 came from reviewing the fix for #116.**
Each fix's review produces the next issue. The loop terminates when we decide it does, not
when the spellings run out — the shell has unbounded ways to name a file, and the matcher
sees only text.

Meanwhile six issues from July (#46, #47, #58, #67, #82, #110) did not move for a week
because every session went here. #82 — *all five plugins silently failed to load for a whole
session* — is a worse defect than any spelling fixed in that time.

## Decision

**`security-blocker` is a best-effort, defense-in-depth advisory layer. The enforceable
boundary is Claude Code's native permission system.**

Three consequences, binding:

1. **A newly-discovered spelling is not automatically a bug.** It is triaged against the
   threat model below. If it is only reachable by an actor who already controls the command
   text, it is documented as a known gap — not filed, not fixed.
2. **We do not run adversarial spelling hunts against this file.** Reviews of changes *to*
   it stay adversarial; open-ended probing *of* it stops. That single change is what stops
   the issue count growing.
3. **Anything that must be guaranteed goes in the Bash sandbox**, which enforces on
   resolved paths at the OS level. Claude Code's own documentation already says the hook
   layer is the wrong place for a hard boundary, and it is quoted in the repo's root
   `CLAUDE.md`:

   > *"the `if` filter is best-effort, use the permission system rather than a hook to
   > enforce a hard allow or deny."*

## The threat model that sets the stopping rule

This is the part that was never written down, which is why every spelling looked like a bug.

| Actor | Can this layer stop them? | Why |
|---|---|---|
| **A careless agent** reaching for a config file without thinking | **Yes — and this is the real value** | The literal spelling is what an agent actually writes. `cat /etc/passwd` is denied. |
| **A confused agent** following a misleading instruction | **Mostly** | Same reason; the obvious spelling is the literal one. |
| **An adversary who controls the command text** (prompt injection) | **No, and no version of it ever will** | If injection can make the agent write `cat ~/.s*h/*`, it can equally make it write anything else. Text matching cannot recover a situation where the attacker chooses the text. |

Complete coverage is therefore **both unachievable and unnecessary**. The layer's job is to
make the *common* path safe and to force a prompt; it is not, and cannot be, a containment
boundary.

⚠ **This does not make the closed fixes wasted.** #99, #114 and #116's case and glob halves
each closed spellings a *careless* agent plausibly writes — `ls /ETC` on a case-insensitive
volume, `cd ~/.ssh && cat id_rsa`, `cat ~/.s*h/*`. Those were worth doing. What changes is
that we stop treating the asymptote as a backlog.

## Consequences

**Positive**
- The issue count stops growing from self-generated probes.
- The July backlog resumes; #82 is next.
- Users who need a hard boundary get pointed at the mechanism that actually provides one.

**Negative — stated plainly, not mitigated away**
- Known bypasses stay open, and the ones we know of are listed in the tests as pinned gaps
  (quote-splitting, `cd /` with no literal, recursive readers). Anyone reading only the
  CHANGELOG would otherwise infer more coverage than exists.
- A future contributor may re-discover a spelling and, without this ADR, file it again. The
  four consolidated issues link here for exactly that reason.
- The sandbox is user configuration; the plugin cannot ship it enabled, and it is **off by
  default**. We can recommend and document it, not enforce it. **A user who does not enable
  it has only the advisory layer** — that is the honest position, and it is why this ADR is
  not "we made it safe elsewhere."
- ⚠ **The advisory layer is doing more than it looks like, and that raises the stakes of
  this decision rather than lowering them.** Claude Code's built-in read-only set
  auto-approves `cat`, `ls`, `grep`, `find` and friends *in every mode*, so on a default
  install with no sandbox, `security-blocker` is the only thing between an agent and
  `cat ~/.ssh/id_rsa`. Accepting it as best-effort is therefore a real reduction in assurance
  for unsandboxed users, not a paper change. It is still the right call — the layer cannot be
  completed — but it must be paired with actually shipping the sandbox recommendation, not
  just filing this document.

## Alternatives considered

- **Keep fixing spellings.** Real security value, no end state, and demonstrably starves the
  rest of the backlog. Rejected on the eight-day evidence above.
- **Parse the shell properly.** Two attempts are already documented in
  `BASH_SYSTEM_DIR_PATTERNS`; adversarial review demolished both, and the failure mode was
  arbitrary writes to `/usr/local/bin` — worse than the hole being closed. A real parser is a
  dependency and an ongoing correctness surface for a layer we have just decided is advisory.
  Rejected as disproportionate.
- **Remove the layer entirely** and rely only on native settings. Rejected: it genuinely stops
  the careless-read case, which is the common one, and native settings are opt-in.

## Recommended native configuration

⚠ **The first draft of this ADR recommended `permissions.deny` with `Read(…)` rules. That
was wrong twice over, and the corrections are the most useful part of this document.**
Both errors were caught by reading the official docs instead of trusting recall — the same
discipline this repo applies to code.

**Error 1 — the path syntax.** A single leading slash is *not* absolute:

> *"A pattern like `/Users/alice/file` isn't an absolute path. The single leading slash
> anchors at the settings source, not the filesystem root. Use `//Users/alice/file` for
> absolute paths."*

So `Read(/etc/**)` in user settings means `~/.claude/etc/**` — it would have silently
protected nothing.

**Error 2 — the tool scope, which is the load-bearing one.** Permission rules are
**per-tool**. A `Read(…)` rule governs the **Read tool**; `cat ~/.ssh/id_rsa` is a **Bash**
call and is not matched by it. Worse, Claude Code auto-approves that command class by
default:

> *"Claude Code recognizes a built-in set of Bash commands as read-only and runs them
> without a permission prompt in every mode. These include `ls`, `cat`, `echo`, `pwd`,
> `head`, `tail`, `grep`, `find`, `wc`… The set is not configurable."*
>
> *"Unquoted glob patterns are permitted for commands whose every flag is read-only, so
> `ls *.ts` and `wc -l src/*.py` run without a prompt."*

That is worth absorbing: **on a default install, `cat <anything>` is auto-approved by Claude
Code itself**, before ctk is involved. It also means `Bash(…)` deny rules are not the
answer either — they are text matching, with the same unbounded surface this ADR is about,
and the docs say so directly: *"Bash permission patterns that try to constrain command
arguments are fragile."*

**The actual boundary is the Bash sandbox**, because it enforces on the running process
rather than on the command string:

> *"The operating system enforces the sandbox boundary on the running process, so it holds
> regardless of what the model chose to run and even if an allowed command does more than
> its name suggests."*

That single sentence is the property `security-blocker` cannot have at any level of regex
effort, and it is why this ADR exists. Note the sandbox's default is permissive and must be
configured:

> *"**Default read behavior**: read access to the entire computer, except certain denied
> directories. Note that this default still allows reading credential files such as
> `~/.aws/credentials` and `~/.ssh/`."*
>
> *"There is no built-in credential deny list, so only the files and variables you list are
> restricted."*

The floor we recommend, for `~/.claude/settings.json` or managed settings:

```json
{
  "sandbox": {
    "enabled": true,
    "credentials": {
      "files": [
        { "path": "~/.ssh", "mode": "deny" },
        { "path": "~/.aws/credentials", "mode": "deny" },
        { "path": "~/.config/gcloud", "mode": "deny" }
      ]
    }
  }
}
```

Every spelling this ADR gives up on — glob, brace, quote split, `cd`-then-read, recursive
walk — resolves to the same denied path and is blocked by the OS. Note the ordering
subtlety if you also use `filesystem.denyRead`/`allowRead`: *"An exact deny holds inside a
wider allow, so a broad allow can't silently re-expose a secret."*

Two caveats that must travel with this recommendation:

- **`sandbox.filesystem.disabled: true` turns the read protections off**, including
  `credentials.files`. Setting `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` makes Claude Code ignore
  that key from every source, including managed settings.
- **The sandbox does not run on native Windows** (macOS, Linux, WSL2 only). On a Windows
  host without WSL2 there is no OS-enforced boundary, and the advisory layer is all there
  is.

## Revisit if

- Claude Code exposes a hook input carrying the **resolved** operand paths of a Bash command
  rather than raw text. That would remove the premise of this ADR entirely.
- A spelling is found that a *careless* agent would plausibly write. That is a bug under the
  threat model above and should be fixed, not triaged away.
