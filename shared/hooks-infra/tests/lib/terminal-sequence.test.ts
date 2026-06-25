import { describe, expect, it } from 'vitest';
import {
  buildWindowTitleSequence,
  sanitizeTitleSegment,
} from '../../src/lib/terminal-sequence.js';

describe('sanitizeTitleSegment', () => {
  it('passes through ordinary text unchanged', () => {
    expect(sanitizeTitleSegment('myproject')).toBe('myproject');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeTitleSegment('  branch  ')).toBe('branch');
  });

  it('strips BEL (\\x07) that would close the OSC sequence early', () => {
    expect(sanitizeTitleSegment('proj\x07attack')).toBe('projattack');
  });

  it('strips ESC (\\x1b) that could chain another escape', () => {
    expect(sanitizeTitleSegment('proj\x1b]0;evil\x07')).toBe('proj]0;evil');
  });

  it('strips all C0 control codes', () => {
    expect(sanitizeTitleSegment('a\x00b\x01c\x1fd')).toBe('abcd');
  });

  it('strips DEL (0x7F)', () => {
    expect(sanitizeTitleSegment('proj\x7fdel')).toBe('projdel');
  });

  it('preserves Unicode (no over-sanitization)', () => {
    expect(sanitizeTitleSegment('プロジェクト・branch')).toBe('プロジェクト・branch');
  });

  it('preserves slashes and hyphens common in branch names', () => {
    expect(sanitizeTitleSegment('feat/auth-flow')).toBe('feat/auth-flow');
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeTitleSegment(undefined as unknown as string)).toBe('');
    expect(sanitizeTitleSegment(null as unknown as string)).toBe('');
    expect(sanitizeTitleSegment(42 as unknown as string)).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeTitleSegment('   ')).toBe('');
    expect(sanitizeTitleSegment('\t\n')).toBe('');
  });
});

describe('buildWindowTitleSequence', () => {
  it('joins segments with middle-dot and wraps in OSC 2 + BEL', () => {
    expect(buildWindowTitleSequence(['ctk', 'main'])).toBe('\x1b]2;ctk · main\x07');
  });

  it('handles a single segment', () => {
    expect(buildWindowTitleSequence(['ctk'])).toBe('\x1b]2;ctk\x07');
  });

  it('drops empty segments before joining', () => {
    expect(buildWindowTitleSequence(['ctk', '', 'main'])).toBe('\x1b]2;ctk · main\x07');
  });

  it('returns empty string when every segment sanitizes to empty', () => {
    expect(buildWindowTitleSequence(['', '   ', '\t'])).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(buildWindowTitleSequence([])).toBe('');
  });

  it('truncates titles longer than 200 chars', () => {
    const long = 'a'.repeat(300);
    const result = buildWindowTitleSequence([long]);
    // Strip wrapper and check the inner title length
    const inner = result.slice(4, -1);
    expect(inner.length).toBe(200);
    expect(result.startsWith('\x1b]2;')).toBe(true);
    expect(result.endsWith('\x07')).toBe(true);
  });

  it('sanitizes embedded escape sequences in segments', () => {
    expect(buildWindowTitleSequence(['proj\x07', 'feat\x1b]0;x\x07'])).toBe(
      '\x1b]2;proj · feat]0;x\x07'
    );
  });

  it('handles HIPAA-flavored branch names without leaking control chars', () => {
    // A defensively-crafted branch name; nothing here should make CC reject the sequence.
    expect(buildWindowTitleSequence(['claude-forge', 'chore/cleanup'])).toBe(
      '\x1b]2;claude-forge · chore/cleanup\x07'
    );
  });
});
