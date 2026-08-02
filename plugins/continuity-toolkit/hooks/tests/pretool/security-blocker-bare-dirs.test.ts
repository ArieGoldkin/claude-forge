/**
 * Bare system-directory and secret-directory names (#114).
 *
 * Every pattern in BASH_SYSTEM_DIR_PATTERNS and the directory-qualified half of
 * BASH_SECRET_PATTERNS required a TRAILING SEPARATOR, so a bare name was
 * unmatched and `auto-approve-safe-bash` then approved the command with no
 * prompt. `ls <etc>` and `cd <etc> && cat passwd` were both AUTO-APPROVED,
 * measured end to end through `bashCombined`.
 *
 * ⚠ THE `cd` IS INCIDENTAL. The issue framed this as "cd-then-relative"; the
 * defect is the bare reference itself, which is why the fix keys on the name and
 * not on the chaining. A `cd`-shaped fix would have missed `ls <etc>` entirely.
 *
 * ⚠ THE SECRET PATTERNS SPLIT IN TWO, AND ONLY ONE HALF SELF-DEFENDS. This is
 * the claim #114 corrected — see the CORRECTED note in security-blocker.ts.
 *   - SELF-IDENTIFYING (`.env`, `kubeconfig`, `*.key`) match on the filename
 *     alone, so a `cd` cannot separate a name from its own pattern.
 *   - PREFIX-DEPENDENT (`.ssh/id_`, `/etc/shadow`, `/root/`, `/run/secrets/`)
 *     need a directory component, and a `cd` defeats them outright.
 * Measured on 2.17.5: 6 of the 12 below were defeated by a `cd` split.
 *
 * ⚠ THE #99 EXEMPTION IS PROVABLY UNTOUCHED, NOT ASSUMED SO. The bare entries
 * fire only when the name is NOT followed by `/`, so they cannot match any
 * qualified path — and /var/folders/ lives entirely in qualified-path space.
 * The KNOWN GAPS block in security-blocker-macos-temp.test.ts still passes
 * unchanged, which is the evidence for that claim.
 *
 * @module tests/pretool/security-blocker-bare-dirs
 */

import { describe, expect, it } from 'vitest';
import { bashCombined } from '../../src/pretool/bash-combined.js';
import {
  BASH_SECRET_PATTERNS,
  BASH_SYSTEM_DIR_PATTERNS,
  matchesBashSensitivePattern,
} from '../../src/pretool/security-blocker.js';
import type { HookInput } from '../../src/types.js';

/**
 * Pulled from the SHIPPED arrays rather than re-declared. PR #113 shipped a
 * "must-fail control" that compared two regex literals declared three lines
 * above it, so reverting the entire source fix left it green. Failing to find a
 * pattern here is itself the failure.
 */
const BARE = (src: string, arr: readonly RegExp[]) => arr.find((r) => r.source === src);
const BARE_ETC = BARE('\\/etc(?![\\w\\-/])', BASH_SYSTEM_DIR_PATTERNS);
const BARE_VAR = BARE('\\/var(?![\\w\\-/])', BASH_SYSTEM_DIR_PATTERNS);
const QUALIFIED_ETC = BARE('\\/etc\\/', BASH_SYSTEM_DIR_PATTERNS);
const BARE_SSH = BARE('\\.ssh(?![\\w\\-/])', BASH_SECRET_PATTERNS);
if (!BARE_ETC || !BARE_VAR || !QUALIFIED_ETC || !BARE_SSH) {
  throw new Error('#114 bare-name patterns missing from the shipped arrays — the fix was reverted');
}

// Assembled from fragments so this file's own text carries no protected literal.
const S = '/';
const ETC = `${S}etc`;
const VAR = `${S}var`;
const USR = `${S}usr`;
const SSH = '.ssh';
const TMP = `${VAR}${S}folders${S}9x${S}t2k_5s${S}T`;

const denied = (cmd: string) => matchesBashSensitivePattern(cmd).matched;

/** The real wired decision — what the user actually experiences. */
async function net(command: string): Promise<string> {
  const r = await bashCombined({ tool_name: 'Bash', tool_input: { command } } as HookInput);
  const d = r.hookSpecificOutput?.permissionDecision;
  if (r.continue === false || d === 'deny') return 'DENY';
  if (d === 'ask') return 'ASK';
  if (d === 'allow') return 'AUTO-APPROVED';
  return 'defer';
}

describe('#114 bare directory names', () => {
  describe('the reported defect — measured end to end, not just at the matcher', () => {
    const cases: Array<[string, string]> = [
      ['bare dir, no cd at all', `ls ${ETC}`],
      ['cd etc then relative', `cd ${ETC} && cat passwd`],
      ['cd var then relative', `cd ${VAR} && cat log${S}system.log`],
      ['cd usr then relative', `cd ${USR} && cat bin${S}something`],
      ['bare dir in a quote', `cat "${ETC}"`],
      ['bare dir at end of line', `ls -la ${USR}`],
    ];
    for (const [label, cmd] of cases) {
      it(`net DENY: ${label}`, async () => {
        expect(await net(cmd)).toBe('DENY');
      });
    }
  });

  describe('prefix-dependent secrets survive a cd split (the corrected claim)', () => {
    // Each was measured AUTO-APPROVED on 2.17.5. These are the regression
    // guards for the half of BASH_SECRET_PATTERNS that cannot self-defend.
    const split: Array<[string, string]> = [
      ['ssh private key', `cd ~${S}${SSH} && cat id_rsa`],
      ['etc shadow', `cd ${ETC} && cat shadow`],
      ['etc passwd', `cd ${ETC} && cat passwd`],
      ['etc sudoers', `cd ${ETC} && cat sudoers`],
      ['run secrets', `cd ${S}run${S}secrets && cat tok`],
      ['root home', `cd ${S}root && cat k`],
    ];
    for (const [label, cmd] of split) {
      it(`net DENY: ${label}`, async () => {
        expect(await net(cmd)).toBe('DENY');
      });
    }

    it('self-identifying secrets were never affected, and still are not', async () => {
      // Pinned so a future narrowing cannot quietly move one of these into the
      // prefix-dependent class without failing here.
      expect(await net(`cd ${S}srv && cat .env`)).toBe('DENY');
      expect(await net(`cd ${S}srv && cat kubeconfig`)).toBe('DENY');
      expect(await net(`cd ${S}srv && cat server.key`)).toBe('DENY');
    });
  });

  describe('#99 /var/folders exemption is untouched — the coupling, pinned', () => {
    it('the TMPDIR exec case stays allowed (corpus entry M1)', () => {
      expect(denied(`sh ${TMP}${S}install.sh`)).toBe(false);
    });
    it('a qualified temp path stays allowed', () => {
      expect(denied(`cat ${TMP}${S}build.log`)).toBe(false);
    });
    it('genuine /var paths stay denied', () => {
      expect(denied(`rm ${VAR}${S}log${S}system.log`)).toBe(true);
    });
    it('the bare-var rule cannot fire on ANY qualified path, by construction', () => {
      // This is the property that makes the fix additive-safe. Asserted against
      // the shipped rule, not a re-declared copy.
      const rule = new RegExp(BARE_VAR.source);
      expect(rule.test(`${VAR}${S}folders${S}x`)).toBe(false);
      expect(rule.test(`${VAR}${S}log`)).toBe(false);
      expect(rule.test(`cd ${VAR} && ls`)).toBe(true);
    });
  });

  it('MUST-FAIL CONTROL: the bare rule is what fires, and the qualified one does not cover it', () => {
    // Derived from the EXPORTED arrays and asserted through what the live
    // matcher reports. Reverting the fix removes the pattern and trips the
    // module-level throw above; weakening it to the pre-fix shape fails here.
    const hit = matchesBashSensitivePattern(`ls ${ETC}`);
    expect(hit.matched).toBe(true);
    expect(hit.pattern).toBe(BARE_ETC.source);

    // The pre-existing qualified rule genuinely does NOT match the bare form —
    // so this test pins new coverage rather than restating old coverage.
    expect(new RegExp(QUALIFIED_ETC.source).test(`ls ${ETC}`)).toBe(false);

    // And the qualified path is still carried by the ORIGINAL rule, unchanged.
    expect(matchesBashSensitivePattern(`cat ${ETC}${S}hosts`).pattern).toBe(QUALIFIED_ETC.source);
  });

  it('MUST-FAIL CONTROL: the bare ssh rule fires on the split form', () => {
    const hit = matchesBashSensitivePattern(`cd ~${S}${SSH} && cat id_rsa`);
    expect(hit.matched).toBe(true);
    expect(hit.pattern).toBe(BARE_SSH.source);
  });

  describe('non-regression: names that merely CONTAIN a protected dir name', () => {
    // The issue warned that a bare name appears in more benign commands than a
    // qualified path does. The lookahead is what bounds that; these pin it.
    const allowed: Array<[string, string]> = [
      ['etcetera is not etc', `ls ${S}etcetera`],
      ['a hyphenated sibling', `ls ${S}etc-backup`],
      ['user is not usr', `ls ${S}user`],
      ['variables is not var', `ls ${S}variables`],
      ['sshd is not .ssh', 'cat config.sshd'],
      ['rootfs is not root', `ls ${S}rootfs`],
    ];
    for (const [label, cmd] of allowed) {
      it(`still allowed: ${label}`, () => expect(denied(cmd)).toBe(false));
    }
  });
});
