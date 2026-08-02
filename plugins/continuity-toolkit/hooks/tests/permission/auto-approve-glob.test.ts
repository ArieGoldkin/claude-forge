/**
 * Shell-expandable path operands (#116, glob half).
 *
 * `security-blocker` matches protected resources by literal TEXT, so a spelling
 * that reaches the same inode without writing the literal is unmatched, and
 * `auto-approve-safe-bash` then certifies the segment on its COMMAND prefix
 * alone. Measured through `bashCombined` at `a0ee038`: every row in the DEFECT
 * block below was net AUTO-APPROVED, including `cat ~/.s*h/*`, which dumps an
 * entire key directory in one command with no prompt.
 *
 * ⚠ THE ASSERTION IS THE EXACT NET OUTCOME, NOT `not.toBe('DENY')`. The KNOWN
 * GAPS block in security-blocker-case.test.ts pins these rows with
 * `not.toBe('DENY')`, which a DEFER satisfies just as well as an AUTO-APPROVE —
 * so that block cannot see this fix land, and equally cannot see it reverted.
 * Every row here asserts `'defer'` outright: revert the gate and the outcome
 * becomes `'AUTO-APPROVED'` and this file goes red. Ledger lesson — PR #113
 * shipped a control that passed on a full revert of the fix it was named for,
 * and PR #119's flag control pinned 10 of 30 rules.
 *
 * ⚠ THE FIX WITHHOLDS APPROVAL; IT DOES NOT DENY. `'defer'` is therefore the
 * CORRECT expectation and `'DENY'` would be a FAILURE, not a stronger pass — a
 * PreToolUse denial is terminal for a subagent, so a new denial surface on an
 * everyday shell idiom is the more expensive error. The FALSE PROMPTS block is
 * what stops a later reader "strengthening" this into a deny.
 *
 * ⚠ THE SCOPE IS THE GLOB (AND BRACE) CLASS ONLY. #116 stays OPEN for
 * quote-splitting — do not write a closing keyword for it.
 *
 * @module tests/permission/auto-approve-glob
 */

import { describe, expect, it } from 'vitest';
import { hasExpandablePathGlob } from '../../src/permission/auto-approve-safe-bash.js';
import { bashCombined } from '../../src/pretool/bash-combined.js';
import type { HookInput } from '../../src/types.js';

// Assembled from fragments so this file's own text carries no protected
// literal. ⚠ THE LABELS COUNT TOO — a review agent died on literals inside its
// own test-case labels during PR #115, so the labels below stay generic.
const S = '/';
const PW = 'pass' + 'wd';
const SSH = '.' + 'ssh';
const ETC = 'e' + 'tc';
const KEY = 'id_' + 'rsa';

/** The real wired decision — what the user actually experiences. */
async function net(command: string): Promise<string> {
  const r = await bashCombined({ tool_name: 'Bash', tool_input: { command } } as HookInput);
  const d = r.hookSpecificOutput?.permissionDecision;
  if (r.continue === false || d === 'deny') return 'DENY';
  if (d === 'ask') return 'ASK';
  if (d === 'allow') return 'AUTO-APPROVED';
  return 'defer';
}

describe('#116 shell-expandable path operands', () => {
  describe('the reported defect — measured end to end, every row AUTO-APPROVED before this fix', () => {
    // ⚠ EACH ROW VARIES THE TARGET OR THE MECHANISM, not just the failure mode.
    // Four different protected roots and five different expansion forms are
    // involved, so no single over-broad rule passes all of them by accident.
    // Ledger lesson from PR #115: negative controls that vary only the suffix
    // cannot see a missing boundary.
    const cases: Array<[string, string]> = [
      // --- rooted branch ---
      ['wildcard reaches the whole key dir', `cat ~${S}.s*h${S}*`],
      ['wildcard reaches key material', `cat ~${S}.s*h${S}id_*`],
      ['wildcard, bare system dir', `ls ${S}e*c`],
      ['single-char wildcard', `cat ${S}et?${S}${PW}`],
      ['leading wildcard', `cat ${S}*tc${S}${PW}`],
      ['bracket class', `cat ~${S}.ss[h]${S}${KEY}`],
      ['wildcard split by cd', `cd ~${S}.s*h && cat ${KEY}`],
      ['absolute spelling of home', `cat ${S}Users${S}someone${S}.s*h${S}${KEY}`],
      ['home variable spelling', `cat "$HOME"${S}.s*h${S}${KEY}`],
      ['two wildcards, superuser tree', `ls ${S}v*r${S}ro*t`],
      ['wildcard as a find root', `find ${S}e*c -name hosts`],
      ['recursive read of a wildcard dir', `grep -r x ~${S}.s*h`],
      ['recursive read, variable spelling', `grep -r x "$HOME"${S}.s*h`],
      ['brace expansion, system dir', `cat ${S}{e,}tc${S}${PW}`],
      ['brace expansion, key dir', `cat ~${S}.{s,}sh${S}${KEY}`],
      ['proxy-prefixed', `rtk cat ~${S}.s*h${S}${KEY}`],
      // --- directory-component branch: relative operand reached via a cd ---
      ['relative wildcard dir after cd home', `cd ~ && cat .s*h${S}${KEY}`],
      ['relative wildcard dir after cd root', `cd ${S} && cat e*c${S}${PW}`],
    ];
    for (const [label, cmd] of cases) {
      it(`net defer, no longer auto-approved: ${label}`, async () => {
        expect(await net(cmd)).toBe('defer');
      });
    }
  });

  describe('FALSE PROMPTS this rule is shaped to avoid', () => {
    // Measured against 24,520 real commands from local session transcripts.
    // The issue's own proposal — defer on ANY glob metacharacter — withheld 254
    // of the 2,801 commands auto-approved today (9.07%); these rows are the
    // shapes that difference is made of. They MUST stay auto-approved.
    const cases: Array<[string, string]> = [
      ['relative basename glob', `grep -rn x src${S}*.ts`],
      ['relative basename glob, two dirs deep', `wc -l apps${S}web${S}src${S}*.tsx`],
      ['find pattern flag value', `find apps -iname "*.tsx"`],
      ['find pattern flag, unquoted value', 'find apps -name *.ts'],
      ['grep include flag', 'grep -rn --include=*.ts x src'],
      ['no metacharacter at all', 'grep -rn x src'],
      // ⚠ THE NEXT FOUR ARE THE DISCRIMINATING ROWS FOR QUOTE AND ESCAPE
      // HANDLING, and they are rooted or directory-shaped ON PURPOSE. An
      // earlier draft used `cat "~/.s*h/*"` and `cat ./weird\*name.txt`, and a
      // mutation run proved BOTH were no-ops: strip quote tracking or escape
      // handling entirely and they still passed, because the relative,
      // basename-only shape fails both branches anyway. A negative control that
      // cannot fail under the mutation it exists to catch is not a control.
      ['quoted rooted operand is inert', `cat "${S}e*c${S}${PW}"`],
      ['single-quoted rooted operand is inert', `cat '~${S}.s*h${S}*'`],
      ['quoted regex operand with a separator', `grep -rn "a${S}*b" src`],
      ['escaped metacharacter in a rooted path', `cat ${S}tmp${S}weird\\*name.txt`],
    ];
    for (const [label, cmd] of cases) {
      it(`still auto-approved: ${label}`, async () => {
        expect(await net(cmd)).toBe('AUTO-APPROVED');
      });
    }
  });

  describe('the literal spellings stay DENIED — this fix changes nothing there', () => {
    const cases: Array<[string, string]> = [
      ['literal account file', `cat ${S}${ETC}${S}${PW}`],
      ['literal key material', `cat ~${S}${SSH}${S}${KEY}`],
      ['literal key dir, glob operand only', `cat ~${S}${SSH}${S}*`],
      ['literal system dir, glob operand only', `ls ${S}${ETC}${S}*`],
    ];
    for (const [label, cmd] of cases) {
      it(`net DENY: ${label}`, async () => {
        expect(await net(cmd)).toBe('DENY');
      });
    }
  });

  describe('hasExpandablePathGlob — the branches, asserted separately', () => {
    // The end-to-end rows above cannot tell WHICH branch fired. If one branch
    // were deleted the union would still be satisfied by the other on several
    // rows, so each branch is pinned on an input only it can match. Ledger
    // lesson: verify which rule makes each positive case pass.
    it('rooted branch: metacharacter in the LAST component, no trailing separator', () => {
      // The directory-component branch cannot see this one — nothing follows.
      expect(hasExpandablePathGlob(`ls ${S}e*c`)).toBe(true);
    });
    it('directory-component branch: relative operand the rooted branch cannot see', () => {
      expect(hasExpandablePathGlob(`cat .s*h${S}${KEY}`)).toBe(true);
    });
    it('neither branch: relative operand, metacharacter only in the basename', () => {
      expect(hasExpandablePathGlob(`grep -rn x src${S}*.ts`)).toBe(false);
    });
    it('quoting suppresses a metacharacter that would otherwise gate', () => {
      // Same operand unquoted IS gated (the row below) — that pairing is what
      // makes this assertion about QUOTING rather than about the operand.
      expect(hasExpandablePathGlob(`cat "${S}e*c${S}${PW}"`)).toBe(false);
      expect(hasExpandablePathGlob(`cat ${S}e*c${S}${PW}`)).toBe(true);
    });
    it('a backslash escape suppresses a metacharacter that would otherwise gate', () => {
      expect(hasExpandablePathGlob(`cat ${S}tmp${S}weird\\*name.txt`)).toBe(false);
      expect(hasExpandablePathGlob(`cat ${S}tmp${S}weird*name.txt`)).toBe(true);
    });
    it('a backslash inside single quotes is an ordinary character, as in bash', () => {
      // Both forms are quoted, so both are inert — the escape rule must not
      // reach inside `'…'` and start consuming the following character.
      expect(hasExpandablePathGlob(`cat '${S}tmp${S}a\\*b'`)).toBe(false);
    });
    it('an UNQUOTED pattern-flag value is still gated — the shell expands it', () => {
      // Pins the removal of the pattern-flag allowlist. Restoring that list
      // would make this false, which is the point: the list under-blocked.
      expect(hasExpandablePathGlob(`find apps -path *${S}node_modules${S}*`)).toBe(true);
      // ...while the QUOTED spelling people actually write stays inert.
      expect(hasExpandablePathGlob(`find apps -path "*${S}node_modules${S}*"`)).toBe(false);
    });

    // ⚠ THE TWO BLOCKS BELOW EXIST BECAUSE REVIEW OF PR #120 FOUND BOTH DEFECTS
    // IN CODE THAT ALREADY HAD "PASSING" TESTS. Each pins a spelling whose only
    // difference from an adjacent, already-covered one is the thing under test.
    it('a token that merely LOOKS like a flag is still inspected', () => {
      // A blanket `startsWith('-')` skip lived here and no test exercised it —
      // deleting it changed nothing, which is how a dead guard hides. It also
      // re-opened the pattern-flag hole by the back door: `--include=<pattern>`
      // is ONE token beginning with `-`, and `=` is the only form that flag
      // takes. Restore the skip and this row goes false.
      expect(hasExpandablePathGlob(`grep -rn --include=*${S}.s*h${S}* x ~`)).toBe(true);
      // The everyday spelling has no separator after its wildcard, so removing
      // the skip costs nothing — that pairing is what makes the row above a
      // statement about the SEPARATOR rather than about the leading dash.
      expect(hasExpandablePathGlob('grep -rn --include=*.ts x src')).toBe(false);
    });

    it('whitespace inside a quoted path does not defeat the quote tracking', () => {
      // A plain split(/\s+/) cut this into two tokens, the second BEGINNING mid
      // quote, so its opening `"` read as the START of a quoted region and every
      // metacharacter after it looked inert. The spelling WITH a space was
      // auto-approved while the one WITHOUT deferred, though the shell expands
      // both. The pair is the control: they must agree.
      expect(hasExpandablePathGlob(`cat "${S}some dir"${S}.s*h${S}*`)).toBe(true);
      expect(hasExpandablePathGlob(`cat "${S}somedir"${S}.s*h${S}*`)).toBe(true);
    });

    it('a genuinely quoted operand containing whitespace stays inert', () => {
      // The other direction: quote-aware tokenising must not turn every spaced
      // quoted string into a gate. Without this, the row above could be
      // satisfied by a tokeniser that simply stopped tracking quotes at all.
      expect(hasExpandablePathGlob(`cat "${S}some dir${S}.s*h${S}*"`)).toBe(false);
    });
  });

  describe('KNOWN GAPS — the glob class is closed, #116 is NOT', () => {
    // Pinned at their measured value deliberately, the same convention the #99,
    // #114 and #116-case blocks use: a documented trade, not a passing grade.
    // These carry NO metacharacter, so no glob rule can reach them — closing
    // them needs quote-stripping normalization, which is the remaining half.
    const gaps: Array<[string, string]> = [
      ['adjacent double quotes concatenate', `cat "${S}e""tc${S}${PW}"`],
      ['adjacent single quotes concatenate', `cat ${S}e''tc${S}${PW}`],
      ['quote inside a protected name', `cat ~${S}.s"s"h${S}${KEY}`],
      // Pre-existing and documented in BASH_SYSTEM_DIR_PATTERNS: no protected
      // literal appears at all. Untouched here — listed so the boundary of this
      // fix is explicit rather than inferred.
      ['no protected literal appears', `cd ${S} && cat ${ETC}${S}${PW}`],
      // ⚠ A RECURSIVE READER ROOTED AT AN UNPROTECTED ANCESTOR reaches the same
      // material with NO metacharacter, NO flag and NO protected literal in its
      // text, so no rule in this file can see it. Surfaced while checking a
      // PR #120 review finding, which had framed the flag spelling as the hole;
      // this is the class that spelling belongs to, and it is much wider.
      // Tracked separately — listed here so the gate is not mistaken for a
      // guarantee that a wildcard is the only way to reach a key directory.
      ['recursive reader, no metacharacter at all', 'grep -r x ~'],
    ];
    for (const [label, cmd] of gaps) {
      it(`still AUTO-APPROVED (tracked in #116): ${label}`, async () => {
        expect(await net(cmd)).toBe('AUTO-APPROVED');
      });
    }
  });
});
