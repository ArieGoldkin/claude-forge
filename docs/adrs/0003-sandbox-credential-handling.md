# ADR-0003: Sandbox credential handling — narrowest channel per consumer, per-run scope, deferred implementation

- **Status**: Accepted (decision only — implementation deliberately deferred)
- **Date**: 2026-08-05
- **Deciders**: Arie Goldkin
- **Tracking**: issue [#58](https://github.com/ArieGoldkin/claude-forge/issues/58) (credentialed clone) · U2 of the Gate 1 record `docs/reviews/2026-07-27_gate1-adw-pilot.md` (no env or secret channel) · builds on [ADR-0001](0001-sandbox-substrate.md)

> **This ADR records a decision, not a change.** No source file is modified by it. `provider.ts`,
> `vercel.ts` and `launcher.ts` keep their current credential-free shape, and the launcher continues
> to hold and forward no secret. The point is to fix the *channel* choice now, while nothing is under
> deadline pressure, so that whoever first needs a private clone implements the decided design
> instead of reaching for the one channel that happens to exist already — which is the worst one.
>
> **Provenance**: every SDK claim below was read out of the installed `@vercel/sandbox@2.9.0` type
> definitions and is cited by file and line. The serialization claims in *Why a thunk* were **measured
> by running Node**, not recalled — including the one that came back negative and is recorded as a
> caveat rather than dropped.

## Context

Two gaps arrived from different directions and look like one problem:

- **#58** — `GitSource` (`tools/sandbox-launcher/src/provider.ts:80-85`) is `{url, revision?, depth?}`.
  `toSdkSource()` (`src/providers/vercel.ts:46-53`) forwards exactly those three. Private repos
  cannot be cloned.
- **U2** — `ProvisionOptions` (`provider.ts:94-123`) exposes name, timeouts, source, runtime, vcpus,
  signal. There is **no env or secret channel at all**, so no API key can reach the agent inside the
  guest. The Gate 1 record calls this "the harder of the two."

**Neither is an SDK limitation.** The SDK accepts a credentialed git variant — a `git` source that
additionally carries a username and a password field (`sandbox.d.ts:39-45`) — and `Sandbox.create`
already takes `env?: Record<string,string>`, documented as "Default environment variables for the
sandbox… inherited by all commands unless overridden" (`sandbox.d.ts:85`). Both gaps are our own
interface plus a secret-handling decision we have not made.

**What the fix spends.** The launcher today contains zero credential-handling code; it never reads a
token. That was deliberate, and `provider.ts:76-78` says so in the source:

> *"Public repositories only, deliberately. The SDK also accepts a credentialed variant; T2 does not
> expose it, so the launcher never handles a git secret."*

That property is binary. Any credential path spends it, and no design below preserves it — the
choice is only about how much surface replaces it.

**Why "must not land in a snapshot" is a real constraint and not boilerplate.** Sandboxes are
persistent by default and snapshots outlive the session that created them (`provider.ts:14-33`,
citing `README.md:103`, `sandbox.d.ts:98,104`). A secret written into the guest filesystem is a
secret written into something that survives the run. `vercel.ts:72` already sets `persistent: false`
and `snapshotExpirationMs` is required, which bounds how long — not whether.

**Nothing here has ever run.** U1 of the Gate 1 record: the three Vercel environment variables the
SDK needs are absent in this environment. `VercelProvider` is compile-checked and has never executed
a line. Every runtime question this ADR raises is *unrunnable today*, which is a first-order reason
the decision ships without the implementation.

## The two problems are not the same problem

This is the load-bearing observation, and merging them is the mistake the decision exists to prevent.

| | **A — git clone credential (#58)** | **B — agent API key (U2)** |
|---|---|---|
| Who consumes it | **Vercel's infrastructure**, which performs the clone | **A process inside the guest** |
| When | `Sandbox.create`, once | Every agent command, for the run's duration |
| Must it exist inside the guest? | **No** — unless git itself writes it there | **Yes**, in some form reachable by the process |
| Natural lifetime | Seconds | The whole run |
| Least-privilege shape | read-only, one repo, minutes | LLM API access, currently long-lived |

Different consumers, different channels, different answers. Solving them together forces the union of
both risks: a single create-time secret bag that is inherited by every command *and* carries a git
token that never needed to be in the guest at all. That is the design this ADR rejects, and it is
also the most obvious one.

## Channel inventory

Measured against the installed SDK. This table is the evidence for the Decision.

| Channel | Where the secret comes to rest | In snapshot scope? | Notes |
|---|---|---|---|
| credentialed `source` (`sandbox.d.ts:39-45`) | Vercel API; **possibly** the guest's `.git/config` | **UNKNOWN — see U-a** | The only channel that reaches the clone at all |
| create-time `env` (`sandbox.d.ts:85`) | Sandbox object metadata, inherited by **all** commands | Not filesystem; sandbox-object lifetime is longer than the run | Widest blast radius of the in-guest options |
| `runCommand({env})` (`session.d.ts:37`, README §env) | One command's process environment | No | Narrowest in-guest option; visible in the guest's `/proc` while it runs |
| `seed()` → `sandbox.writeFiles` | **The guest filesystem** | **Yes, directly** | The only channel that exists in our interface today |
| `networkPolicy` request transform (`network-policy.d.ts:10,117-137`) | **Vercel's edge only — never in the guest** | **None** | The SDK's own example is exactly this: the guest sends a placeholder API-key header, and a rule matching that placeholder rewrites the outgoing request with the real authorization header |

The last row is the one that changes the shape of problem B. The SDK documents a first-class pattern
where the guest holds a placeholder and the real credential is injected outside the VM. If it works
for our agent, "how does it reach the sandbox without landing in a snapshot" stops being a hygiene
question and becomes structurally satisfied: the credential never enters the sandbox.

## Decision

Six points, binding. Each answers one of the three questions #58 and the Gate 1 record left open.

**1. The launcher never sources a credential — the caller supplies it.**
No `process.env` read, no `gh auth token` shell-out, no credential helper inside `provider.ts`,
`vercel.ts` or `launcher.ts`. Ambient authority would make every call site implicitly credentialed,
make the credentialed path untestable without polluting the test environment, and turn "does this
run hold a secret?" into a question about the machine rather than the call. *(Answers: where does it
come from.)*

**2. A credential enters as a thunk, not a string.**
The shape is a zero-argument async function returning the username/password pair the SDK variant
requires — both fields together, since the SDK's credentialed variant demands both. Not a plain
string or object. The justification is measured, and so is its limit; both are in *Why a thunk*
below.

**3. The git credential uses the SDK's credentialed source variant. Not `env`, not `seed()`.**
It goes to the party that performs the clone and to nobody else. For GitHub the documented form is a
fixed sentinel username with the token supplied in the password field; the exact pairing is
host-specific, and the thunk returns whatever pair the host expects. `toSdkSource()` becomes async as
a consequence — it is called from the already-async `provision()`, so this costs nothing
structurally.

**4. The agent API key prefers the network-policy transform; per-command `env` is the fallback;
`seed()` is ruled out.**
Preference order, and the ranking is the point:
   1. `networkPolicy` request transform — credential never enters the guest.
   2. `runCommand({env})` per command — narrowest in-guest scope.
   3. Create-time `env` — only if something genuinely needs it before the first command.
   4. `seed()` — **never**, for secrets. It writes to the exact surface a snapshot captures.

   Ruling out `seed()` is not a formality: it is the *only* channel our interface exposes today, so
   it is what anyone under pressure would reach for, and U2 already identifies it as the available
   one. If the transform probe (U-c) fails, we fall back to (2) — we do not fall back to (4).

**5. Tokens are per-run, short-lived, and least-privilege.**
Read-only, single-repo, minutes-to-an-hour. A GitHub App installation token (one-hour expiry,
repo-scoped) or a fine-grained PAT limited to read-only repository contents on one repository. Never
a classic PAT with org-wide scope. This is the one mitigation that survives U-a being answered badly:
if a credentialed clone *does* leave the token in `.git/config` and therefore in a snapshot, a token
that expired an hour into a snapshot's retention is a bounded loss rather than an unbounded one.
*(Answers: is it scoped per-run — yes, and that is load-bearing rather than decorative.)*

**6. None of this is implemented until something actually needs it.**
The trigger is a private clone (#58's own condition: "the moment Phase 2 targets anything outside a
public repository") or an in-guest agent key. Until then the source stays credential-free and this
document is the entire deliverable. Nothing can be verified live today (U1), and unverified
credential-handling code is the worst category of unverified code to ship.

## Why a thunk

Point 2 is the one that looks like style and is not. The claims below were produced by running Node
against both shapes, because the repo's rule is to measure rather than recall.

**What was measured, on an options object holding a credential:**

- `JSON.stringify` **drops** a function-valued field entirely; the plain-object field serializes in
  full, token and all.
- The drop **survives a spread** — `JSON.stringify({...opts})` also omits it.

  ⚠ **This defends a shape, not a live leak path — an earlier draft of this line said otherwise and
  was wrong.** It read that `launch()` "carries `...provisionOpts` (`launcher.ts:88`) through the
  same function that writes `.claude/continuity/sandboxes.json`", which a reader takes as: a
  credential in `provisionOpts` reaches the registry file. **It does not, and could not today.**
  `launch()` destructures `...provisionOpts` at `launcher.ts:88` and passes it to
  `provider.provision()` at `:109`; the two `addRecord` calls (`:91`, `:113`) are explicit
  six-field object literals pinned by `satisfies SandboxRecord`, and `SandboxRecord`
  (`shared/hooks-infra/src/lib/sandbox/types.ts:24-37`) is a **closed six-field interface** —
  `sandbox_id`, `provider`, `created_at`, `expires_at`, `session_id`, `status`. Only
  `provisionOpts.timeoutMs` is read, to compute `expires_at`. Nothing spreads options into the
  record. So the thunk's value here **would** be realised only if someone later replaced a literal
  with a spread — a real hazard given `LaunchOptions extends Omit<ProvisionOptions,'name'>`
  (`launcher.ts:41`) makes the two shapes assignment-compatible, but a hazard, not a defect.
- `util.inspect` — what `console.log(obj)` uses — prints the field as an anonymised
  `[AsyncFunction: …]` marker for the thunk, and the full value for the plain object.

So the two dominant accidental-leak paths, structured logging and console-dumping an options object,
are closed by the type rather than by discipline. That the repo has the JSON-dump habit is not
hypothetical: `reap.ts:139` writes `JSON.stringify(result)` to stdout. It happens to carry only
sandbox ids today; the shape is one careless field away from carrying more.

**What was also measured, and is a real limit — recorded rather than dropped:**
template interpolation of the thunk prints the **function's source text**. A thunk that closes over
an inline literal therefore leaks that literal. The thunk must *fetch* the credential when called —
read an env var, invoke a helper — never carry it in the closure body.

**Scope, stated plainly.** This is a defense against accidental serialization, and nothing more. It
is not encryption, not a secret manager, and no defense at all against code that deliberately calls
the thunk and logs the result. It buys exactly one property: a credential cannot ride into a log or
a registry file by being adjacent to something that got stringified.

## Unknowns that must be probed before implementation

All four are unrunnable today (U1). Each has a concrete probe, so none of them is a matter of
opinion once a live environment exists.

| # | Question | Probe | What it changes |
|---|---|---|---|
| **U-a** | Does a credentialed clone leave the credential in the guest's `.git/config`? | After a credentialed create, `exec` `git config --get remote.origin.url` and read `.git/config` in the guest | **Can invalidate point 3.** Git's ordinary behavior for an HTTPS URL carrying inline userinfo is to store that URL verbatim. If Vercel clones that way, the token is in the guest filesystem and thus in snapshot scope, and point 5's expiry becomes the only containment |
| **U-b** | Does create-time `env` survive the session — visible via API, dashboard, or a restored snapshot? | Set a marker value, end the session, re-read the sandbox object and restore a snapshot | Determines whether preference (3) in point 4 is usable at all |
| **U-c** | Can a Claude Code process in the guest run against a placeholder credential with the real one injected by a network-policy transform? | Allow the API host with a rule matching the placeholder header, transform it to the real one, then assert both a successful call and that the guest never holds the real value | **Decides point 4's preferred channel.** If it fails we land on per-command `env` — which is worse, and would amend this ADR rather than be adopted silently |
| **U-d** | Does the provider log the credentialed source's password field anywhere the account can read back? | Inspect provider-side build/clone logs after a credentialed create | Vercel-side exposure is outside our control; if positive, point 5's short expiry is again the only mitigation |

U-a is the one to run first. It is the only probe whose answer can force a different channel.

## Consequences

**Positive**

- The channel is decided while nothing is urgent. The failure mode this prevents is real and named:
  the only channel that exists today (`seed()`) is the worst one, and it is what a deadline would
  select.
- Problem B may end up with a credential that **never enters the sandbox**, which is a stronger
  property than any hygiene rule around one that does.
- The git token stops being an in-guest concern by construction — it goes to the party doing the
  clone and nowhere else.
- The launcher stays credential-free until the day something needs otherwise, so #58's original
  benefit is retained for as long as it can be.

**Negative — stated plainly, not mitigated away**

- **The no-secret property is spent the moment any of this lands, and it cannot be partially spent.**
  The comment at `provider.ts:76-78` will need rewriting, not amending — the claim "the launcher
  never handles a git secret" becomes false. Everything above minimizes surface; nothing preserves
  the property.
- **Point 4's preferred channel is unverified.** The SDK documents the pattern for its own AI
  gateway; whether Claude Code tolerates a placeholder credential is U-c. If it does not, the
  fallback is strictly worse than what this ADR advertises.
- **Point 5 is not satisfiable with the tooling on hand, today.** The realistic local source is
  `gh auth token`, which returns a broadly-scoped, long-lived user token — the exact thing point 5
  forbids. Minting short-lived repo-scoped tokens needs a GitHub App or equivalent that does not
  exist yet. This is stated now so it is designed for rather than discovered at implementation time,
  and it is an independent reason the implementation is deferred.
- **A thunk is ergonomically worse than a string, and someone will want to simplify it.** That is why
  the measurement is in this document: the reason is mechanical, and undoing it silently re-opens the
  serialization path.
- **Deferral has a cost.** Whoever first needs a private clone meets this cold. The ADR shortens that
  encounter; it does not remove it. #58 stays open and links here.
- **This ADR assumes the launcher stays maintainer-only** (`package.json`: `private: true`, "NOT part
  of any shipped plugin"). If it ever ships inside a plugin, the threat model changes from "one
  maintainer's token on one machine" to "arbitrary users' tokens", and this decision must be redone
  rather than extended.

## Alternatives considered

- **One create-time `env` bag carrying both credentials.** The obvious design, and the widest: the
  git token would sit in the guest for the whole run despite never being needed there, and every
  command would inherit both. Rejected — it is precisely the merge the "two problems" section rules
  out.
- **`seed()` the credential into a file.** Requires no interface change at all, which is its entire
  appeal. Rejected: it writes to the snapshot surface, and the sandbox's own docs make snapshots
  outlive the session. Rejected explicitly rather than by omission, because it is the default path of
  least resistance.
- **Vercel project environment variables.** Real, and genuinely keeps the value off our call sites.
  Rejected as the primary channel: project-scoped and long-lived, inherited by every sandbox in the
  project, and therefore incompatible with point 5's per-run scoping. Reasonable later as a *storage*
  location behind a thunk; not as the delivery mechanism.
- **Keep public-repos-only permanently.** Rejected on #58's own framing — any real adoption implies a
  private repo.
- **Implement now, decide later.** Rejected: with the Vercel credentials absent, credential-handling
  code could not be exercised even once. Shipping unverified code whose failure mode is a leaked
  token inverts the repo's own evidence discipline.
- **Have the launcher read a token from its own environment.** One line, no caller changes. Rejected
  — see point 1; it converts an explicit capability into ambient authority and makes the credentialed
  path impossible to test in isolation.

## Revisit if

- **U-a is answered.** Either answer is actionable: a clean `.git/config` strengthens point 3; a
  dirty one makes point 5's expiry the sole containment and deserves saying out loud.
- **U-c is answered.** A working transform makes point 4's preference real; a failure demotes it and
  this document should be amended rather than quietly reinterpreted.
- **A short-lived repo-scoped token source becomes available**, which is what makes point 5
  satisfiable rather than aspirational.
- **The launcher stops being maintainer-only.** Different threat model, different ADR.
- **Claude Code or the SDK grows a first-class secret primitive** — a write-only secret store the
  guest can reference without the value passing through our process. That would replace points 2 and
  4 outright.
