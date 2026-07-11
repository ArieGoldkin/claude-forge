# Finder Angles — the review decomposition

The single source for the **angle taxonomy** review agents hunt with. Adapted from
Anthropic's bundled `/code-review` finder-angle decomposition (extracted 2026-07-10;
see `docs/reviews/2026-07-10_anthropic-review-skills-vs-etk.md`) into our domain-agnostic,
structured-finding pipeline. Agents cite the angle they were hunting in the `Evidence` field.

Each angle is a distinct **lens**, not a checklist item — two angles flagging the same line
for different reasons is a signal, not a duplicate; record both and let Phase 6 dedup.

## Correctness angles (hunt for bugs)

- **A — line-by-line diff scan.** Read every hunk, then Read the enclosing function (bugs in
  *unchanged* lines of a touched function are in scope — the change re-exposes or fails to fix
  them). For each line ask: what input, state, timing, or platform makes this wrong? Inverted/
  wrong conditions, off-by-one, null/undefined deref, missing `await`, falsy-zero checks,
  wrong-variable copy-paste, error swallowed in a catch, unescaped regex metachars.
- **B — removed-behavior auditor.** For every line the diff **deletes or replaces**, name the
  invariant or behavior it enforced, then find where the new code re-establishes it. If you
  can't, that's a candidate: a removed guard, a dropped error path, a narrowed validation, a
  deleted test that covered a real case.
- **C — cross-file tracer.** For each changed function, Grep its **callers** and check whether the
  change breaks a call site (new precondition, changed return shape, new exception, timing/order
  dependency). Check **callees** too: does a parallel change in the same diff make a call unsafe?
- **D — language / framework pitfalls.** Scan for the classic footguns of the diff's language:
  JS falsy-zero, `==` coercion, closure-captured loop var; Python mutable default args,
  late-binding closures, dataclass default evaluated once; Go nil-map write, range-var capture;
  SQL injection; timezone/DST drift; float equality.
- **E — wrapper / proxy correctness.** When the change adds or modifies a type that **wraps
  another** (cache, proxy, decorator, adapter): check that every method routes to the *wrapped
  instance*, not back through a registry/session/global — e.g. a caching provider holding a
  `delegate` that resolves IDs via `session.get(...)` instead of `delegate.get(...)` will
  re-enter the cache or recurse. Check the wrapper forwards **all** methods callers actually use.
  (This repo's own rtk-proxy compatibility fix, ctk 2.7.2, is exactly this class.)

## Cleanup angles (hunt for quality debt the change adds)

State the concrete cost in `failure_scenario` (what is duplicated, wasted, or harder to
maintain) — not a crash. **Correctness always outranks cleanup when the finding cap forces a cut.**

- **Reuse.** New code that re-implements something the codebase already has — Grep shared/utility
  modules and files adjacent to the change; name the existing helper to call instead.
- **Simplification.** Unnecessary complexity the change adds: redundant or derivable state,
  copy-paste with slight variation, deep nesting, dead code left behind. Name the simpler form.
- **Efficiency.** Wasted work the change introduces: redundant computation or repeated I/O,
  independent operations run sequentially, blocking work added to startup / hot paths. Also flag
  long-lived objects built from closures/captured environments — they keep the whole enclosing
  scope alive (a leak when that scope holds large values). Name the cheaper alternative.
- **Altitude.** Is each change at the right depth, or a fragile bandaid? Special cases layered on
  shared infrastructure signal the fix isn't deep enough — prefer generalizing the underlying
  mechanism over adding special cases.

## Conventions angle (project rules, not style)

- **Conventions (CLAUDE.md).** Find the CLAUDE.md files that govern the changed code: user-level
  `~/.claude/CLAUDE.md`, the repo-root `CLAUDE.md`, plus any `CLAUDE.md` / `CLAUDE.local.md` in a
  directory that is an **ancestor of a changed file** (a directory's CLAUDE.md applies only to
  files at or below it). Read each that exists, then check the diff for clear violations.

  **Only flag a violation when you can quote the exact rule and the exact line that breaks it** —
  no style preferences, no "spirit of the doc" inferences. In the finding, name the CLAUDE.md path
  and quote the rule so the report can cite it. If no CLAUDE.md applies, return nothing here.

## How agents use this

- The **Code Quality** agent (`agent-prompts/code-quality.md`, always launched) owns the
  correctness angles A–E, the cleanup angles, and the Conventions angle as its hunting method.
- Other agents apply the angles **relevant to their domain** (e.g. Security applies A/C/D through
  a security lens; Backend/Frontend apply C for their call sites) rather than re-deriving a method.
- Every candidate a maintainer would act on passes through — finders that silently drop
  half-believed candidates bypass the verify step and are the dominant cause of misses. Surfacing
  then verifying (Phase 5 / Phase 5.5) beats self-censoring at the finder.
