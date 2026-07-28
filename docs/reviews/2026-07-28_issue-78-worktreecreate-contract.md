# Issue #78 — `WorktreeCreate` contract determination

> **Date**: 2026-07-28 · **CC version**: 2.1.220 · **Status**: contract ANSWERED; fix recommended, not applied
> **Method**: two independent primary sources — the official hooks documentation (raw markdown, not
> summarizer output) and the locally installed CC 2.1.220 binary's constant pool + JS region. They agree
> on every load-bearing point. Working artifacts: `.claude/reviews/78-a1-docs.md`, `.claude/reviews/78-a3-local.md`.

## Verdict

`WorktreeCreate` is a **provider** hook, not an observer. ctk's reading of it was wrong, and the hook
has never worked in any respect — not just the stdout half. **`WorktreeRemove` is a different contract
and is NOT broken.**

**An observer path does exist**, but not among the hook events: `PostToolUse` with
`matcher: "EnterWorktree"` receives `tool_response = {worktreePath, worktreeBranch, message}` after
creation, with no responsibility for creating anything. It covers only the mid-session `EnterWorktree`
tool route — not `--worktree` startup, subagent `isolation: "worktree"`, or background sessions. See (c).

**Recommendation: delete the `WorktreeCreate` wiring. Keep `WorktreeRemove`.** Unchanged by the above —
it rests on the stdout contract and the no-fallback branch, both independently confirmed under adversarial
review.

---

## (a) The exact `WorktreeCreate` stdout contract

**Command hooks print a path. Standard hook JSON is never parsed for this event.**

Docs, `#### WorktreeCreate output` (verbatim):

> * **Command hooks** (`type: "command"`): print the path as the last non-empty line of stdout. Claude Code strips ANSI escape codes before reading that line, so shell startup banners printed before your `echo` are ignored. Redirect any other hook output to stderr.
> * **HTTP hooks** (`type: "http"`): return `{ "hookSpecificOutput": { "hookEventName": "WorktreeCreate", "worktreePath": "/absolute/path" } }` in the response body.
>
> If the hook fails or produces no path, worktree creation fails with an error.

The binary implements exactly that (byte `237764304`):

```js
n = r.filter(o => o.succeeded).map(o => DFy(o.output)).find(o => o.length > 0);
…
if (U$o.isAbsolute(n)) return { worktreePath: n };
return { worktreePath: U$o.resolve(await q$o(), n) }

function DFy(e) { return Ri(e).split("\n").map(t => t.trim()).filter(Boolean).at(-1) ?? "" }
```

| Question | Answer |
|---|---|
| All of stdout, last line, a field? | **Last non-empty, trimmed, ANSI-stripped line.** `DFy` = strip → split → trim → drop empties → `.at(-1)` |
| Is hook JSON accepted? | **No, for command hooks.** `hookSpecificOutput.worktreePath` is HTTP-only (added 2.1.84). The JSON string *becomes* the path. |
| Relative path? | Resolved against **the hook's cwd** (`path.resolve`), `.`/`..` collapsed — which is precisely how `{"continue":true,…}` became `<project-root>/{"continue":true,…}` |
| Empty stdout → fallback? | **No.** Throws `WorktreeCreate hook failed: hook succeeded but returned no worktree path`. There is no degradation to native git. |
| Multiple hooks? | First *succeeded* hook with non-empty output wins (`.find`) |
| Exit codes | **The one event where any non-zero exit aborts the action** — not just exit 2 |

**Post-conditions the hook must also satisfy.** The dot-segment and symlink-ancestry rejections apply on
**all three** creation routes. The directory-existence check is **route-specific, not universal**: only
`HPt` (the agent-isolation route, `230534400`) calls `xDu(path, true)` → *"Worktree directory does not
exist at … after creation. Refusing to launch agent in parent repo"*. `SYr` (the session/`EnterWorktree`
route) has no such check; there the failure surfaces later as *"the session prints an error naming the path
and exits with code 1"*.

The binary states the feature's actual purpose:

> `Cannot create agent worktree: not in a git repository and no WorktreeCreate hooks are configured. Configure WorktreeCreate/WorktreeRemove hooks in settings.json to use worktree isolation with other VCS systems.`

It exists so SVN/Perforce/Mercurial users can supply a working copy. It is not a notification.

## (b) `WorktreeRemove` is NOT equally broken

Verified against its own code path and its own doc section, not by symmetry.

- **Input** carries `worktree_path` — binary: `{...Kf(void 0), hook_event_name:"WorktreeRemove", worktree_path: e}`, schema `E.object({hook_event_name: E.literal("WorktreeRemove"), worktree_path: E.string()})`.
- **Output**: docs — *"WorktreeRemove hooks have no decision control. They can't block worktree removal but can perform cleanup tasks… Hook failures are logged in debug mode only."*
- Gated by a **separate** predicate (`hasWorktreeRemoveHook`), so it plays no part in creation.

`{"continue":true,"suppressOutput":true}` is **valid for `WorktreeRemove` and fatal for `WorktreeCreate`.**
The asymmetry is real. ctk's `worktree-remove.ts` reads the correct field. **No change needed.**

## (c) No observer event exists

**The real event count is 31, not 30 — and the docs-only enumeration missed one.** The binary carries a
single authoritative dispatch map, `HOOK_EVENT_REGISTRY` (`OFy`), with **31** keys. The docs page lists
**30**. The undocumented 31st is **`DirectoryAdded`**.

This matters methodologically: the docs enumeration was "confirmed complete two ways" (30-row summary table
*and* 30 `###` subsections) — but both checks confirm the *page*, not the *product*. Only the binary settles
completeness. An "X does not exist" claim built on the docs alone would have been wrong about the surface it
was quantifying over.

`DirectoryAdded` is the strongest candidate to overturn this section — a worktree is a newly added
directory — so it was checked directly rather than assumed:

```js
{hook_event_name:"DirectoryAdded", directory: e, source: t}
source: E.enum(["slash_command","register_repo_root"])
        .describe('How the directory was added: "slash_command" for /add-dir…')
```

Its trigger set is `/add-dir` and repo-root registration. **It does not fire on worktree creation.**
Disqualified — but on evidence, not omission.

Every other candidate was disqualified against its **input schema**, not its one-line description:

| Candidate | Verdict |
|---|---|
| `WorktreeCreate` | Provider. Also disables `.worktreeinclude` processing when registered. |
| `WorktreeRemove` | Observer, but fires on removal — wrong end of the lifecycle. |
| `SubagentStart` | Input is `agent_id` + `agent_type` only. Cannot distinguish an isolated subagent, nor learn the path. |
| `SessionStart` | `source` is `startup`/`resume`/`clear`/`compact`/`fork`. **No `worktree` source value, no worktree field.** |
| `CwdChanged` | Closest partial match; docs are **silent** on whether worktree entry triggers it. |
| `DirectoryAdded` | Undocumented, binary-only. `source` enum is `slash_command` / `register_repo_root`. Does not fire on worktree creation. |

**Answer, among hook events: no.** The only creation-time worktree *event* is the provider.

### ⚠ But the question was scoped wrong — an observer DOES exist (adversarial finding)

The survey above covers **hook events** only. It never considered **tools**, and that is where the answer
was. `EnterWorktree` is a real tool (`Ipe="EnterWorktree"`, byte `230685676`) whose `outputSchema` is
`{worktreePath, worktreeBranch?, message}`, and whose result `data` is passed verbatim as `tool_response`
to `PostToolUse` (`232617187`, `234741200`/`235420400`). `"matcher": "EnterWorktree"` scopes it exactly.

So a `PostToolUse` hook receives **the path and the branch** — the very two fields ctk invented — after
creation, with no obligation to create anything and no ability to break creation (`hooks.md:712`:
PostToolUse cannot undo the tool).

**Scope honestly:** this covers only the mid-session `EnterWorktree` tool route. It does **not** cover
`--worktree` startup, subagent `isolation: "worktree"`, or background sessions — which is the route in the
reported failure. A hook would also need to distinguish create-vs-enter via `tool_input`.

**Consequence:** the per-worktree continuity seeding that ctk and etk's docs describe is **achievable**,
not permanently impossible. That changes work item 4 — the docs are aspirational, not simply false.

`CwdChanged` — **closed, answer is no.** Its emitter `Ttn` (`237755041`) has exactly one caller
(`232556993`), inside the persistent shell's post-command cwd tracker. Worktree entry is a `process.chdir`
in the tool/session path and never routes through it. Stronger than the docs' silence.

**Unresolved source discrepancy (does not affect the recommendation).** The binary agent read the extractor
input as *combined stdout+stderr*; the docs say stdout and advise *"Redirect any other hook output to stderr"*
— advice that would be useless if stderr were also read. The docs reading is more likely correct, and the
error path has a separate "stderr redacted" message implying the two are distinct. Left unresolved because
nothing here turns on it: under either reading, our JSON output fails.

---

## Second defect, found en route: the input fields were guessed and are inert

Independent of the stdout bug, `worktree-create.ts` reads fields `WorktreeCreate` does not send.

`WorktreeCreate`'s input is **`name` only** — a slug like `bold-oak-a3f2` (docs F7; binary
`hook_event_name:"WorktreeCreate",name:e`). But the hook reads:

```ts
const worktreePath   = input.worktree_path   || input.cwd || '.';   // → always input.cwd
const worktreeBranch = input.worktree_branch || 'unknown';          // → always 'unknown'
```

`worktree_branch` has **zero occurrences in the entire 245 MB binary**. `worktree_path` exists but is
constructed **only** for `WorktreeRemove`.

So even with a correct stdout contract, the hook would write `.claude/context/shared-context.json` into
**the parent repo's cwd**, with `branch: "unknown"`. This is the repo's documented defect class — a guessed
field name never errors, it silently degrades to a fallback.

`types.ts:185-191` also asserts *"Available since Claude Code v2.1.70"* for both fields. The events were
introduced in **2.1.50** — but CHANGELOG **2.1.69** reads *"Fixed `WorktreeCreate` and `WorktreeRemove`
**plugin** hooks being silently ignored"*, so for a plugin-supplied hook ~2.1.69/2.1.70 genuinely is the
first version where these events did anything. **The version annotation is defensible; the sound criticism
is the field name.** (An earlier draft of this document called the comment "wrong twice" — that was an
overclaim, corrected here.)

**The tests pin the defect rather than catching it.** `worktree-create.test.ts` synthesizes
`worktree_path`/`worktree_branch` inputs CC never sends, then asserts `result.continue === true` and
`result.suppressOutput === true` — the exact output CC rejects. The suite is green *because* it encodes the
wrong contract.

---

## Recommendation

**Delete the `WorktreeCreate` wiring** (`plugins/continuity-toolkit/hooks/hooks.json:407-417`).

Proven safe: the call site is `if (Vor(e), Lke()) { …hook path… } else { …native git path… }`, where
`Lke` is exported as `hasWorktreeCreateHook` and explicitly counts **plugin-supplied** hooks:

```js
tt(ocs, { hasWorktreeRemoveHook: () => ncs, hasWorktreeCreateHook: () => Lke });
function Lke() {
  if (fd("hooks")) return !1;
  let e = Fie()?.WorktreeCreate;  if (e && e.length > 0) return !0;
  …
  let t = gQ()?.WorktreeCreate;   if (!t || t.length === 0) return !1;   // plugin hooks
  …
}
```

Removing ctk's entry makes `Lke()` return false, and CC takes its own `git worktree add` path. This
restores the feature rather than merely removing our participation in it.

**Do not implement the provider contract.** It would make ctk responsible for creating worktrees for every
user of every project where it is installed — and `WorktreeCreate` **accepts no matcher**, so it cannot be
narrowed:

> `…WorktreeCreate`, `WorktreeRemove`… don't support matchers and always fire on every occurrence. If you add a `matcher` field to these events, it is silently ignored.

That means owning path normalization, symlink-ancestry screening, directory-existence post-conditions, and
`.worktreeinclude` copying — permanently, for a capability that has never worked once.

### Work items

1. Remove the `WorktreeCreate` block from ctk `hooks.json`; delete `worktree-create.ts` and its tests (dead once unwired).
2. **Keep** `WorktreeRemove` wiring and hook — correct contract, correct field.
3. Fix `types.ts:185-191`: drop `worktree_branch` entirely; correct `worktree_path`'s comment to *WorktreeRemove input, since 2.1.50*. Re-check `getWorktreeBranch()` in `lib/input.ts:538` — it reads a field that does not exist.
4. Reconcile docs: ctk `CLAUDE.md:86` hook table; etk `commands/start-parallel.md:234` and etk `CHANGELOG.md:170`, which both assert the hook "fires on each, seeding continuity state" — it never did. **Correct the claim rather than just deleting it**: per-worktree seeding is achievable via `PostToolUse` + `matcher: "EnterWorktree"` (see (c)), just not on the route those docs describe.
5. Hook count: **currently correct, no drift.** `git grep -c "^registerHook("` (anchored at line start)
   gives **35**, matching the documented "32 shared + 3 ctk-specific". An unanchored
   `git grep -c "registerHook("` gives 37 — it also matches the `export function registerHook(`
   definition and `unregisterHook(`. Reference census ≠ call census; anchor the pattern.
   Deleting `worktree-create` takes the basis to **34 (31 shared + 3 ctk-specific)** — update ctk
   `CLAUDE.md:54` and root `CLAUDE.md:135` in the same commit.
6. ctk version bump across all 6 release sites.
7. **File a separate issue — two more plugin hooks may be dead for a different reason.** The `CwdChanged`
   emitter's call site (`232556993`) gates on `Fie()` (settings hooks) and `Wne()` only — it **never
   consults `gQ()`**, the plugin registry (`225507102`: `function gQ(){return dFn().registeredHooks}`).
   ctk wires **both `CwdChanged` and `FileChanged`** as plugin hooks in `hooks.json`. If the gate genuinely
   skips the plugin registry, those two are as unreachable as `WorktreeCreate` was — silently, with no
   error. **Flagged, not asserted**: this needs its own verification pass and must not ride along with
   this fix.

### Open / unverified

- **Recovery path for the continuity-init intent (partially established).** `SessionStart`'s payload is
  `{hook_event_name:"SessionStart", source:e, agent_type:n, model:o, session_title:r}` — it carries
  `agent_type`, so it **does** fire in agent contexts, and ctk **already wires `SessionStart`**
  (`hooks.json:4`). A handler could therefore init continuity by comparing `cwd` against the main project
  dir. **Still unverified**: whether an `isolation: "worktree"` subagent triggers `SessionStart` with `cwd`
  set to the worktree. Note `source` has no `worktree` value, so the hook cannot self-identify as a worktree
  session — it must infer from `cwd`. Treat as a follow-on option, not part of the deletion.
- Whether `CwdChanged` fires on worktree entry — docs silent.
- Whether a `WorktreeCreate` hook may return a path to an already-existing directory it did not create
  (a passthrough that defers to git) — not documented either way.
- `type: "mcp_tool"` is listed as supported for `WorktreeCreate`, but its path-return mechanism is
  specified nowhere. Genuine documentation gap.
