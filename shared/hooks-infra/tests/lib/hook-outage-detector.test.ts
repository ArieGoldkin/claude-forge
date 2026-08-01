/**
 * Tests for the #82 retrospective plugin-unload detector.
 *
 * The point of this suite is NOT that the detector finds outages — a detector
 * that flags everything does that. It is that the detector survives the two
 * shapes that made earlier versions report a confident "no problem", plus the
 * noise shape that made another version report four phantom outages.
 *
 * Every describe block below corresponds to a real defect, not a hypothetical.
 *
 * @module tests/lib/hook-outage-detector
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALPHA,
  DEFAULT_MIN_TOOLS,
  HOOKED_TOOLS,
  detectOutages,
  groupWindows,
  hookHoursFromLines,
  hourOf,
  nextHour,
  toolHoursFromRecords,
} from '../../src/lib/hook-outage-detector.js';

/** Build a transcript record with `n` tool_use blocks of `tool`. */
function rec(timestamp: string, sessionId: string, tool: string, n = 1) {
  return {
    timestamp,
    sessionId,
    message: { content: Array.from({ length: n }, () => ({ type: 'tool_use', name: tool })) },
  };
}

/**
 * Disables the family-wise significance gate: an hour is rejected when
 * expectedByChance >= alpha, so a huge alpha never rejects. Used ONLY by tests
 * that isolate attribution or tool-filtering on deliberately tiny fixtures —
 * never by the tests that exercise significance itself.
 */
const SIG_OFF = Number.MAX_SAFE_INTEGER;

/** Build `n` hook-log lines in the given hour. */
function logLines(hour: string, n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `${hour}:0${i % 10}:00.000Z [PERMISSION] decision=allow`
  );
}

describe('hourOf', () => {
  it('truncates an ISO timestamp to the hour', () => {
    expect(hourOf('2026-07-29T10:15:33.123Z')).toBe('2026-07-29T10');
  });
  it('returns null for a non-timestamp line', () => {
    expect(hourOf('not a timestamp')).toBeNull();
    expect(hourOf(undefined)).toBeNull();
    expect(hourOf(null)).toBeNull();
  });
});

describe('nextHour — windows must not break at a date boundary', () => {
  it('rolls over midnight', () => {
    expect(nextHour('2026-07-29T23')).toBe('2026-07-30T00');
  });
  it('rolls over month end', () => {
    expect(nextHour('2026-07-31T23')).toBe('2026-08-01T00');
  });
});

describe('DEFECT 1 — sessions that share a transcript file', () => {
  // v1 keyed each transcript FILE to its first sessionId, so an outage inside a
  // long resumed file was averaged away against the working hours around it.
  // Result: 0 suspects, on data that contained a real 9h16m outage.
  it('finds an outage inside a file whose records span two sessions', () => {
    const records = [
      // session A, working hour (has log lines)
      ...Array.from({ length: 8 }, () =>
        rec('2026-07-29T03:10:00.000Z', 'sessionAAA-1111', 'Bash')
      ),
      // session B, SAME file, silent hour
      ...Array.from({ length: 9 }, () =>
        rec('2026-07-29T10:10:00.000Z', 'sessionBBB-2222', 'Edit')
      ),
      // session B, working again
      ...Array.from({ length: 6 }, () =>
        rec('2026-07-29T12:10:00.000Z', 'sessionBBB-2222', 'Bash')
      ),
    ];
    const hooks = hookHoursFromLines([
      ...logLines('2026-07-29T03', 6),
      ...logLines('2026-07-29T12', 4),
      ...logLines('2026-07-29T13', 9), // later coverage so T12 is not the clipped edge
    ]);
    const res = detectOutages(hooks, toolHoursFromRecords(records), { alpha: SIG_OFF });
    expect(res.outages.map((o) => o.hour)).toEqual(['2026-07-29T10']);
    // The outage hour is attributed to the session actually running in it.
    expect(res.outages[0]?.sessions).toEqual(['sessionB']);
  });

  it('never attributes an hour to a session that was not active in it', () => {
    const records = [
      rec('2026-07-29T03:00:00.000Z', 'aaaaaaaa-1', 'Bash'),
      ...Array.from({ length: 6 }, () => rec('2026-07-29T10:00:00.000Z', 'bbbbbbbb-2', 'Bash')),
    ];
    const hooks = hookHoursFromLines([
      ...logLines('2026-07-29T03', 3),
      ...logLines('2026-07-29T11', 3),
    ]);
    const res = detectOutages(hooks, toolHoursFromRecords(records), { alpha: SIG_OFF });
    expect(res.outages[0]?.sessions).toEqual(['bbbbbbbb']);
    expect(res.outages[0]?.sessions).not.toContain('aaaaaaaa');
  });
});

describe('DEFECT 2 — hours containing only unhooked tools', () => {
  // v2 counted ALL tools, so an hour of Grep/Task/WebFetch (which ctk does not
  // hook and which therefore log nothing) was reported as an outage. 4 of its
  // 6 findings were this noise.
  const UNHOOKED = ['Grep', 'Glob', 'Task', 'WebFetch', 'Read', 'TodoWrite', 'Agent'];

  for (const tool of UNHOOKED) {
    it(`does not flag an hour of only ${tool}`, () => {
      const records = Array.from({ length: 20 }, () =>
        rec('2026-07-29T10:00:00.000Z', 'sessionXX-1', tool)
      );
      const hooks = hookHoursFromLines([
        ...logLines('2026-07-29T09', 5),
        ...logLines('2026-07-29T11', 5),
      ]);
      const res = detectOutages(hooks, toolHoursFromRecords(records));
      expect(res.outages).toEqual([]);
    });
  }

  it('DOES flag the same hour once hooked tools are present', () => {
    // The must-fail control for the rule above: identical shape, hooked tool.
    const records = Array.from({ length: 20 }, () =>
      rec('2026-07-29T10:00:00.000Z', 'sessionXX-1', 'Bash')
    );
    const hooks = hookHoursFromLines([
      ...logLines('2026-07-29T09', 5),
      ...logLines('2026-07-29T11', 5),
    ]);
    const res = detectOutages(hooks, toolHoursFromRecords(records), { alpha: SIG_OFF });
    expect(res.outages.map((o) => o.hour)).toEqual(['2026-07-29T10']);
  });

  it('counts only the hooked subset when an hour mixes tool kinds', () => {
    const records = [
      ...Array.from({ length: 3 }, () => rec('2026-07-29T10:00:00.000Z', 's-1', 'Bash')),
      ...Array.from({ length: 40 }, () => rec('2026-07-29T10:00:00.000Z', 's-1', 'Grep')),
    ];
    const hooks = hookHoursFromLines([
      ...logLines('2026-07-29T09', 5),
      ...logLines('2026-07-29T11', 5),
    ]);
    // 3 hooked < DEFAULT_MIN_TOOLS, so not reported despite 43 total calls.
    expect(detectOutages(hooks, toolHoursFromRecords(records), { alpha: SIG_OFF }).outages).toEqual(
      []
    );
    expect(
      detectOutages(hooks, toolHoursFromRecords(records), { minTools: 3, alpha: SIG_OFF }).outages
    ).toHaveLength(1);
  });
});

describe('DEFECT 3 — the trailing hour is a snapshot artifact', () => {
  // The log is mid-write when read, so its final hour always looks short.
  // Without an exclusive upper bound, "now" is reported as an outage every run.
  it('does not flag the last covered hour', () => {
    const records = Array.from({ length: 10 }, () =>
      rec('2026-07-29T12:00:00.000Z', 's-1', 'Bash')
    );
    const hooks = hookHoursFromLines(logLines('2026-07-29T12', 3));
    // T12 is both the only covered hour and the tool hour → excluded.
    expect(detectOutages(hooks, toolHoursFromRecords(records)).outages).toEqual([]);
  });

  it('does not flag hours BEFORE coverage begins', () => {
    // No log existed yet, so silence proves nothing.
    const records = Array.from({ length: 10 }, () =>
      rec('2026-06-01T08:00:00.000Z', 's-1', 'Bash')
    );
    const hooks = hookHoursFromLines([
      ...logLines('2026-07-29T10', 5),
      ...logLines('2026-07-29T11', 5),
    ]);
    expect(detectOutages(hooks, toolHoursFromRecords(records)).outages).toEqual([]);
  });
});

describe('DISCRIMINATION CONTROL — normal hours are not flagged', () => {
  it('a healthy hour with heavy tool use produces no outage', () => {
    const records = Array.from({ length: 50 }, () =>
      rec('2026-07-29T10:00:00.000Z', 's-1', 'Bash')
    );
    const hooks = hookHoursFromLines([
      ...logLines('2026-07-29T09', 5),
      ...logLines('2026-07-29T10', 40),
      ...logLines('2026-07-29T11', 5),
    ]);
    const res = detectOutages(hooks, toolHoursFromRecords(records));
    expect(res.outages).toEqual([]);
    expect(res.hoursAnalysed).toBe(1);
  });

  it('a single log line is enough to clear an hour — the signal is zero, not "few"', () => {
    const records = Array.from({ length: 50 }, () =>
      rec('2026-07-29T10:00:00.000Z', 's-1', 'Bash')
    );
    const hooks = hookHoursFromLines([
      ...logLines('2026-07-29T09', 5),
      ...logLines('2026-07-29T10', 1),
      ...logLines('2026-07-29T11', 5),
    ]);
    expect(detectOutages(hooks, toolHoursFromRecords(records)).outages).toEqual([]);
  });
});

describe('reproduces the two real outages', () => {
  // Shapes taken from the measured 2026-07-17 and 2026-07-29 windows.
  it('finds both, and reports their tool mix', () => {
    const records = [
      ...Array.from({ length: 15 }, () => rec('2026-07-17T15:00:00.000Z', 'b83d2d18-x', 'Bash')),
      ...Array.from({ length: 11 }, () => rec('2026-07-17T16:00:00.000Z', 'b83d2d18-x', 'Bash')),
      ...Array.from({ length: 20 }, () => rec('2026-07-17T17:00:00.000Z', 'b83d2d18-x', 'Bash')),
      ...Array.from({ length: 8 }, () => rec('2026-07-29T03:00:00.000Z', '93ea1008-y', 'Bash')),
      ...Array.from({ length: 9 }, () => rec('2026-07-29T10:00:00.000Z', '93ea1008-y', 'Edit')),
      ...Array.from({ length: 8 }, () => rec('2026-07-29T10:00:00.000Z', '93ea1008-y', 'Bash')),
      ...Array.from({ length: 5 }, () => rec('2026-07-29T12:00:00.000Z', '93ea1008-y', 'Bash')),
      ...Array.from({ length: 5 }, () => rec('2026-07-29T13:00:00.000Z', '93ea1008-y', 'Bash')),
    ];
    const hooks = hookHoursFromLines([
      ...logLines('2026-07-17T15', 15),
      ...logLines('2026-07-17T17', 97),
      ...logLines('2026-07-29T03', 6),
      ...logLines('2026-07-29T12', 4),
      ...logLines('2026-07-29T13', 9),
    ]);
    const res = detectOutages(hooks, toolHoursFromRecords(records));
    expect(res.outages.map((o) => o.hour)).toEqual(['2026-07-17T16', '2026-07-29T10']);
    expect(res.outages[0]?.hookedTools).toBe(11);
    expect(res.outages[1]?.hookedTools).toBe(17);
    // Same session on both sides of the gap — the mid-session finding.
    expect(res.outages[1]?.sessions).toEqual(['93ea1008']);
  });
});

describe('DEFECT 4 — silence is probabilistic, not binary', () => {
  // Measured on a real machine: only 0.41-0.58 log lines are written per hooked
  // tool call, because bash-combined logs on auto-approve or deny but NOT when a
  // command defers to a user prompt, and hooks.log is WARN-level. At ~0.45, a
  // 5-tool hour is silent by chance ~5% of the time. A fixed minTools=5 over 427
  // analysed hours produced 18 findings where ~7 were real.
  const quietHour = (n: number) =>
    Array.from({ length: n }, () => rec('2026-07-29T10:00:00.000Z', 's-1', 'Bash'));
  // 400 busy hours so the family-wise multiplier is realistic.
  const busyLog = () => {
    const lines: string[] = [];
    for (let d = 1; d <= 20; d++) {
      for (let h = 0; h < 20; h++) {
        const hour = `2026-07-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}`;
        lines.push(...logLines(hour, 10));
      }
    }
    lines.push(...logLines('2026-07-29T09', 5), ...logLines('2026-07-29T11', 5));
    return lines;
  };
  const busyRecords = () => {
    const out: ReturnType<typeof rec>[] = [];
    for (let d = 1; d <= 20; d++) {
      for (let h = 0; h < 20; h++) {
        const ts = `2026-07-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;
        out.push(...Array.from({ length: 20 }, () => rec(ts, 's-1', 'Bash')));
      }
    }
    return out;
  };

  it('does NOT report a 5-tool silent hour — that is chance at the measured rate', () => {
    const res = detectOutages(
      hookHoursFromLines(busyLog()),
      toolHoursFromRecords([...busyRecords(), ...quietHour(5)]),
      { baseRate: 0.45 }
    );
    expect(res.outages.map((o) => o.hour)).not.toContain('2026-07-29T10');
    expect(res.rejectedAsChance).toBeGreaterThan(0);
  });

  it('DOES report the same hour at 30 tools — the must-fail control', () => {
    const res = detectOutages(
      hookHoursFromLines(busyLog()),
      toolHoursFromRecords([...busyRecords(), ...quietHour(30)]),
      { baseRate: 0.45 }
    );
    expect(res.outages.map((o) => o.hour)).toContain('2026-07-29T10');
  });

  it('reports pValue and the family-wise figure so a finding is auditable', () => {
    const res = detectOutages(
      hookHoursFromLines(busyLog()),
      toolHoursFromRecords([...busyRecords(), ...quietHour(30)]),
      { baseRate: 0.45 }
    );
    const o = res.outages.find((x) => x.hour === '2026-07-29T10');
    expect(o?.pValue).toBeLessThan(1e-7);
    expect(o?.expectedByChance).toBeLessThan(DEFAULT_ALPHA);
  });

  it('measures the base rate from the data when not supplied', () => {
    const res = detectOutages(
      hookHoursFromLines(busyLog()),
      toolHoursFromRecords([...busyRecords(), ...quietHour(30)])
    );
    // 10 lines per 20 hooked tools in every busy hour.
    expect(res.baseRate).toBeGreaterThan(0.4);
    expect(res.baseRate).toBeLessThan(0.6);
  });

  it('scanning more hours makes the bar HIGHER, not lower', () => {
    // Family-wise correction: the same evidence must be stronger in a bigger scan.
    const small = detectOutages(
      hookHoursFromLines([...logLines('2026-07-29T09', 5), ...logLines('2026-07-29T11', 5)]),
      toolHoursFromRecords(quietHour(12)),
      { baseRate: 0.45 }
    );
    const large = detectOutages(
      hookHoursFromLines(busyLog()),
      toolHoursFromRecords([...busyRecords(), ...quietHour(12)]),
      { baseRate: 0.45 }
    );
    expect(small.outages.length).toBeGreaterThanOrEqual(large.outages.length);
  });

  it('a degenerate base rate cannot make every hour significant', () => {
    // rate 0 would give pValue 1 (nothing flagged); rate 1 gives 0 (all flagged).
    // Both are clamped so a pathological corpus cannot drive the verdict.
    const res = detectOutages(
      hookHoursFromLines(busyLog()),
      toolHoursFromRecords([...busyRecords(), ...quietHour(30)]),
      { baseRate: 1 }
    );
    expect(res.baseRate).toBeLessThanOrEqual(0.99);
  });
});

describe('groupWindows', () => {
  it('merges adjacent hours into one window and splits non-adjacent ones', () => {
    const mk = (hour: string) => ({ hour, hookedTools: 9, allTools: 9, sessions: [], tools: [] });
    const w = groupWindows([mk('2026-07-29T10'), mk('2026-07-29T11'), mk('2026-07-29T15')]);
    expect(w).toEqual([
      { start: '2026-07-29T10', end: '2026-07-29T11', hours: 2 },
      { start: '2026-07-29T15', end: '2026-07-29T15', hours: 1 },
    ]);
  });

  it('merges across midnight', () => {
    const mk = (hour: string) => ({ hour, hookedTools: 9, allTools: 9, sessions: [], tools: [] });
    expect(groupWindows([mk('2026-07-29T23'), mk('2026-07-30T00')])).toHaveLength(1);
  });
});

describe('empty and degenerate input', () => {
  it('no hook log at all → no coverage, no outages (never claims an outage it cannot prove)', () => {
    const records = Array.from({ length: 50 }, () =>
      rec('2026-07-29T10:00:00.000Z', 's-1', 'Bash')
    );
    const res = detectOutages(new Map(), toolHoursFromRecords(records));
    expect(res.outages).toEqual([]);
    expect(res.coverage).toBeNull();
  });

  it('malformed records are skipped, not thrown on', () => {
    const junk = [null, 42, 'string', {}, { timestamp: 'nope' }, { message: null }];
    expect(() => toolHoursFromRecords(junk)).not.toThrow();
    expect(toolHoursFromRecords(junk).hooked.size).toBe(0);
  });

  it('HOOKED_TOOLS is the documented set', () => {
    expect([...HOOKED_TOOLS].sort()).toEqual(['Bash', 'Edit', 'MultiEdit', 'Write']);
    expect(DEFAULT_MIN_TOOLS).toBe(5);
  });
});
