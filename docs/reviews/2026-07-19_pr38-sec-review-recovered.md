Cleanup done; worktrees removed and the repo is back to `2ca4c28` with only your in-progress CHANGELOG edit. Here is the review.

## Findings, most severe first

### 1. The CHANGELOG's false-positive accounting is measurably wrong — MEDIUM, fix before merge
`plugins/continuity-toolkit/CHANGELOG.md:29-39`

The claim is specific and checkable: *"swept against 27 realistic developer commands. Three are newly denied"*, listing kubectl jsonpath plus two message-text cases, concluding *"Only the first is a real misfire."*

A 12-command sweep found **four more newly-denied commands**, none of which are message-text mentions:

| Command | pre-PR | at HEAD |
|---|---|---|
| `echo "*<envfile>" >> .gitignore` | ALLOW | **BLOCK** |
| `echo "!<envfile>.example" >> .gitignore` | ALLOW | **BLOCK** |
| `git check-ignore *<envfile>` | ALLOW | **BLOCK** |
| `ls -la *<envfile>` / `find . -name "*<envfile>"` | ALLOW | **BLOCK** |

Verified by mutating the lookbehind back to the pre-PR enumerated form in an isolated worktree: all seven probes ALLOW there, all seven BLOCK at HEAD.

These are worse misfires than the kubectl case you singled out. Writing an ignore rule for env files is a routine, *security-positive* setup action that never reads the file; `ls`/`find` with a glob are metadata-only. Both are more common in agent workflows than a JSONPath selector, and a deny is terminal for a forked skill.

Mitigating: `echo ".env" >> .gitignore` was already blocked pre-PR (the quote is in the old class), so the inversion widens an already-broken flow rather than breaking a working one. The trade is still right.

The defect is in the accuracy of the record, not the regex. In a repo whose discipline is "measure, don't assert," shipping a false measurement in the release notes is the exact failure mode that discipline exists to prevent. Correct the count and the "only the first is a real misfire" conclusion. If you later want to cut FP cost, the narrow fix is a glob/ignore-rule exemption — not a return to enumeration.

### 2. One of the seven new pinned tests pins a non-vector — LOW
`plugins/continuity-toolkit/hooks/tests/pretool/security-blocker.test.ts` — `['env file reached via bracket glob', 'cat [.].env']`

Built a real fixture dir containing `.env`, `..env`, `config.env` and ran each spelling through bash:

```
[.]env   -> (no match)      [.].env  -> (no match)
*env     -> config.env      *.env    -> config.env
.e"n"v   -> SECRET          .[e]nv   -> SECRET
```

`[.].env` reaches **no file** — bash won't let a bracket expression satisfy the leading-dot rule. The label is wrong; it does not reach an env file. The test isn't vacuous (it exercises `]` as a preceding delimiter and does fail on revert), just mislabeled. Relabel it, or swap in a vector that actually resolves.

### 3. The inversion closes the delimiter class but not the token-obfuscation class — LOW, pre-existing
Verified against the fixture that these reach the real secret and are ALLOWED at HEAD: `cat .e"n"v`, `cat .[e]nv`, `X=env; cat .$X`, `cp *env /tmp/x`.

None are regressions — all defeat the pre-PR pattern identically, and none are reachable by *any* lookbehind change, since they remove the literal token from the command text. Your claim is scoped to the delimiter class and within that scope it holds. Worth one line in the CHANGELOG so a future reviewer doesn't read the delimiter fix as completeness.

### 4. Exempt-name laundering — informational, pre-existing
`cat process.env` and `cp secret import.meta.env` are ALLOWED (exemptions are by exact token). Chained with the dotless glob above, `cp *env process.env && cat process.env` is a two-step read that never trips the hook. Inherent to having a text-level exemption; not introduced here.

## Verifications that passed

**Attacking the inversion (item 1).** Swept all 32 printable punctuation chars as the character immediately preceding the token: **zero** allowed at HEAD (pre-PR: 22 allowed). Every realistic exfil vector blocks — glued redirects into curl/nc, `$(<file)` fast-read, dotted globs, `?` glob, brace expansion, `scp`/`rsync host:path`, process substitution, here-string, `exec 3<`, escaped dot, ANSI-C quoting, tilde paths. I could not find a delimiter-class miss.

**Exemption integrity (item 3) — your reasoning holds.** All seven real filenames stay blocked (`build-process.env`, `preprocess.env`, `my.process.env`, `a.import.meta.env`, `x-import.meta.env`, path-prefixed, and `touch x.process.env`), and all four code idioms stay exempt. The mechanism is as the comment claims: in `build-process.env` the engine cannot start at the inner `process` because `-` ∈ `[\w.-]`, so `(?!process\.env\b)` cannot fire there; the only viable start is the token start, where the lookahead doesn't apply.

**Test non-vacuity (item 4) — your "exactly 7" confirmed independently.** inverted: 398 pass / 1 skip · `@`-enumerated: **exactly 7 fail**, and they are exactly the 7 new delimiter tests · original enumerated: **exactly 14 fail** (7 delimiter + 7 curl). Note the four benign `@` tests from `b99b1af` (`npm i @scope/package` etc.) pass under all three forms — harmless, but they are not evidence of anything.

**`.envrc` twin (item 3, original brief).** Consistent — both patterns inverted identically, `.envrc` vectors block. It correctly needs its own pattern: `\.env\b` cannot match inside `.envrc` (no word boundary between `v` and `r`).

**Built artifact (item 5).** `dist/src/index.js` and `dist/bin/run-hook.js` each contain exactly 2 occurrences of `(?<![\w.-])` and **0** of either enumerated form. No stale copy.

**No ReDoS.** 50k-char pathological inputs (all dots, dot-word pairs, many tokens) complete in 1–3 ms.

**Suite.** 52 files, 2073 pass / 1 skip. Typecheck reports 5 errors, but I confirmed on a `main` worktree that the 2 source errors (`src/lib/dangerous-bash/index.ts:64`, `src/prompt/hipaa-context-injector.ts:45`) pre-exist; the 3 `TS6046` are a local `@tsconfig/node22`-vs-`typescript` version mismatch. None introduced by this PR.

Two process notes: your earlier ground-truth claims from `b99b1af` both held — I read `shared/hooks-infra/src/lib/dangerous-bash/http.ts` (only `curl|sh` RCE and DELETE/PUT/PATCH; a `-d @file` POST matches nothing) and confirmed empirically that reverting `@` left `curl -d @<envfile>` fully allowed, so nothing backstopped it. Also, the tree was being edited underneath me mid-review, which is why I moved to detached worktrees — worth serializing if you run reviewers concurrently.

**VERDICT: FIX-FIRST** — the regex is correct and should ship exactly as written; I could not break the delimiter class. The required fix is the CHANGELOG's false-positive accounting (Finding 1), plus the mislabeled test (Finding 2). Both are doc/label edits, not code.

STATUS: DONE