# #114 ↔ #99 — coupling investigation (measured, no fix applied)

> 2026-08-02 · `main` @ `c5a9101` · ctk 2.17.5 · **investigation only, working tree clean**
> Instruments: `bashCombined` (the real wired entry point), the 31-entry FP corpus,
> the full ctk (2617) and shared (1415) suites. Probes archived in the session
> scratchpad, not committed.

## Summary

#114 is real, is **broader than filed**, and its stated coupling to #99 is **wrong in the
direction that matters**. Closing #114 does not convert #99's five documented gaps into live
bypasses — measured, those gaps are *already* live and are **completely unaffected** by the fix.

A purely additive 9-line candidate closes #114 and 6 further protection failures with
**zero** regressions across 4036 tests.

## 1. #114 confirmed — and it is not "cd-then-relative"

Measured through `bashCombined`, so these are net user-visible outcomes, not single-matcher results:

| Command | blocker | net outcome |
|---|---|---|
| `cd <etc> && cat passwd` | false | **AUTO-APPROVED** |
| `cd <var> && cat log/system.log` | false | **AUTO-APPROVED** |
| `cd <usr> && cat bin/something` | false | **AUTO-APPROVED** |
| `ls <etc>` — **no cd, no relative path** | false | **AUTO-APPROVED** |
| `ls <etc>/` (trailing separator) | true | DENY |
| `cat <etc>/passwd` (qualified) | true | DENY |

The issue frames the defect as `cd`-then-relative. **The `cd` is incidental.** Row 4 shows a bare
system-directory reference is unmatched on its own; `cd` merely makes it *useful*. Any fix keyed on
`cd` would miss the general case.

## 2. The documented exposure bound is overstated

`security-blocker.ts:320-322` and the closing assertion of the KNOWN GAPS block state that what
bounds the exposure is that "BASH_SECRET_PATTERNS run first and independently." The KNOWN GAPS
block tests exactly two cases — `.ssh/id_rsa` and `.env` — and both happen to be in the class the
claim holds for. **It does not generalize.**

Splitting every secret pattern with a `cd`, measured before any change: **6 of 12 defeated.**

| Protection | qualified | after `cd` split |
|---|---|---|
| `.env`, `kubeconfig`, `*.key` | DENY | DENY (self-identifying by filename) |
| **`.ssh/id_rsa`** | DENY | **AUTO-APPROVED** |
| **`/etc/shadow`, `/etc/passwd`, `/etc/sudoers`** | DENY | **AUTO-APPROVED** |
| **`/run/secrets/*`** | DENY | **AUTO-APPROVED** |
| **`/root/*`** | DENY | **AUTO-APPROVED** |
| `/etc/ssh/*`, `/etc/ssl/private/*`, `/proc/1/environ` | DENY | DENY *(only because the `cd` target itself still contains a trailing separator)* |

`.ssh/id_` is **prefix-dependent**, not self-identifying — it requires the `.ssh/` component, so
`cd ~/.ssh && cat id_rsa` is auto-approved. This corrected an initial mis-classification of mine;
it was found by measuring, not by reading the patterns.

The three survivors survive incidentally, not by design. Single root cause throughout: the
trailing-separator requirement.

## 3. The coupling claim, tested

> #114: *"closing this issue converts those five documented gaps into live bypasses."*

**Measured false as stated.** Under the candidate fix, all 41 tests in
`security-blocker-macos-temp.test.ts` still pass — *including* the five KNOWN GAPS still pinned as
`false`. Net outcomes for the five gaps are **identical before and after**: 4 AUTO-APPROVED,
1 defer-to-prompt.

The reason is structural: the exempt path's only `/var` occurrence is followed by `/folders`, so a
bare-directory pattern — which by construction never matches a name followed by `/` — cannot fire
on it either way.

What is true is weaker and differently shaped:

- ✅ #114 **is** why #113's "no new resource is reachable" held. `/var/log` was already reachable.
- ❌ Closing #114 does **not** open, widen, or worsen the five gaps.
- ⚠ It does make gap #4 **load-bearing instead of redundant** — after the fix it is the remaining
  route into the exempt tree. That is a follow-up, not a blocker, and it cannot be closed by regex
  (deciding where a path resolves needs a shell parse — the wall the abandoned mutation gate hit).

Note also that gap #4 as written (`cd <TMP> && cat ../../../log/system.log`) ascends only to
`/var/folders/`, not `/var/log` — it needs a fourth `..` to escape. Unmatched either way.

## 4. Candidate measured against the designated instrument

**Design: purely additive.** Every existing pattern is left byte-identical; new entries fire *only*
when a protected directory name is **not** followed by `/`. They therefore cannot match any
qualified path, and cannot disturb the `/var/folders/` exemption.

```
system dirs:  /\/etc(?![\w\-/])/  /\/usr(?![\w\-/])/  /\/var(?![\w\-/])/
              /\/sys(?![\w\-/])/  /\/proc(?![\w\-/])/ /\/boot(?![\w\-/])/  /\/root(?![\w\-/])/
secrets:      /\.ssh(?![\w\-/])/  /\/run\/secrets(?![\w\-/])/
```

| Measurement | Result |
|---|---|
| 31-entry FP corpus | **fp = 0, fn = 0** (gate asserts both) |
| `security-blocker-macos-temp.test.ts` | **41/41 pass**, KNOWN GAPS unchanged |
| #114 table | **all 6 rows DENY** |
| Exposure bound | **6/12 defeated → 0/12** |
| ctk full suite | **2621 pass** (2617 baseline + 4 probes), 0 fail |
| shared hooks-infra suite | **1415 pass** — exactly baseline |

A first candidate that *rewrote* `/\/var\/(?!folders\/)/` in place was **rejected**: the test file's
integrity guard (`security-blocker-macos-temp.test.ts:48`) searches for the literal `(?!folders` and
threw `the fix was reverted`. That guard worked as designed and is what pushed the design additive.

## 5. Residual risk

- The corpus is 31 entries. `fp = 0` there plus 4036 green tests is the strongest available
  evidence, but it is **not** proof of no field false positive. The issue's warning stands: a bare
  directory name appears in more benign commands than a qualified path does. The additive shape is
  what bounds this — it only ever fires on a name with no trailing `/`.
- `/\/root(?![\w\-/])/` was placed with the system dirs though its sibling `/\/root\//` lives in the
  secret patterns. Cosmetic; belongs with its sibling in a real fix.
- Gap #4 becomes load-bearing (§3). Unfixable by regex; worth an explicit note in the KNOWN GAPS
  block rather than a code change.

## Recommendation

**Close #114 with the additive candidate.** It is free of the trade the issue feared: it fixes a
confirmed auto-approval of `~/.ssh/id_rsa`, `/etc/shadow` and `/root/`, costs nothing measurable,
and leaves #99's documented trade exactly as it was recorded.

Required in the same change:
1. Correct the overstated exposure-bound claim in `security-blocker.ts:320-322` **and** the KNOWN
   GAPS closing assertion — per the #75 in-place-correction policy. The current text would have a
   maintainer believe secret patterns bound this class. They do not.
2. Extend the KNOWN GAPS block with the two-class distinction (self-identifying vs prefix-dependent)
   and a note that gap #4 is now load-bearing.
3. Must-fail controls derived from the exported array, asserted through
   `matchesBashSensitivePattern(...).pattern` — never a re-declared local regex.
