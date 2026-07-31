/**
 * Scannable projection of a bash command (#65).
 *
 * `security-blocker` matches the TEXT of a command, not the resource it
 * resolves to, so a command that merely *mentions* a protected name is denied
 * even when it touches nothing. Measured: 11 false positives on a 23-entry
 * corpus, every one on the sensitive-path check.
 *
 * WHAT THIS DOES. It does not change a single pattern. It changes *where the
 * patterns are allowed to look*: provably-inert regions are replaced by spaces,
 * and the existing pattern set then runs unchanged over what remains.
 *
 * WHY THIS SHAPE AND NOT THE TWO THAT WERE DEMOLISHED. Two earlier attempts to
 * reduce over-blocking were rejected by adversarial review: a blocklist of
 * mutating verbs (every writer outside the list got through) and an allowlist of
 * safe readers (leaked via a pipe-then-absolute-path segment split, and via
 * command substitution). Both *granted permission* on a positive match, so a
 * parsing miss ALLOWED a dangerous command.
 *
 * This inverts that. Text is removed from the scan only on positive proof of
 * inertness, and the parser's failure mode is to leave text scannable rather
 * than to grant permission.
 *
 * PRECISELY WHAT FAIL-CLOSED MEANS HERE — the earlier wording ("every ambiguity
 * blanks nothing … cannot under-block") was too strong and was refuted in
 * review. Ambiguity is handled at TWO different scopes:
 *   - WHOLE COMMAND: unbalanced quotes, a pipe bound to a `{…}`/`(…)` group, or
 *     any thrown error ⇒ the raw command is returned, blanked nowhere.
 *   - PER SEGMENT: command substitution, a redirect, or piped stdout ⇒ that
 *     segment is skipped. OTHER segments keep whatever they legitimately
 *     blanked, so the result is a partial projection, not the raw command.
 * The security property is per-region, not global: each blanked region must be
 * independently proved inert. "Cannot under-block" is not a property this
 * module has — three real false negatives were found in review (an interpreter
 * heredoc, a `grep -f` pattern FILE, a group-bound pipe). What it does have is
 * that no single parsing miss silently grants permission to a whole command.
 *
 * NOT INERT, EVER:
 * - argv[0] — pinned tests require denial when the literal is the command
 *   itself with no operand (`/usr/bin/printenv`). This is why the rule is
 *   "text except in inert positions" and NOT "operands instead of text".
 * - quoting alone — `cat "/etc/passwd"` is a real read. Inertness is a property
 *   of the command + slot, never of the quotes.
 *
 * @module lib/shell-projection
 */

/** Commands whose every operand is inert: they never open a path. */
const ECHO_LIKE: ReadonlySet<string> = new Set(['echo', 'printf']);

/** Commands whose FIRST non-flag operand is a search pattern, not a path. */
const GREP_LIKE: ReadonlySet<string> = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag']);

/** Flags that take a search pattern as their next argument. */
const GREP_PATTERN_FLAGS: ReadonlySet<string> = new Set(['-e', '--regexp']);

interface Word {
  text: string;
  start: number;
  end: number;
}

interface SegmentScan {
  words: Word[];
  hasSubstitution: boolean;
  hasRedirect: boolean;
  commentStart: number;
  balanced: boolean;
}

/** Blank [start, end) in place. Length is preserved so offsets stay valid and
 *  blanking can never fuse two neighbouring tokens into a new match. */
function blank(chars: string[], start: number, end: number): void {
  for (let i = start; i < end && i < chars.length; i++) {
    chars[i] = ' ';
  }
}

/**
 * Allowlist key for argv[0]. A PATH-QUALIFIED command is never allowlisted.
 *
 * A basename match was the first implementation and it was wrong: `./echo` and
 * `/tmp/evil/echo` both basename to `echo`, so an attacker-controlled binary
 * inherited echo's inert-operand rule and `./echo /etc/shadow` was allowed.
 * Only a bare command name — resolved through PATH, not chosen by the caller —
 * qualifies. `/bin/echo` is therefore not allowlisted either; that over-blocks,
 * which is the safe direction.
 */
function commandKey(token: string): string {
  return token.includes('/') ? '' : token;
}

/**
 * Commands that consume a heredoc as DATA rather than as a program.
 *
 * An allowlist, not a blocklist of interpreters. A quoted delimiter proves the
 * body is not EXPANDED; it does NOT prove the body is not EXECUTED —
 * `sh <<'EOF' … EOF` runs every line of it. The first implementation blanked
 * those bodies and let `sh <<'EOF'\ncat /etc/shadow\nEOF` through, a false
 * negative this hook exists to prevent. A blocklist of interpreters would leak
 * the same way the demolished mutating-verb blocklist did (perl, ruby, awk, a
 * local wrapper script, …), so only known data-consumers qualify.
 */
const HEREDOC_DATA_CONSUMERS: ReadonlySet<string> = new Set(['cat', 'tee']);

/**
 * Blank the bodies of heredocs whose delimiter is QUOTED (`<<'EOF'`) AND whose
 * consuming command treats the body as data.
 *
 * An UNQUOTED `<<EOF` permits `$(…)` and is deliberately left alone.
 */
function blankQuotedHeredocs(command: string): string {
  const chars = command.split('');
  const lines: { start: number; end: number; text: string }[] = [];
  let pos = 0;
  for (const text of command.split('\n')) {
    lines.push({ start: pos, end: pos + text.length, text });
    pos += text.length + 1;
  }
  const lineIndexOf = (p: number): number => {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l && p >= l.start && p <= l.end) return i;
    }
    return -1;
  };

  // QUOTE-AWARE scan. A regex over raw line text is not enough: `<<'Z'` sitting
  // inside a quoted ARGUMENT is not a heredoc operator, and honouring it blanks
  // the following line — which is a separate, real command. Measured:
  // `tee f.txt "<<'Z'"\ncat /etc/shadow\nZ` was allowed.
  const opRe = /^<<-?[ \t]*(?:'([^']+)'|"([^"]+)")/;
  let single = false;
  let double = false;
  let i = 0;

  while (i < command.length) {
    const c = command[i];
    if (c === '\\' && !single) {
      i += 2;
      continue;
    }
    if (c === "'" && !double) {
      single = !single;
      i++;
      continue;
    }
    if (c === '"' && !single) {
      double = !double;
      i++;
      continue;
    }
    if (single || double || c !== '<' || command[i + 1] !== '<') {
      i++;
      continue;
    }

    const m = opRe.exec(command.slice(i));
    if (!m) {
      i++;
      continue;
    }
    const delim = m[1] ?? m[2];
    const li = lineIndexOf(i);
    if (!delim || li === -1) {
      i++;
      continue;
    }

    let termLine = lines.length;
    for (let j = li + 1; j < lines.length; j++) {
      if (lines[j]?.text.trim() === delim) {
        termLine = j;
        break;
      }
    }

    // The body is inert only if the command reading it treats it as DATA.
    // `sh`/`bash`/`python` EXECUTE it; anything not positively known to be a
    // data consumer keeps its body scannable.
    const firstToken = (lines[li]?.text ?? '').trim().split(/\s+/)[0] ?? '';
    if (HEREDOC_DATA_CONSUMERS.has(commandKey(firstToken))) {
      for (let j = li + 1; j < termLine && j < lines.length; j++) {
        const line = lines[j];
        if (line) blank(chars, line.start, line.end);
      }
    }

    // Skip past the body whether or not it was blanked: a heredoc body is not
    // shell-parsed, so an apostrophe inside it must not desync quote tracking.
    const term = lines[termLine];
    i = Math.max(i + m[0].length, term ? term.end : command.length);
  }

  return chars.join('');
}

interface Segment {
  start: number;
  end: number;
  /** stdout feeds another command via `|`. Nothing in such a segment is inert. */
  pipedOut: boolean;
}

/**
 * Split on segment separators (`;` `|` `&&` `||` newline) outside quotes,
 * recording for each whether its stdout is piped onward.
 *
 * `|` and `||` must be distinguished: a pipe carries this segment's output into
 * the next command's ARGUMENTS (via `xargs`), which is what makes an otherwise
 * inert region live. `||` is control flow and carries nothing. Same for `&`/`&&`.
 *
 * Returns null when quoting is unbalanced — the caller then blanks nothing.
 */
function splitSegments(command: string): Segment[] | null {
  const segments: Segment[] = [];
  let segStart = 0;
  let single = false;
  let double = false;

  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === '\\' && !single) {
      i++;
      continue;
    }
    if (c === "'" && !double) {
      single = !single;
      continue;
    }
    if (c === '"' && !single) {
      double = !double;
      continue;
    }
    if (single || double) continue;

    if (c === '|') {
      const isOr = command[i + 1] === '|';
      segments.push({ start: segStart, end: i, pipedOut: !isOr });
      if (isOr) i++;
      segStart = i + 1;
      continue;
    }
    if (c === '&') {
      const isAnd = command[i + 1] === '&';
      segments.push({ start: segStart, end: i, pipedOut: false });
      if (isAnd) i++;
      segStart = i + 1;
      continue;
    }
    if (c === ';' || c === '\n') {
      segments.push({ start: segStart, end: i, pipedOut: false });
      segStart = i + 1;
    }
  }
  if (single || double) return null;
  segments.push({ start: segStart, end: command.length, pipedOut: false });
  return segments;
}

/** True when the command contains a real pipe (`|`, not `||`) outside quotes. */
function hasRealPipe(command: string): boolean {
  const segs = splitSegments(command);
  return segs === null ? true : segs.some((s) => s.pipedOut);
}

/**
 * True when a pipe could bind to a GROUP rather than to the segment we are
 * looking at.
 *
 * `{ true; echo /etc/hosts; } | xargs rm -f` really does delete the file, but
 * the `|` terminates the `}` segment, not the `echo` segment — so per-segment
 * `pipedOut` says false for the echo and its operands were blanked, reopening
 * the exact `xargs` class the pinned suite protects. Tracking which segments a
 * group encloses is more shell parsing than this module should attempt, so when
 * grouping and a real pipe appear together nothing is blanked at all.
 */
function hasGroupedPipe(command: string): boolean {
  if (!hasRealPipe(command)) return false;
  let single = false;
  let double = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === '\\' && !single) {
      i++;
      continue;
    }
    if (c === "'" && !double) single = !single;
    else if (c === '"' && !single) double = !double;
    else if (!single && !double && (c === '{' || c === '}' || c === '(' || c === ')')) return true;
  }
  return false;
}

/** Tokenize one segment, recording the facts that decide whether it is skipped. */
function scanSegment(command: string, start: number, end: number): SegmentScan {
  const words: Word[] = [];
  let single = false;
  let double = false;
  let hasSubstitution = false;
  let hasRedirect = false;
  let commentStart = -1;
  let wordStart = -1;
  let wordText = '';

  const flush = (i: number): void => {
    if (wordStart !== -1) {
      words.push({ text: wordText, start: wordStart, end: i });
      wordStart = -1;
      wordText = '';
    }
  };

  for (let i = start; i < end; i++) {
    const c = command[i];
    if (c === undefined) break;

    if (c === '\\' && !single) {
      if (wordStart === -1) wordStart = i;
      wordText += command[i + 1] ?? '';
      i++;
      continue;
    }
    if (c === "'" && !double) {
      if (wordStart === -1) wordStart = i;
      single = !single;
      continue;
    }
    if (c === '"' && !single) {
      if (wordStart === -1) wordStart = i;
      double = !double;
      continue;
    }
    if (!single) {
      // Command substitution anywhere (quoted or not) disqualifies the segment:
      // `echo "$(touch /etc/cron.d/pwn)"` executes despite looking like text.
      if (c === '$' && (command[i + 1] === '(' || command[i + 1] === '{')) hasSubstitution = true;
      if (c === '`') hasSubstitution = true;
    }
    if (!single && !double) {
      if (c === '>' || c === '<') {
        hasRedirect = true;
        flush(i);
        continue;
      }
      if (c === '#' && wordStart === -1) {
        commentStart = i;
        break;
      }
      if (c === ' ' || c === '\t') {
        flush(i);
        continue;
      }
    }
    if (wordStart === -1) wordStart = i;
    wordText += c;
  }
  flush(end);

  return { words, hasSubstitution, hasRedirect, commentStart, balanced: !single && !double };
}

/** Blank the pattern list of a `case` statement: everything between `in` and `)`. */
function applyCase(chars: string[], words: Word[]): void {
  const inIdx = words.findIndex((w) => w.text === 'in');
  if (inIdx === -1) return;
  for (let i = inIdx + 1; i < words.length; i++) {
    const w = words[i];
    if (!w) return;
    blank(chars, w.start, w.end);
    if (w.text.includes(')')) return;
  }
}

/**
 * True when a grep-like invocation carries a flag whose argument is a pattern
 * FILE rather than a pattern.
 *
 * `grep -f /etc/shadow log` READS /etc/shadow — the `-f` operand is a path, and
 * blanking it as if it were the search pattern allowed a real read. Bundled
 * short flags count (`-hof`), as does the separated long form (`--file p`); the
 * attached `--file=p` form is already denied because the path stays in the word.
 * Any such flag disqualifies the whole segment rather than trying to track which
 * operand it consumed.
 */
function hasPatternFileFlag(words: Word[]): boolean {
  for (let i = 1; i < words.length; i++) {
    const t = words[i]?.text ?? '';
    if (t === '--file' || t.startsWith('--file=')) return true;
    // Short bundle: -f, -hof, -irf … (single dash, letters only, contains f).
    if (/^-[a-zA-Z]+$/.test(t) && t.includes('f')) return true;
  }
  return false;
}

/** Blank the search-pattern operand of a grep-like command; paths stay scanned. */
function applyGrepLike(chars: string[], words: Word[]): void {
  if (hasPatternFileFlag(words)) return;
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (!w) return;
    if (GREP_PATTERN_FLAGS.has(w.text)) {
      const next = words[i + 1];
      if (next) blank(chars, next.start, next.end);
      return;
    }
    if (w.text.startsWith('--regexp=')) {
      blank(chars, w.start + '--regexp='.length, w.end);
      return;
    }
    if (!w.text.startsWith('-')) {
      blank(chars, w.start, w.end);
      return;
    }
  }
}

/** Blank the message operand of `git commit -m` / `--message=`. */
function applyGitCommit(chars: string[], words: Word[]): void {
  if (words[1]?.text !== 'commit') return;
  for (let i = 2; i < words.length; i++) {
    const w = words[i];
    if (!w) return;
    if (w.text === '-m' || w.text === '--message') {
      const next = words[i + 1];
      if (next) blank(chars, next.start, next.end);
      return;
    }
    if (w.text.startsWith('--message=')) {
      blank(chars, w.start + '--message='.length, w.end);
      return;
    }
  }
}

/**
 * Produce the scannable projection: the command with provably-inert regions
 * replaced by spaces. Returns the input unchanged whenever anything is
 * ambiguous — that is the fail-closed contract.
 */
export function scannableProjection(command: string): string {
  try {
    // A pipe that binds to a `{ … }` / `( … )` group is not visible in any one
    // segment's terminator, so nothing in the command is provably inert.
    if (hasGroupedPipe(command)) return command;

    // A heredoc body is data fed to stdin — but `cat <<'EOF' | xargs rm -f`
    // turns that data into another command's ARGUMENTS. When any real pipe is
    // present, no heredoc body is provably inert.
    const afterHeredoc = hasRealPipe(command) ? command : blankQuotedHeredocs(command);
    const segments = splitSegments(afterHeredoc);
    if (!segments) return command; // unbalanced quotes → scan everything

    const chars = afterHeredoc.split('');

    for (const seg of segments) {
      // `echo /etc/hosts | xargs rm -f` really does delete the file. echo never
      // opens a path itself, but a pipe hands its operands to a command that
      // does — so a segment whose stdout is piped has NO inert region.
      // (Found by the pinned adversarial-review case 'xargs indirection'.)
      if (seg.pipedOut) continue;

      const scan = scanSegment(afterHeredoc, seg.start, seg.end);
      if (!scan.balanced) continue;

      // Comments are inert regardless of the command.
      if (scan.commentStart !== -1) {
        blank(chars, scan.commentStart, seg.end);
      }

      // Two blanket disqualifiers. Cheap, and they remove whole classes of
      // parsing risk: substitution executes, and a redirect target is a real
      // write no matter which command precedes it.
      if (scan.hasSubstitution || scan.hasRedirect) continue;

      const words = scan.words;
      const argv0 = words[0];
      if (!argv0) continue;

      const cmd = commandKey(argv0.text);

      if (cmd === 'case') {
        applyCase(chars, words);
        continue;
      }
      if (ECHO_LIKE.has(cmd)) {
        for (let i = 1; i < words.length; i++) {
          const w = words[i];
          if (w) blank(chars, w.start, w.end);
        }
        continue;
      }
      if (GREP_LIKE.has(cmd)) {
        applyGrepLike(chars, words);
        continue;
      }
      if (cmd === 'git') {
        applyGitCommit(chars, words);
      }
    }

    return chars.join('');
  } catch {
    return command; // any parser failure → scan everything
  }
}

export default scannableProjection;
