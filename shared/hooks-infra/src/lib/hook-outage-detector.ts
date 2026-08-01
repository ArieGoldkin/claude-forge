/**
 * Retrospective detector for silent plugin unloads (#82).
 *
 * On 2026-07-29 a session ran with ctk's hooks firing ZERO times — no
 * `security-blocker`, no permission hooks, no lifecycle — while `claude plugin
 * list` reported all five plugins enabled. `/doctor` Step 1b detects that state
 * LIVE (does a hook stamp in *this* session?). It cannot see an outage that has
 * already ended, so nobody knew the failure had happened more than once.
 *
 * This module answers the other question: **did hooks stop at any point in
 * retained history, when, and for how long?** Applying it found a second,
 * previously unknown outage on 2026-07-17 and established that both began AND
 * ENDED mid-session — which refuted the filed issue's "a session started with
 * zero plugins loaded" framing.
 *
 * THE SIGNAL. Join two per-hour series: hook-log lines, and transcript tool
 * calls. An outage is an hour with tool calls that SHOULD have logged and zero
 * lines that did.
 *
 * TWO FAILURE SHAPES THIS ENCODES, BOTH OF WHICH PRODUCED A CONFIDENT
 * "NO PROBLEM" BEFORE THEY WERE FOUND — the fixtures pin both:
 *
 *  1. **Per-session joins hide outages.** Sessions resume and SHARE a transcript
 *     file, so keying a file to its first `sessionId` averages a quiet outage
 *     away against the working hours around it. Read `sessionId` per RECORD, and
 *     bucket by hour rather than by session.
 *  2. **Not every tool is hooked.** ctk logs on Bash/Write/Edit/MultiEdit. An
 *     hour of Grep, Glob, Task or WebFetch legitimately logs nothing, so
 *     counting all tools reports noise as outages. Count hooked tools only.
 *
 * Two subtler ones, both of which produced a false ALL-CLEAR — the worse
 * direction for a safety diagnostic, and the one this tool must never emit:
 *
 *  3. **The in-progress hour is mid-write**, so it is excluded. But the bound
 *     must come from the LATEST hour in EITHER series, not from the last logged
 *     hour: when hooks stop, the log stops, so a log-derived bound freezes at the
 *     moment of failure and hides the entire ONGOING outage behind it. Measured:
 *     90 hooked calls over three silent hours reported `OK`, exit 0.
 *  4. **Silence is probabilistic, not binary** — only ~0.5 log lines are written
 *     per hooked tool call, so a quiet 5-call hour is chance ~5% of the time.
 *     See `DEFAULT_MIN_TOOLS` and the significance test in `detectOutages`.
 *
 * @module lib/hook-outage-detector
 */

/** Tools whose PreToolUse hooks write a permission-log line when ctk is loaded. */
export const HOOKED_TOOLS: ReadonlySet<string> = new Set(['Bash', 'Write', 'Edit', 'MultiEdit']);

/**
 * Floor on hooked tool calls before an hour is even considered.
 *
 * This is a cheap pre-filter, NOT the decision — see `detectOutages`, which
 * applies a base-rate significance test on top. A fixed threshold alone is
 * wrong: measured on this machine, only **0.41–0.58 log lines are written per
 * hooked tool call**, because `bash-combined` writes a permission line on
 * auto-approve or deny but NOT when a command defers to a user prompt, and
 * `hooks.log` is WARN-level so `logInfo` is suppressed. At a rate of ~0.45, an
 * hour of 5 hooked calls is silent by chance ~5% of the time — which over a few
 * hundred analysed hours produces roughly a dozen phantom outages.
 */
export const DEFAULT_MIN_TOOLS = 5;

/**
 * Family-wise error budget. An hour is reported only when the probability of its
 * silence arising by chance, multiplied by the number of hours examined, is
 * below this. Without the multiplier, scanning enough hours guarantees a false
 * positive eventually.
 */
export const DEFAULT_ALPHA = 0.01;

/** `2026-07-29T10:15:33.123Z` → `2026-07-29T10`. Returns null if unparseable. */
export function hourOf(timestamp: string | undefined | null): string | null {
  if (typeof timestamp !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}T\d{2}/.test(timestamp) ? timestamp.slice(0, 13) : null;
}

/**
 * Count hook-log lines per hour. Accepts lines from BOTH `permission-feedback.log*`
 * and `hooks.log*` — either proves hooks ran.
 */
export function hookHoursFromLines(lines: Iterable<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    const h = hourOf(line);
    if (h) out.set(h, (out.get(h) ?? 0) + 1);
  }
  return out;
}

export interface ToolActivity {
  /** hooked tool calls per hour */
  hooked: Map<string, number>;
  /** every tool call per hour, for context in the report */
  all: Map<string, number>;
  /** short session ids seen per hour */
  sessions: Map<string, Set<string>>;
  /** per-hour tool-name histogram, so a flagged hour can be explained */
  names: Map<string, Map<string, number>>;
}

/**
 * Bucket transcript records by hour.
 *
 * `records` is the parsed JSONL of CC transcripts. Each record may carry
 * `timestamp`, `sessionId`, and `message.content[]` with `type: 'tool_use'`.
 * Records are read INDIVIDUALLY — never attributed to a file-level session id.
 */
export function toolHoursFromRecords(records: Iterable<unknown>): ToolActivity {
  const hooked = new Map<string, number>();
  const all = new Map<string, number>();
  const sessions = new Map<string, Set<string>>();
  const names = new Map<string, Map<string, number>>();

  for (const raw of records) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    const h = hourOf(rec['timestamp'] as string);
    if (!h) continue;
    const msg = rec['message'];
    const content =
      msg && typeof msg === 'object' ? (msg as Record<string, unknown>)['content'] : null;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b['type'] !== 'tool_use') continue;
      const name = typeof b['name'] === 'string' ? b['name'] : '?';

      all.set(h, (all.get(h) ?? 0) + 1);
      let hist = names.get(h);
      if (!hist) {
        hist = new Map();
        names.set(h, hist);
      }
      hist.set(name, (hist.get(name) ?? 0) + 1);

      if (HOOKED_TOOLS.has(name)) {
        hooked.set(h, (hooked.get(h) ?? 0) + 1);
        const sid = rec['sessionId'];
        if (typeof sid === 'string' && sid) {
          let set = sessions.get(h);
          if (!set) {
            set = new Set();
            sessions.set(h, set);
          }
          set.add(sid.slice(0, 8));
        }
      }
    }
  }
  return { hooked, all, sessions, names };
}

export interface Outage {
  hour: string;
  hookedTools: number;
  allTools: number;
  sessions: string[];
  tools: [string, number][];
  /** P(this hour is silent by chance), given the measured logging base rate. */
  pValue: number;
  /** pValue × hoursAnalysed — the family-wise figure actually compared to alpha. */
  expectedByChance: number;
}

export interface DetectOptions {
  /** Pre-filter: minimum hooked tool calls before an hour is considered. */
  minTools?: number;
  /** Family-wise error budget (default {@link DEFAULT_ALPHA}). */
  alpha?: number;
  /**
   * Override the measured log-lines-per-hooked-tool rate. Normally computed from
   * the data; injectable so tests can pin behaviour at a known rate.
   */
  baseRate?: number;
}

export interface DetectResult {
  outages: Outage[];
  /** Hours inside coverage that had hooked tool calls — the denominator. */
  hoursAnalysed: number;
  /** Inclusive lower / exclusive upper bound of hook-log coverage. */
  coverage: { from: string; to: string } | null;
  /** Log lines observed per hooked tool call, measured over analysed hours. */
  baseRate: number;
  /** Hours that cleared minTools but were rejected as not significant. */
  rejectedAsChance: number;
}

/**
 * Join the two series and report outages.
 *
 * Clipping is load-bearing in both directions:
 * - Below `coverage.from` there is no log to be silent, so absence proves nothing.
 * - The final covered hour is excluded because the log is mid-write when read;
 *   without this, "now" is reported as an outage on every run.
 */
export function detectOutages(
  hookHours: Map<string, number>,
  activity: ToolActivity,
  opts: DetectOptions = {}
): DetectResult {
  const minTools = opts.minTools ?? DEFAULT_MIN_TOOLS;
  const alpha = opts.alpha ?? DEFAULT_ALPHA;
  const covered = [...hookHours.keys()].sort();
  if (covered.length === 0) {
    return { outages: [], hoursAnalysed: 0, coverage: null, baseRate: 0, rejectedAsChance: 0 };
  }
  const from = covered[0] as string;

  // UPPER BOUND — must NOT be the last logged hour.
  //
  // It was, and that made an ONGOING outage invisible: when hooks stop, the log
  // stops, so the last logged hour freezes at the moment of failure and every
  // subsequent hour falls outside the window. Measured: 90 hooked tool calls
  // across three hours with zero hook activity reported `VERDICT: OK`, exit 0 —
  // a confident all-clear in exactly the case a user most needs the alarm.
  //
  // The genuine artifact is narrower: only the single hour still IN PROGRESS is
  // mid-write. That is the latest hour in EITHER series, not in the log alone.
  // Deriving it from both keeps the function deterministic (no clock read, which
  // would also make it untestable).
  const toolHoursSorted = [...activity.hooked.keys()].sort();
  const lastLogged = covered[covered.length - 1] as string;
  const lastTool = toolHoursSorted[toolHoursSorted.length - 1];
  const to = lastTool && lastTool > lastLogged ? lastTool : lastLogged;
  const inWindow = (h: string): boolean => h >= from && h < to;

  // Pass 1 — the denominator, and the measured logging rate.
  const analysed: string[] = [];
  let totalTools = 0;
  let totalLines = 0;
  for (const hour of toolHoursSorted) {
    if (!inWindow(hour)) continue;
    analysed.push(hour);
    totalTools += activity.hooked.get(hour) ?? 0;
    totalLines += hookHours.get(hour) ?? 0;
  }
  const hoursAnalysed = analysed.length;
  // Clamp: a rate of 0 or >=1 would make every hour trivially significant or
  // trivially not. Both are degenerate rather than informative.
  const measured = totalTools > 0 ? totalLines / totalTools : 0;
  const baseRate = Math.min(0.99, Math.max(0.01, opts.baseRate ?? measured));

  // Pass 2 — significance.
  const outages: Outage[] = [];
  let rejectedAsChance = 0;
  for (const hour of analysed) {
    if ((hookHours.get(hour) ?? 0) > 0) continue;
    const hookedTools = activity.hooked.get(hour) ?? 0;
    if (hookedTools < minTools) continue;
    const pValue = (1 - baseRate) ** hookedTools;
    const expectedByChance = pValue * Math.max(hoursAnalysed, 1);
    if (expectedByChance >= alpha) {
      rejectedAsChance++;
      continue;
    }
    outages.push({
      hour,
      hookedTools,
      allTools: activity.all.get(hour) ?? 0,
      sessions: [...(activity.sessions.get(hour) ?? [])].sort(),
      tools: [...(activity.names.get(hour) ?? new Map())].sort((a, b) => b[1] - a[1]),
      pValue,
      expectedByChance,
    });
  }

  return { outages, hoursAnalysed, coverage: { from, to }, baseRate, rejectedAsChance };
}

/** Group adjacent outage hours into contiguous windows, for reporting. */
export function groupWindows(outages: Outage[]): { start: string; end: string; hours: number }[] {
  const windows: { start: string; end: string; hours: number }[] = [];
  for (const o of outages) {
    const last = windows[windows.length - 1];
    if (last && nextHour(last.end) === o.hour) {
      last.end = o.hour;
      last.hours++;
    } else {
      windows.push({ start: o.hour, end: o.hour, hours: 1 });
    }
  }
  return windows;
}

/** `2026-07-29T23` → `2026-07-30T00`. Date-aware so windows don't break at midnight. */
export function nextHour(hour: string): string {
  const d = new Date(`${hour}:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString().slice(0, 13);
}
