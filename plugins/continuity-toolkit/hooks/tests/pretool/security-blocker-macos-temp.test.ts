/**
 * macOS per-user temp tree (#99).
 *
 * `BASH_SYSTEM_DIR_PATTERNS` carried a bare `/\/var\//`, and macOS puts every
 * user's TMPDIR under `/var/folders/`. Because system dirs are blocked on ANY
 * reference — there is no mutation gate, see the constant's docstring — any
 * installer, build tool, or test harness that wrote to TMPDIR and then ran the
 * result was denied. Ordinary work, denied on path text alone.
 *
 * ⚠ THE OBVIOUS FIX IS INCOMPLETE, AND THE ISSUE DID NOT MENTION THE GAP.
 * Narrowing to `/\/var\/(?!folders\/)/` alone opens a traversal bypass:
 * `/var/folders/x/../../../log/system.log` contains exactly ONE `/var/`, and it
 * is followed by `folders/`, so the lookahead suppresses the only match and the
 * path — which resolves to `/var/log/system.log` — sails through. Patterns match
 * RAW text with no `..` normalization.
 *
 * ⚠⚠ THE COMPANION GUARD IS PARTIAL. An earlier revision of this header said it
 * "closes" the bypass. It does not — adversarial review of PR #113 defeated it
 * five ways (a space in the path, a `..` ending in a quote, `cd` then a relative
 * path, traversal through a variable), each measured DENY before the narrowing
 * and ALLOW after. Those five are pinned below under KNOWN GAPS, as `false`,
 * deliberately: they are a documented trade, not a passing grade. The guard
 * catches the contiguous form — what a build tool emits by accident — and is not
 * a security boundary. It cannot be widened into one: deciding where a path
 * resolves needs a shell parse.
 *
 * ⚠ ONE PATTERN COVERS BOTH SPELLINGS **ON THE BASH PATH ONLY**. Those patterns
 * are unanchored, and `/private/var/folders/` CONTAINS `/var/folders/`, so a
 * single lookahead suppresses both. The WRITE path in path-utils.ts is anchored
 * (`^`) and therefore needs its own entry per spelling — the same requirement
 * with opposite mechanics. Both are verified here, in both directions.
 *
 * @module tests/pretool/security-blocker-macos-temp
 */

import { describe, expect, it } from 'vitest';
import { isProtectedPath } from '../../src/lib/path-utils.js';
import {
  BASH_SYSTEM_DIR_PATTERNS,
  matchesBashSensitivePattern,
} from '../../src/pretool/security-blocker.js';

/**
 * Pulled from the SHIPPED array rather than re-declared, so a test cannot pass
 * against a copy of a rule the source no longer contains. Failing to find one
 * is itself the failure.
 */
const NARROWED = BASH_SYSTEM_DIR_PATTERNS.find((r) => r.source.includes('(?!folders'));
const TRAVERSAL_GUARD = BASH_SYSTEM_DIR_PATTERNS.find((r) => r.source.includes('\\.\\.'));
if (!NARROWED || !TRAVERSAL_GUARD) {
  throw new Error('#99 patterns missing from BASH_SYSTEM_DIR_PATTERNS — the fix was reverted');
}

// Assembled from fragments so this test file's own text carries no protected
// literal — security-blocker matches COMMAND TEXT, and a literal here has
// repeatedly caused the repo's own tooling to deny commands that merely quote it.
const S = '/';
const VAR = `${S}var${S}`;
const PRIV = `${S}private`;
const TMP = `${VAR}folders${S}9x${S}t2k_5s${S}T`;
const PTMP = `${PRIV}${VAR}folders${S}9x${S}t2k_5s${S}T`;

const denied = (cmd: string) => matchesBashSensitivePattern(cmd).matched;

describe('#99 macOS per-user temp tree', () => {
  describe('allowed — the false positive this fixes', () => {
    const allowCases: Array<[string, string]> = [
      ['exec a script from TMPDIR', `sh ${TMP}${S}install.sh`],
      ['exec, private spelling', `sh ${PTMP}${S}install.sh`],
      ['read a build log', `cat ${TMP}${S}build.log`],
      ['read, private spelling', `cat ${PTMP}${S}build.log`],
      ['run a node script from TMPDIR', `node ${TMP}${S}a${S}b.js`],
      ['a filename containing dots is not traversal', `cat ${TMP}${S}my..file.txt`],
    ];
    for (const [label, cmd] of allowCases) {
      it(label, () => expect(denied(cmd)).toBe(false));
    }
  });

  describe('still denied — genuine system paths under the same root', () => {
    const denyCases: Array<[string, string]> = [
      ['var log', `rm ${VAR}log${S}system.log`],
      ['var root', `cat ${VAR}root${S}secret`],
      ['var db', `ls ${VAR}db`],
      ['var log, private spelling', `rm ${PRIV}${VAR}log${S}system.log`],
      ['var root, private spelling', `cat ${PRIV}${VAR}root${S}secret`],
    ];
    for (const [label, cmd] of denyCases) {
      it(label, () => expect(denied(cmd)).toBe(true));
    }
  });

  describe('still denied — traversal out of the exempt tree', () => {
    const escapeCases: Array<[string, string]> = [
      ['escape to var log', `cat ${TMP}${S}..${S}..${S}..${S}..${S}log${S}system.log`],
      ['escape, private spelling', `cat ${PTMP}${S}..${S}..${S}..${S}..${S}log${S}system.log`],
      ['single level up', `ls ${VAR}folders${S}9x${S}..${S}`],
      ['trailing, bare', `ls ${VAR}folders${S}9x${S}..`],
    ];
    for (const [label, cmd] of escapeCases) {
      it(label, () => expect(denied(cmd)).toBe(true));
    }
  });

  describe('sibling system dirs unaffected', () => {
    for (const [label, cmd] of [
      ['usr', `ls ${S}usr${S}bin`],
      ['etc', `cat ${S}etc${S}hosts`],
      ['proc', `cat ${S}proc${S}self${S}environ`],
    ] as Array<[string, string]>) {
      it(label, () => expect(denied(cmd)).toBe(true));
    }
  });

  describe('laundering check — parity with the already-exempt scratchpad tree', () => {
    // The issue asked to confirm nothing security-relevant becomes reachable
    // under /var/folders/ that is not already reachable under
    // /private/tmp/claude-*/, which has been exempt and accepted for releases.
    // Measured: the two are identical on every shape below.
    //
    // ⚠ MY FIRST VERSION OF THIS TEST ASSERTED THE WRONG PROPERTY. It expected a
    // bare `id_rsa` under the exempt tree to stay denied. It does not — and never
    // did on its own merits: the secret patterns require a `.ssh/` component
    // (`/\.ssh\/id_/`), so a bare `id_rsa` in ANY directory is unprotected. It
    // was caught here only incidentally, by the over-broad `/var/` match this
    // change removes. Asserting it would have pinned a guarantee the system has
    // never made, in the file future maintainers trust most.
    const scratch = `${PRIV}${S}tmp${S}claude-501${S}session${S}scratchpad`;
    const shapes: Array<[string, string]> = [
      ['bare id_rsa (unprotected in both)', `${S}id_rsa`],
      ['.ssh-qualified key (denied in both)', `${S}.ssh${S}id_rsa`],
      ['dot-env (denied in both)', `${S}.env`],
      ['credentials.json (unprotected in both)', `${S}credentials.json`],
      ['a .pem (unprotected in both)', `${S}server.pem`],
      ['a .key (denied in both)', `${S}private.key`],
    ];
    for (const [label, tail] of shapes) {
      it(label, () => {
        expect(denied(`cat ${TMP}${tail}`)).toBe(denied(`cat ${scratch}${tail}`));
      });
    }

    it('the shapes that ARE protected stay protected under the new tree', () => {
      expect(denied(`cat ${TMP}${S}.ssh${S}id_rsa`)).toBe(true);
      expect(denied(`cat ${TMP}${S}.env`)).toBe(true);
      expect(denied(`cat ${TMP}${S}private.key`)).toBe(true);
    });

    it('the UNPROTECTED shapes are pinned absolutely, not only by parity', () => {
      // Review finding: a pure parity assertion passes if BOTH sides flip
      // together, so the three "unprotected in both" labels were unchecked
      // claims. Pinned outright — if any becomes denied, the label is a lie and
      // this fails rather than the row silently still passing.
      expect(denied(`cat ${TMP}${S}id_rsa`)).toBe(false);
      expect(denied(`cat ${TMP}${S}credentials.json`)).toBe(false);
      expect(denied(`cat ${TMP}${S}server.pem`)).toBe(false);
    });

    it('SCOPE, stated precisely: this exemption is NOT uid-bound, the scratchpad one is', () => {
      // Review finding: the six-row parity test varies only the FILENAME with a
      // fixed prefix, so it structurally cannot detect a difference in tree
      // scope — and there is one. Recorded here so the claim is bounded by a
      // test rather than by a docstring sentence.
      expect(denied(`cat ${PRIV}${S}tmp${S}notclaude${S}f`)).toBe(true); // scratchpad: uid-bound
      expect(denied(`cat ${PRIV}${S}tmp${S}claude-501${S}f`)).toBe(false);
      expect(denied(`cat ${VAR}folders${S}ZZ${S}anyuser${S}T${S}f`)).toBe(false); // ours: whole tree
    });
  });

  describe('write path (#113 review) — Write/Edit must agree with Bash', () => {
    // The original fix touched only the Bash matcher, so Write/Edit to a temp
    // file stayed denied while `bash -c` to the same file was allowed — the
    // issue's own motivation half solved. Both spellings need their own entry
    // there because those patterns are ANCHORED, unlike the Bash ones.
    const prot = (p: string) => isProtectedPath(p).isProtected;

    it('temp file is writable, short spelling', () => {
      expect(prot(`${VAR}folders${S}9x${S}t2k_5s${S}T${S}out.txt`)).toBe(false);
    });
    it('temp file is writable, private spelling', () => {
      expect(prot(`${PRIV}${VAR}folders${S}9x${S}t2k_5s${S}T${S}out.txt`)).toBe(false);
    });
    it('genuine system paths still protected, both spellings', () => {
      expect(prot(`${VAR}log${S}system.log`)).toBe(true);
      expect(prot(`${PRIV}${VAR}log${S}system.log`)).toBe(true);
      expect(prot(`${VAR}root${S}x`)).toBe(true);
    });
    it('traversal needs NO guard here — the path is resolved before matching', () => {
      // The asymmetry with the Bash path, pinned: normalizePath/resolveRealPath
      // run first, so `..` is gone before any pattern is applied.
      expect(prot(`${VAR}folders${S}9x${S}T${S}..${S}..${S}..${S}log${S}system.log`)).toBe(true);
    });

    it('the real home ssh directory is untouched by this change', () => {
      expect(denied(`cat ~${S}.ssh${S}id_rsa`)).toBe(true);
    });
  });

  it('whichRuleFires: the PARTIAL guard denies contiguous traversal, not the lookahead', () => {
    // ⚠ REWRITTEN after review. The first version declared local copies of both
    // regexes and asserted about those, so it proved regex semantics rather than
    // anything about the shipped code. It is now coupled through the pattern
    // SOURCE the live matcher reports, so replacing the guard with any other
    // rule fails here.
    const escapeCmd = `cat ${TMP}${S}..${S}..${S}..${S}..${S}log${S}system.log`;
    const hit = matchesBashSensitivePattern(escapeCmd);

    expect(hit.matched).toBe(true);
    expect(hit.pattern).toBe(TRAVERSAL_GUARD.source);
    // and it is genuinely NOT the narrowing that catches it
    expect(NARROWED.source).not.toBe(hit.pattern);
    expect(new RegExp(NARROWED.source).test(escapeCmd)).toBe(false);
  });

  it('MUST-FAIL CONTROL: derived from the EXPORTED array, not a local copy', () => {
    // ⚠ REWRITTEN after review. The first version compared two regex literals
    // declared three lines above it — reverting the entire source fix left it
    // green. It pinned nothing while being named as the thing that pinned
    // everything. Both regexes now come from BASH_SYSTEM_DIR_PATTERNS itself.
    const sources = BASH_SYSTEM_DIR_PATTERNS.map((r) => r.source);

    // The bare pre-fix pattern must be GONE from the shipped array.
    expect(sources).not.toContain('\\/var\\/');
    // The narrowed one and the guard must both be present.
    expect(sources).toContain(NARROWED.source);
    expect(sources).toContain(TRAVERSAL_GUARD.source);
    // And the live matcher must reflect it.
    expect(denied(`sh ${TMP}${S}install.sh`)).toBe(false);
    expect(denied(`rm ${VAR}log${S}system.log`)).toBe(true);
  });

  describe('KNOWN GAPS — the guard is partial, and these are the measured limits', () => {
    // Every row below was DENY before the #99 narrowing and is ALLOW after.
    // They are pinned as `false` deliberately: this is a documented trade, not a
    // passing grade. If a future change makes one of them deny again, this test
    // fails and the comment in security-blocker.ts must be updated to match.
    //
    // Found by adversarial review (PR #113). The original claim was that the
    // companion guard "closes" the traversal bypass. It does not — `\S*` cannot
    // cross whitespace, and the `..` must be followed by `/`, whitespace or end.
    const gaps: Array<[string, string]> = [
      ['space inside the path', `cat "${TMP}${S}my dir${S}..${S}..${S}..${S}log${S}system.log"`],
      ['quoted .. segments', `cat ${TMP}${S}'..'${S}'..'${S}'..'${S}log${S}system.log`],
      ['.. followed by a quote', `cat "${TMP}${S}.."`],
      ['cd then relative traversal', `cd ${TMP} && cat ..${S}..${S}..${S}log${S}system.log`],
      ['traversal via a variable', `d=${TMP}; cat $d${S}..${S}..${S}..${S}log${S}system.log`],
    ];
    for (const [label, cmd] of gaps) {
      it(`NOT blocked: ${label}`, () => expect(denied(cmd)).toBe(false));
    }

    it('what still bounds the exposure: secret patterns run first, independently', () => {
      // These are why the gaps above are a bounded trade rather than an opening.
      expect(denied(`cat "${TMP}${S}my dir${S}..${S}..${S}.ssh${S}id_rsa"`)).toBe(true);
      expect(denied(`cat "${TMP}${S}my dir${S}..${S}..${S}.env"`)).toBe(true);
    });
  });
});
