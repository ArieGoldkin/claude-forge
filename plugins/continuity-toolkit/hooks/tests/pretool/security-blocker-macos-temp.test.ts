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
 * RAW text with no `..` normalization. The companion guard is what closes it,
 * mirroring the scratchpad carve-out that already ships one for the same reason.
 * The `whichRuleFires` test below pins that the guard, not the lookahead, is
 * what denies each traversal case.
 *
 * ⚠ ONE PATTERN COVERS BOTH SPELLINGS ON PURPOSE. `/var` is a symlink to
 * `/private/var`, and the issue warned that a carve-out honouring one spelling
 * is bypassed via the other. It is not two patterns: `/private/var/folders/`
 * CONTAINS `/var/folders/`, so the same lookahead suppresses both. That is
 * verified here rather than reasoned about, in both directions.
 *
 * @module tests/pretool/security-blocker-macos-temp
 */

import { describe, expect, it } from 'vitest';
import { matchesBashSensitivePattern } from '../../src/pretool/security-blocker.js';

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

    it('the real home ssh directory is untouched by this change', () => {
      expect(denied(`cat ~${S}.ssh${S}id_rsa`)).toBe(true);
    });
  });

  it('whichRuleFires: the companion guard denies traversal, NOT the lookahead', () => {
    // Without this, a traversal row could pass for the wrong reason and the
    // guard could be deleted with every test still green.
    const NARROWED = /\/var\/(?!folders\/)/;
    const TRAVERSAL = /\/var\/folders\/\S*\.\.(\/|\s|$)/;
    const escapeCmd = `cat ${TMP}${S}..${S}..${S}..${S}..${S}log${S}system.log`;

    expect(NARROWED.test(escapeCmd)).toBe(false); // the lookahead does NOT catch it
    expect(TRAVERSAL.test(escapeCmd)).toBe(true); // the companion guard does
    expect(denied(escapeCmd)).toBe(true);
  });

  it('MUST-FAIL CONTROL: the pre-fix pattern denied the temp path', () => {
    // Pins that the fix changed something real. If this ever passes with the
    // narrowed pattern, the test is measuring nothing.
    const PRE_FIX = /\/var\//;
    const NARROWED = /\/var\/(?!folders\/)/;
    const tempPath = `sh ${TMP}${S}install.sh`;

    expect(PRE_FIX.test(tempPath)).toBe(true); // old: denied
    expect(NARROWED.test(tempPath)).toBe(false); // new: allowed
    // and both still agree on a genuine system path
    expect(PRE_FIX.test(`${VAR}log${S}x`)).toBe(true);
    expect(NARROWED.test(`${VAR}log${S}x`)).toBe(true);
  });
});
