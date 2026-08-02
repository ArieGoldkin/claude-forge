/**
 * Case-insensitive path matching (#116, case half).
 *
 * Every rule in BASH_SECRET_PATTERNS and BASH_SYSTEM_DIR_PATTERNS was
 * case-sensitive. The default macOS volume is case-insensitive, so `/ETC/passwd`
 * and `~/.SSH/id_rsa` reach the same inodes as their lowercase spellings and
 * were net AUTO-APPROVED — measured through `bashCombined`, not hypothesised.
 *
 * ⚠ THIS FILE PINS THE `i` FLAG, WHICH `.source` CANNOT SEE. The #114 tripwire
 * in security-blocker-bare-dirs.test.ts looks patterns up by `.source`, and
 * `/x/i.source === '/x'` — flags are not part of it. That tripwire therefore
 * stays GREEN on a complete revert of this fix. The flag assertions below are
 * the must-fail control: strip the `i` from any rule named here and this file
 * goes red. Ledger lesson — PR #113 shipped a control that passed on a full
 * revert of the fix it was named for.
 *
 * ⚠ THE SCOPE IS THE CASE HALF ONLY. Issue #116 reports three classes; glob and
 * quote/brace splitting are untouched and stay pinned `false` below. #116 stays
 * OPEN — do not write a closing keyword for it.
 *
 * ⚠ FOUR RULES DELIBERATELY LACK `i`, EACH FOR A MEASURED FALSE POSITIVE.
 * `.env`/`.envrc` (docker's `{{.Config.Env}}`), the `*.key|keytab|…` family
 * (`item.Key`), `kubeconfig` (`export KUBECONFIG=…`), and `/root` (Tomcat's
 * `webapps/ROOT/`, where `i` also buys nothing — see the CASE RULE block in
 * security-blocker.ts). The FALSE POSITIVES describe block below is what stops
 * a later reader "fixing" that inconsistency.
 *
 * @module tests/pretool/security-blocker-case
 */

import { describe, expect, it } from 'vitest';
import { bashCombined } from '../../src/pretool/bash-combined.js';
import {
  BASH_SECRET_PATTERNS,
  BASH_SYSTEM_DIR_PATTERNS,
} from '../../src/pretool/security-blocker.js';
import type { HookInput } from '../../src/types.js';

// Assembled from fragments so this file's own text carries no protected
// literal. ⚠ THE LABELS COUNT TOO — a review agent died on literals inside its
// own test-case labels during PR #115, so the labels below stay generic.
const S = '/';
const lo = { etc: 'etc', usr: 'usr', vr: 'var', root: 'root', ssh: '.ssh' };
const up = { etc: 'ETC', usr: 'USR', vr: 'VAR', root: 'ROOT', ssh: '.SSH' };
const PW = 'pass' + 'wd';
const KC = 'kube' + 'config';
const ENVF = '.' + 'env';

const ALL = [...BASH_SECRET_PATTERNS, ...BASH_SYSTEM_DIR_PATTERNS];
const bySource = (src: string) => ALL.find((r) => r.source === src);

/** The real wired decision — what the user actually experiences. */
async function net(command: string): Promise<string> {
  const r = await bashCombined({ tool_name: 'Bash', tool_input: { command } } as HookInput);
  const d = r.hookSpecificOutput?.permissionDecision;
  if (r.continue === false || d === 'deny') return 'DENY';
  if (d === 'ask') return 'ASK';
  if (d === 'allow') return 'AUTO-APPROVED';
  return 'defer';
}

describe('#116 case-insensitive path rules', () => {
  describe('flag integrity — the must-fail control', () => {
    // Pulled from the SHIPPED arrays by `.source`, then asserted on `.flags`.
    // Looking a rule up and finding nothing is itself a failure: it means the
    // rule was renamed or deleted, and an assertion on `undefined?.flags` would
    // otherwise pass vacuously.
    const MUST_BE_INSENSITIVE: Array<[string, string]> = [
      ['qualified system dir A', `\\${S}${lo.etc}\\${S}`],
      ['qualified system dir B', `\\${S}${lo.usr}\\${S}`],
      ['qualified system dir C', `\\${S}${lo.vr}\\${S}(?!folders\\${S})`],
      ['bare system dir A', `(?<![\\w.-])\\${S}${lo.etc}(?![\\w\\-${S}])`],
      ['bare system dir B', `(?<![\\w.-])\\${S}${lo.vr}(?![\\w\\-${S}])`],
      ['account-file rule', `\\${S}${lo.etc}\\${S}(?:${PW}|shadow|sudoers|gshadow|master\\.${PW})\\b`],
      ['secret dir qualified', `(?<![\\w.-])\\${lo.ssh}\\${S}`],
      ['secret dir bare', `(?<![\\w.-])\\${lo.ssh}(?![\\w\\-${S}])`],
      ['key-prefix rule', `\\${lo.ssh}\\${S}id_`],
    ];

    for (const [label, src] of MUST_BE_INSENSITIVE) {
      it(`carries the i flag: ${label}`, () => {
        const rule = bySource(src);
        expect(rule, `rule missing from the shipped arrays — renamed or reverted: ${src}`).toBeDefined();
        expect(rule?.flags).toContain('i');
      });
    }

    // The other half of the control. These four must STAY case-sensitive; each
    // has a measured false positive behind it. Asserting their absence is what
    // makes the block above non-tautological — otherwise "add i everywhere"
    // would satisfy every assertion in this file.
    const MUST_STAY_SENSITIVE: Array<[string, string]> = [
      ['identifier rule: env file', `(?<![\\w.-])(?!process\\${ENVF}\\b)(?!import\\.meta\\${ENVF}\\b)[\\w.-]*\\${ENVF}\\b`],
      ['identifier rule: key family', `[\\w-]+\\.(?:key|keytab|p12|pfx|jks)\\b(?![\\w(.])`],
      ['identifier rule: cluster config', `\\b${KC}\\b`],
      ['identifier rule: superuser home', `\\${S}${lo.root}\\${S}`],
    ];

    for (const [label, src] of MUST_STAY_SENSITIVE) {
      it(`stays case-sensitive: ${label}`, () => {
        const rule = bySource(src);
        expect(rule, `rule missing from the shipped arrays — renamed or reverted: ${src}`).toBeDefined();
        expect(rule?.flags).not.toContain('i');
      });
    }
  });

  describe('the reported defect — measured end to end, not just at the matcher', () => {
    const cases: Array<[string, string]> = [
      ['upper bare dir', `ls ${S}${up.etc}`],
      ['upper qualified account file', `cat ${S}${up.etc}${S}${PW}`],
      ['mixed-case qualified account file', `cat ${S}Etc${S}${PW}`],
      ['upper secret dir, wildcard operand', `cat ~${S}${up.ssh}${S}*`],
      ['upper secret dir, split by cd', `cd ~${S}${up.ssh} && cat id_rsa`],
      ['upper bare dir, second name', `ls ${S}${up.usr}`],
      // Load-bearing for the /root exclusion: root's real macOS home is under
      // the /var tree, so the case-insensitive /var rule must cover it.
      ['upper superuser home via var tree', `cat ${S}${up.vr}${S}${up.root}${S}${up.ssh}${S}id_rsa`],
    ];
    for (const [label, cmd] of cases) {
      it(`net DENY: ${label}`, async () => {
        expect(await net(cmd)).toBe('DENY');
      });
    }
  });

  describe('lowercase controls — unchanged by this fix', () => {
    const cases: Array<[string, string]> = [
      ['lower qualified account file', `cat ${S}${lo.etc}${S}${PW}`],
      ['lower bare dir', `ls ${S}${lo.etc}`],
      ['lower secret dir, split by cd', `cd ~${S}${lo.ssh} && cat id_rsa`],
      ['backslash-escaped form', `cat ${S}e\\tc${S}${PW}`],
    ];
    for (const [label, cmd] of cases) {
      it(`net DENY: ${label}`, async () => {
        expect(await net(cmd)).toBe('DENY');
      });
    }
  });

  describe('FALSE POSITIVES the four exclusions exist to prevent', () => {
    // ⚠ EACH ROW VARIES THE TARGET, NOT JUST THE FAILURE MODE. Four different
    // protected names are involved, so a single over-broad rule cannot pass all
    // four. Ledger lesson from PR #115: negative controls that vary only the
    // suffix cannot see a missing boundary, and one such row could never fail
    // under ANY mutation.
    const cases: Array<[string, string]> = [
      ['container inspect template field', `docker inspect -f '{{.Config.${'Env'}}}' web`],
      ['dictionary property access', `wc -l item.${'Key'}`],
      ['cluster config env var', `export ${KC.toUpperCase()}=${S}tmp${S}kc.yaml`],
      ['servlet container default webapp', `cat webapps${S}${up.root}${S}index.jsp`],
      // The #115 blocker class — relative paths whose last segment is a
      // protected name. Denying these is strictly worse than the hole.
      ['relative path, framework config', `cat config${S}boot.rb`],
      ['relative path, framework entry', `cat app${S}root.tsx`],
      ['relative upper name, no leading slash', `ls .${S}${up.etc}`],
    ];
    for (const [label, cmd] of cases) {
      it(`NOT denied: ${label}`, async () => {
        expect(await net(cmd)).not.toBe('DENY');
      });
    }
  });

  describe('#99 exemption survives in BOTH spellings', () => {
    // The `i` case-folds the negative lookahead too. That is the correct
    // behaviour rather than a widening — on a case-insensitive volume the two
    // spellings are one directory — but it is asserted, not assumed.
    it('NOT denied: per-user temp tree, lower', async () => {
      expect(await net(`ls ${S}${lo.vr}${S}folders${S}9x${S}t2k${S}T`)).not.toBe('DENY');
    });
    it('NOT denied: per-user temp tree, upper', async () => {
      expect(await net(`ls ${S}${up.vr}${S}FOLDERS${S}9x${S}t2k${S}T`)).not.toBe('DENY');
    });
  });

  describe('KNOWN GAPS — the case class is closed, #116 is NOT', () => {
    // Pinned as their measured value deliberately, the same convention the #99
    // and #114 blocks use: a documented trade, not a passing grade. Glob and
    // quote/brace splitting are the remaining halves of #116; the env-file case
    // gap is the price of not denying the container-inspect idiom above.
    const gaps: Array<[string, string]> = [
      ['wildcard operand reaches the key dir', `cat ~${S}.s*h${S}*`],
      ['wildcard operand reaches a system dir', `ls ${S}e*c`],
      ['single-char wildcard', `cat ${S}et?${S}${PW}`],
      ['adjacent quoted strings concatenate', `cat "${S}e""tc${S}${PW}"`],
      ['brace expansion', `cat ${S}{e,}tc${S}${PW}`],
      ['upper env-file spelling', `cat .${'ENV'}`],
    ];
    for (const [label, cmd] of gaps) {
      it(`NOT blocked (tracked in #116): ${label}`, async () => {
        expect(await net(cmd)).not.toBe('DENY');
      });
    }
  });
});
