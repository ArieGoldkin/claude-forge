/**
 * Tests for lib/hook-liveness — the READER half of the #82 detector.
 *
 * Separate from `hook-liveness.test.ts` because that file mocks `node:fs` wholesale
 * to keep the writer away from the real temp directory. The reader tail-reads a
 * transcript by descriptor and offset, so a mock would be testing the mock; these
 * tests use real files under a per-test `mkdtemp` directory instead. Nothing here
 * is session-scoped or machine-global, so the hazard that motivates the writer's
 * mock does not apply.
 *
 * The numbers asserted below are measurements, not preferences. `isUserPromptRecord`
 * is exercised through `lastUserPromptAt` because the predicate is not exported —
 * it has no caller of its own, and this repo already carries public API nobody runs
 * (#67).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LIVENESS_RACE_GRACE_MS,
  TRANSCRIPT_TAIL_BYTES,
  assessHookLiveness,
  lastUserPromptAt,
} from '../../src/lib/hook-liveness.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ctk-liveness-reader-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a JSONL transcript from record objects and return its path. */
function transcript(records: Record<string, unknown>[], name = 'session.jsonl'): string {
  const path = join(dir, name);
  writeFileSync(path, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  return path;
}

// Every fixture below is shaped from a REAL local transcript record, not from an
// idea of what one looks like. That distinction is not pedantic: the first
// version of this file modelled a slash command as `isMeta: true`, which no real
// slash command is, so the test named "IGNORES isMeta records" appeared to cover
// slash commands and covered nothing of the sort. The predicate shipped with a
// 493-false-alarm hole straight through that gap.

/** A genuine submitted prompt — carries CC's own `promptSource` marker. */
const userPrompt = (timestamp: string): Record<string, unknown> => ({
  type: 'user',
  promptSource: 'typed',
  timestamp,
  message: { role: 'user', content: 'do the thing' },
});

/**
 * A tool result. Real ones carry no `promptSource`, so the allowlist alone would
 * reject them and the `tool_result` guard would be unreachable — a mutation
 * removing it survived until this fixture was given the marker. It carries one
 * deliberately, so the guard is pinned against the case it actually exists for:
 * a record that clears the allowlist but is still not a prompt. Same reasoning as
 * {@link sidechainPrompt}.
 */
const toolResult = (timestamp: string): Record<string, unknown> => ({
  type: 'user',
  promptSource: 'typed',
  timestamp,
  message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] },
});

/**
 * A real `isMeta` record. It carries `promptSource` — 32 local records do — so
 * this fixture can only pass because of the `isMeta` guard, not because the
 * allowlist happens to reject it.
 */
const metaRecord = (timestamp: string): Record<string, unknown> => ({
  type: 'user',
  isMeta: true,
  promptSource: 'typed',
  timestamp,
  message: { role: 'user', content: [{ type: 'text', text: 'injected context' }] },
});

const sidechainPrompt = (timestamp: string): Record<string, unknown> => ({
  type: 'user',
  isSidechain: true,
  promptSource: 'typed',
  timestamp,
  message: { role: 'user', content: 'subagent brief' },
});

/**
 * A built-in slash command (`/model`, `/plugin`, …). NOT `isMeta`, string
 * content, and **no** `promptSource` — CC handles it without raising
 * `UserPromptSubmit`, so no stamp follows it. 397 local records look like this.
 */
const slashCommand = (timestamp: string): Record<string, unknown> => ({
  type: 'user',
  timestamp,
  message: {
    role: 'user',
    content: '<command-name>/model</command-name>\n<command-message>model</command-message>',
  },
});

/**
 * An interrupt — what pressing `Esc` mid-turn writes. Array content, no
 * `promptSource`. This is the worst of the four: interrupting a long agentic turn
 * is the exact scenario the design calls "healthy by construction", and the
 * exclusion-list predicate raised a missing-guardrails banner on it.
 */
const interrupt = (timestamp: string): Record<string, unknown> => ({
  type: 'user',
  timestamp,
  message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
});

/** Output of a local command, echoed back as a user-role record. No `promptSource`. */
const localCommandStdout = (timestamp: string): Record<string, unknown> => ({
  type: 'user',
  timestamp,
  message: { role: 'user', content: '<local-command-stdout>ok</local-command-stdout>' },
});

describe('lastUserPromptAt — the predicate that decides the whole feature', () => {
  it('finds a genuine user prompt', () => {
    const path = transcript([userPrompt('2026-08-02T10:00:00.000Z')]);
    expect(lastUserPromptAt(path)).toBe(Date.parse('2026-08-02T10:00:00.000Z'));
  });

  it('requires CC’s own promptSource marker — an allowlist, not a denylist', () => {
    // The direction matters more than the rule. A record CC stops marking, or a
    // class nobody anticipated, must read as "not a prompt" and go silent — not
    // as a fresh prompt and raise a missing-guardrails alarm.
    const path = transcript([
      {
        type: 'user',
        timestamp: '2026-08-02T10:00:00.000Z',
        message: { role: 'user', content: 'unmarked' },
      },
    ]);
    expect(lastUserPromptAt(path)).toBeNull();
  });

  it('IGNORES tool results, which Claude Code files under role "user"', () => {
    const path = transcript([
      userPrompt('2026-08-02T10:00:00.000Z'),
      toolResult('2026-08-02T10:05:00.000Z'),
      toolResult('2026-08-02T10:09:00.000Z'),
    ]);
    expect(lastUserPromptAt(path)).toBe(Date.parse('2026-08-02T10:00:00.000Z'));
  });

  it('IGNORES isMeta records even when they carry promptSource', () => {
    // 32 local records carry both, so this can only pass via the isMeta guard.
    const path = transcript([
      userPrompt('2026-08-02T10:00:00.000Z'),
      metaRecord('2026-08-02T10:07:00.000Z'),
    ]);
    expect(lastUserPromptAt(path)).toBe(Date.parse('2026-08-02T10:00:00.000Z'));
  });

  it('IGNORES sidechain records — a subagent brief raises no UserPromptSubmit', () => {
    const path = transcript([
      userPrompt('2026-08-02T10:00:00.000Z'),
      sidechainPrompt('2026-08-02T10:08:00.000Z'),
    ]);
    expect(lastUserPromptAt(path)).toBe(Date.parse('2026-08-02T10:00:00.000Z'));
  });

  // ---------------------------------------------------------------------------
  // The four non-submitting record classes. Each of these shipped as a false
  // alarm in the exclusion-list predicate; together they accounted for 493 false
  // `suspect` verdicts across 73 of 113 local transcripts.
  // ---------------------------------------------------------------------------

  it('IGNORES a built-in slash command — CC raises no UserPromptSubmit for it', () => {
    // 397 local records. Not isMeta, so the isMeta guard never touched them.
    const path = transcript([
      userPrompt('2026-08-02T10:00:00.000Z'),
      slashCommand('2026-08-02T10:40:00.000Z'),
    ]);
    expect(lastUserPromptAt(path)).toBe(Date.parse('2026-08-02T10:00:00.000Z'));
  });

  it('IGNORES an interrupt — pressing Esc mid-turn is not a new prompt', () => {
    // The blocking defect this predicate was rewritten for: interrupting a long
    // agentic turn is the case the design calls healthy BY CONSTRUCTION, and the
    // previous predicate raised a missing-guardrails banner on it.
    const path = transcript([
      userPrompt('2026-08-02T10:00:00.000Z'),
      interrupt('2026-08-02T10:45:00.000Z'),
    ]);
    expect(lastUserPromptAt(path)).toBe(Date.parse('2026-08-02T10:00:00.000Z'));
  });

  it('IGNORES local-command-stdout echoes', () => {
    const path = transcript([
      userPrompt('2026-08-02T10:00:00.000Z'),
      localCommandStdout('2026-08-02T10:50:00.000Z'),
    ]);
    expect(lastUserPromptAt(path)).toBe(Date.parse('2026-08-02T10:00:00.000Z'));
  });

  it('stays healthy end-to-end through interrupt + slash command + tool results', () => {
    // The full replay scenario in one transcript: a genuine prompt, a long turn,
    // an Esc, a /model, and command output. Verdict must remain healthy.
    const path = transcript(
      [
        userPrompt('2026-08-02T10:00:00.000Z'),
        toolResult('2026-08-02T10:20:00.000Z'),
        interrupt('2026-08-02T10:45:00.000Z'),
        slashCommand('2026-08-02T10:46:00.000Z'),
        localCommandStdout('2026-08-02T10:47:00.000Z'),
      ],
      'mixed-session.jsonl'
    );
    expect(lastUserPromptAt(path)).toBe(Date.parse('2026-08-02T10:00:00.000Z'));
  });

  it('takes the NEWEST prompt, not the last line', () => {
    const path = transcript([
      userPrompt('2026-08-02T10:09:00.000Z'),
      userPrompt('2026-08-02T10:01:00.000Z'),
    ]);
    expect(lastUserPromptAt(path)).toBe(Date.parse('2026-08-02T10:09:00.000Z'));
  });

  it('returns null when the transcript holds no user prompt at all', () => {
    expect(lastUserPromptAt(transcript([toolResult('2026-08-02T10:00:00.000Z')]))).toBeNull();
  });

  it('returns null for a missing file rather than throwing', () => {
    expect(lastUserPromptAt(join(dir, 'absent.jsonl'))).toBeNull();
  });

  it('survives a truncated trailing line, which is normal for a live transcript', () => {
    const path = join(dir, 'torn.jsonl');
    writeFileSync(
      path,
      `${JSON.stringify(userPrompt('2026-08-02T10:00:00.000Z'))}\n{"type":"us`,
      'utf8'
    );
    expect(lastUserPromptAt(path)).toBe(Date.parse('2026-08-02T10:00:00.000Z'));
  });

  it('reads only the tail, and degrades to null rather than alarming', () => {
    // A prompt buried further back than TRANSCRIPT_TAIL_BYTES must not be found —
    // that is the safe direction, because "not found" resolves to `unknown` and
    // stays silent. Verified against the real constant, so shrinking the tail
    // without revisiting this test cannot pass by accident.
    const filler = {
      type: 'assistant',
      timestamp: '2026-08-02T10:00:01.000Z',
      pad: 'x'.repeat(4096),
    };
    const records: Record<string, unknown>[] = [userPrompt('2026-08-02T10:00:00.000Z')];
    const fillerBytes = JSON.stringify(filler).length + 1;
    for (let written = 0; written < TRANSCRIPT_TAIL_BYTES + 512 * 1024; written += fillerBytes) {
      records.push(filler);
    }
    expect(lastUserPromptAt(transcript(records, 'deep.jsonl'))).toBeNull();
  });

  it('finds a prompt that sits INSIDE the tail of an over-long transcript', () => {
    // The complement of the test above: without this, a tail size of zero would
    // also pass, and "reads only the tail" would be indistinguishable from
    // "reads nothing".
    const filler = {
      type: 'assistant',
      timestamp: '2026-08-02T10:00:01.000Z',
      pad: 'x'.repeat(4096),
    };
    const records: Record<string, unknown>[] = [userPrompt('2026-08-02T09:00:00.000Z')];
    const fillerBytes = JSON.stringify(filler).length + 1;
    for (let written = 0; written < TRANSCRIPT_TAIL_BYTES + 512 * 1024; written += fillerBytes) {
      records.push(filler);
    }
    records.push(userPrompt('2026-08-02T11:00:00.000Z'));
    expect(lastUserPromptAt(transcript(records, 'mixed.jsonl'))).toBe(
      Date.parse('2026-08-02T11:00:00.000Z')
    );
  });
});

describe('assessHookLiveness', () => {
  const SESSION = 'aaaa1111-2222-3333-4444-555566667777';

  /** Write a real marker for `session`, and remove it afterwards. */
  function marker(session: string, at: string): void {
    const path = join(tmpdir(), `claude-ctk-hook-alive-${session}.txt`);
    writeFileSync(path, JSON.stringify({ at, hook: 'context-monitor' }), 'utf8');
    markers.push(path);
  }
  let markers: string[] = [];
  beforeEach(() => {
    markers = [];
  });
  afterEach(() => {
    for (const p of markers) rmSync(p, { force: true });
  });

  it('is healthy when the stamp lands after the last prompt', () => {
    marker(SESSION, '2026-08-02T10:00:01.000Z');
    const path = transcript([userPrompt('2026-08-02T10:00:00.000Z')]);
    expect(assessHookLiveness({ sessionId: SESSION, transcriptPath: path })).toBe('healthy');
  });

  it('is SUSPECT when a prompt is newer than the stamp by more than the grace', () => {
    marker(SESSION, '2026-08-02T10:00:00.000Z');
    const path = transcript([userPrompt('2026-08-02T10:30:00.000Z')]);
    expect(assessHookLiveness({ sessionId: SESSION, transcriptPath: path })).toBe('suspect');
  });

  it('stays healthy through a long agentic turn — no new prompt, no new evidence', () => {
    // The case that killed the first design, which counted hooked tool calls and
    // so fired on every long turn. Keying on prompts makes this identical to the
    // healthy case by construction: the tool results below are not prompts.
    marker(SESSION, '2026-08-02T10:00:01.000Z');
    const path = transcript([
      userPrompt('2026-08-02T10:00:00.000Z'),
      toolResult('2026-08-02T12:00:00.000Z'),
      toolResult('2026-08-02T14:00:00.000Z'),
    ]);
    expect(assessHookLiveness({ sessionId: SESSION, transcriptPath: path })).toBe('healthy');
  });

  it('stays healthy when the user presses Esc 45 minutes into a long turn', () => {
    // The blocking finding from the PR #124 review, at the shipped entry point.
    // An interrupt raises no UserPromptSubmit, so no stamp follows it; counting
    // it as a prompt produced a missing-guardrails banner on a healthy session.
    // Replayed over 113 local transcripts, that class alone was 35 false alarms.
    marker(SESSION, '2026-08-02T10:00:01.000Z');
    const path = transcript([
      userPrompt('2026-08-02T10:00:00.000Z'),
      interrupt('2026-08-02T10:45:00.000Z'),
    ]);
    expect(assessHookLiveness({ sessionId: SESSION, transcriptPath: path })).toBe('healthy');
  });

  it('stays healthy after a built-in slash command', () => {
    marker(SESSION, '2026-08-02T10:00:01.000Z');
    const path = transcript([
      userPrompt('2026-08-02T10:00:00.000Z'),
      slashCommand('2026-08-02T10:40:00.000Z'),
    ]);
    expect(assessHookLiveness({ sessionId: SESSION, transcriptPath: path })).toBe('healthy');
  });

  it('STILL alarms on a genuine prompt that got no stamp', () => {
    // The complement: the three tests above must not have bought their silence
    // by disabling detection outright.
    marker(SESSION, '2026-08-02T10:00:01.000Z');
    const path = transcript([
      userPrompt('2026-08-02T10:00:00.000Z'),
      interrupt('2026-08-02T10:45:00.000Z'),
      userPrompt('2026-08-02T10:50:00.000Z'),
    ]);
    expect(assessHookLiveness({ sessionId: SESSION, transcriptPath: path })).toBe('suspect');
  });

  it('tolerates the measured write-ordering race instead of flashing an alarm', () => {
    // Claude Code writes the prompt record BEFORE running UserPromptSubmit hooks,
    // so a healthy session is briefly "prompt newer than stamp". Measured at
    // 62–378 ms across 20 live sessions; a statusline refresh inside that window
    // must not alarm.
    marker(SESSION, '2026-08-02T10:00:00.000Z');
    const path = transcript([userPrompt('2026-08-02T10:00:00.378Z')]);
    expect(assessHookLiveness({ sessionId: SESSION, transcriptPath: path })).toBe('healthy');
  });

  it('still alarms just past the grace boundary', () => {
    // Pins the boundary in both directions, so a grace of Infinity cannot pass.
    marker(SESSION, '2026-08-02T10:00:00.000Z');
    const at = new Date(Date.parse('2026-08-02T10:00:00.000Z') + LIVENESS_RACE_GRACE_MS + 1);
    const path = transcript([userPrompt(at.toISOString())]);
    expect(assessHookLiveness({ sessionId: SESSION, transcriptPath: path })).toBe('suspect');
  });

  it('is UNKNOWN — never suspect — when no marker exists', () => {
    // This is what resolves blocker (1): a session whose loaded hooks predate the
    // writer has no marker, and must not be told its guardrails are gone. It is
    // also why a session-start total unload goes undetected; see the module header.
    const path = transcript([userPrompt('2026-08-02T10:30:00.000Z')]);
    expect(
      assessHookLiveness({ sessionId: 'no-marker-for-this-session', transcriptPath: path })
    ).toBe('unknown');
  });

  it('is UNKNOWN when no transcript path was supplied', () => {
    marker(SESSION, '2026-08-02T10:00:00.000Z');
    expect(assessHookLiveness({ sessionId: SESSION, transcriptPath: undefined })).toBe('unknown');
  });

  it('is UNKNOWN when the transcript cannot be read', () => {
    marker(SESSION, '2026-08-02T10:00:00.000Z');
    expect(
      assessHookLiveness({ sessionId: SESSION, transcriptPath: join(dir, 'gone.jsonl') })
    ).toBe('unknown');
  });

  it('is UNKNOWN under an untrusted fallback session key', () => {
    // `default` and `unknown` are the two constants the layers substitute
    // independently, so a marker under either cannot be matched to a writer.
    for (const untrusted of ['default', 'unknown']) {
      marker(untrusted, '2026-08-02T10:00:00.000Z');
      const path = transcript([userPrompt('2026-08-02T10:30:00.000Z')], `${untrusted}.jsonl`);
      expect(assessHookLiveness({ sessionId: untrusted, transcriptPath: path })).toBe('unknown');
    }
  });

  it('is UNKNOWN when the marker is corrupt rather than treating it as absent-and-dead', () => {
    const path = join(tmpdir(), `claude-ctk-hook-alive-${SESSION}.txt`);
    writeFileSync(path, '{ torn', 'utf8');
    markers.push(path);
    const t = transcript([userPrompt('2026-08-02T10:30:00.000Z')]);
    expect(assessHookLiveness({ sessionId: SESSION, transcriptPath: t })).toBe('unknown');
  });
});
