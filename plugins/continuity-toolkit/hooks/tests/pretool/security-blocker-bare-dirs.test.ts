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
const L = '(?<![\\w.-])';
const R = '(?![\\w\\-/])';
const BARE = (src: string, arr: readonly RegExp[]) => arr.find((r) => r.source === src);
const BARE_ETC = BARE(`${L}\\/etc${R}`, BASH_SYSTEM_DIR_PATTERNS);
const BARE_VAR = BARE(`${L}\\/var${R}`, BASH_SYSTEM_DIR_PATTERNS);
const QUALIFIED_ETC = BARE('\\/etc\\/', BASH_SYSTEM_DIR_PATTERNS);
const BARE_SSH = BARE(`${L}\\.ssh${R}`, BASH_SECRET_PATTERNS);
if (!BARE_ETC || !BARE_VAR || !QUALIFIED_ETC || !BARE_SSH) {
  throw new Error('#114 bare-name patterns missing from the shipped arrays — the fix was reverted');
}
// ⚠ These lookups are EXACT on `.source`, deliberately. A semantically
// identical rewrite (`(?![-\w/])`) will trip the throw above and read as "the
// fix was reverted". That is the intended trade: a tripwire that occasionally
// cries wolf beats a control that silently stops pinning anything. It already
// earned this — it fired during development when a candidate changed a
// pattern's spelling, which is what forced the additive design.

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
      // Review finding: three of the six new system rules had NO test at all.
      // Deleting them left the whole suite green.
      ['bare sys', `ls ${S}sys`],
      ['bare proc', `ls ${S}proc`],
      ['bare boot', `ls ${S}boot`],
      ['cd sys then relative', `cd ${S}sys && cat kernel${S}hostname`],
      ['cd boot then relative', `cd ${S}boot && ls`],
    ];
    for (const [label, cmd] of cases) {
      it(`net DENY: ${label}`, async () => {
        expect(await net(cmd)).toBe('DENY');
      });
    }
  });

  describe('KNOWN GAPS — the bare spelling is closed, the class is not', () => {
    // Pinned as `false` deliberately, the same convention the #99 block uses:
    // a documented trade, not a passing grade. Both need a shell parse.
    it('NOT blocked: cd to the root, then a relative path', async () => {
      // No protected literal appears in this command at all.
      expect(await net(`cd ${S} && cat etc${S}passwd`)).toBe('AUTO-APPROVED');
    });
    it('NOT blocked: tilde-user expansion', async () => {
      expect(await net('cd ~root && cat k')).toBe('AUTO-APPROVED');
    });
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

    it('ATTRIBUTION: the /etc rows are carried by the SYSTEM rule, not a secret rule', () => {
      // Review finding: these three sit under a "secrets" heading but the
      // pattern that actually fires is the bare system-dir rule — deleting the
      // /etc account-file secret pattern outright left them green, so as
      // written they were three restatements of one rule. Attribution is now
      // asserted, so the heading can no longer over-claim.
      for (const f of ['shadow', 'passwd', 'sudoers']) {
        expect(matchesBashSensitivePattern(`cd ${ETC} && cat ${f}`).pattern).toBe(BARE_ETC.source);
      }
      // …and these three ARE carried by their own new secret rules.
      expect(matchesBashSensitivePattern(`cd ~${S}${SSH} && cat id_rsa`).pattern).toBe(
        BARE_SSH.source
      );
      expect(matchesBashSensitivePattern(`cd ${S}root && cat k`).pattern).toContain('root');
      expect(matchesBashSensitivePattern(`cd ${S}run${S}secrets && cat t`).pattern).toContain(
        'secrets'
      );
    });

    it('the trailing-separator escape is closed (#114 review)', async () => {
      // One extra character defeated the bare rule: it declines on `/`, and the
      // two qualified ssh rules are narrower than the directory (`id_` prefix,
      // `.pem` suffix). All of these were AUTO-APPROVED before the blanket rule.
      expect(await net(`cd ~${S}${SSH}${S} && cat id_rsa`)).toBe('DENY');
      expect(await net(`ls ~${S}${SSH}${S}`)).toBe('DENY');
      expect(await net(`cat ~${S}${SSH}${S}authorized_keys`)).toBe('DENY');
      expect(await net(`cat ~${S}${SSH}${S}known_hosts`)).toBe('DENY');
    });

    it('the private trees carry the same defect and are closed too (#114 review)', async () => {
      expect(await net(`ls ${S}private${S}tmp`)).toBe('DENY');
      expect(await net(`cd ${S}private${S}tmp && cat f`)).toBe('DENY');
      expect(await net(`ls ${S}private${S}home`)).toBe('DENY');
      // …while the scratchpad exemption underneath it is untouched.
      expect(denied(`ls ${S}private${S}tmp${S}claude-501${S}s${S}scratchpad`)).toBe(false);
    });

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

  describe('non-regression, SUFFIX axis: the name continues into a longer name', () => {
    // Bounded by the RIGHT lookahead. Each of these fails if it is removed.
    const allowed: Array<[string, string]> = [
      ['etcetera is not etc', `ls ${S}etcetera`],
      ['a hyphenated sibling', `ls ${S}etc-backup`],
      ['variables is not var', `ls ${S}variables`],
      ['usrlocal is not usr', `ls ${S}usrlocal`],
      ['sshd is not the ssh dir', 'cat config.sshd'],
      ['rootfs is not root', `ls ${S}rootfs`],
      ['system is not sys', `ls ${S}system`],
      ['procedures is not proc', `ls ${S}procedures`],
      ['bootstrap is not boot', `ls ${S}bootstrap`],
    ];
    for (const [label, cmd] of allowed) {
      it(`still allowed: ${label}`, () => expect(denied(cmd)).toBe(false));
    }
  });

  describe('non-regression, PREFIX axis: the name is the tail of a RELATIVE path', () => {
    // ⚠ THIS BLOCK EXISTS BECAUSE ITS ABSENCE SHIPPED A BLOCKER. The first
    // version of this fix had no LEFT lookbehind, so every one of these was
    // DENIED — `config/boot.rb` is in every Rails app and `app/root.tsx` in
    // every Remix app, and a denial is terminal for a subagent. The suffix
    // block above passed the whole time: it varies the FAILURE MODE but never
    // the TARGET, so it structurally could not detect this.
    //
    // Found by adversarial review, not by the 31-entry FP corpus — every corpus
    // entry uses an ABSOLUTE path, so the corpus has zero overlap with this
    // false-positive surface and `fp=0` was measuring the wrong thing.
    const allowed: Array<[string, string]> = [
      ['rails boot file', `cat config${S}boot.rb`],
      ['remix root route', `cat app${S}root.tsx`],
      ['a rust module', `cat src${S}proc.rs`],
      ['a go package', `cat pkg${S}usr.go`],
      ['a ts module', `cat lib${S}sys.ts`],
      ['dot-relative dir', `du -sh .${S}var`],
      ['dot-relative dir, flagged', `ls -la .${S}etc`],
      ['nested project dir', `ls app${S}etc`],
      ['a dotted sibling', 'cat build.var'],
    ];
    for (const [label, cmd] of allowed) {
      it(`still allowed: ${label}`, () => expect(denied(cmd)).toBe(false));
    }

    it('MUTATION CONTROL: dropping the left lookbehind denies these', () => {
      // Proves the block discriminates rather than passing vacuously. Derived
      // from the SHIPPED rule by stripping exactly the lookbehind under test.
      const crippled = new RegExp(BARE_ETC.source.replace('(?<![\\w.-])', ''));
      expect(crippled.test(`ls -la .${S}etc`)).toBe(true); // would deny
      expect(new RegExp(BARE_ETC.source).test(`ls -la .${S}etc`)).toBe(false); // does not
    });
  });
});
