/**
 * Structural guard for the normalizeInput allowlist.
 *
 * WHY THIS EXISTS
 *
 * `normalizeInput()` in lib/input.ts does not forward the parsed hook payload.
 * It builds a NEW object from three always-set fields plus a fixed
 * `passThrough` allowlist. Any field not on that list is silently deleted
 * before a handler ever sees it.
 *
 * A handler that reads a dropped field is INERT, and it fails as a plausible
 * default (`input.foo || 'unknown'`, `if (!foo) return`) rather than an error.
 * That is invisible to the type checker, because each such handler declares its
 * own `interface X extends HookInput { foo?: ... }` — the local declaration
 * makes the read compile while normalization removes the data.
 *
 * This has shipped three times:
 *   - 2.8.4  agent-team handlers read teammate_name/team_name  (fixed 2.8.5)
 *   - 2.9.0  three PostToolUse handlers read a non-existent `tool_output`,
 *            and failure-logger read `error`/`is_interrupt`
 *
 * Every previous fix pinned specific FIELD NAMES. Those tests pass while new
 * instances of the same defect ship — 2,075 green tests coexisted with four
 * inert handlers. This test pins the MECHANISM instead: it fails whenever a
 * handler declares an input field the allowlist does not carry, regardless of
 * which field it is.
 *
 * @module tests/lib/passthrough-completeness
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const INPUT_LIB = path.join(SRC, 'lib/input.ts');
const HOOKS_DIR = path.join(SRC, 'hooks');

/** Fields normalizeInput always sets itself, so they need no allowlist entry. */
const ALWAYS_SET = new Set(['tool_name', 'session_id', 'tool_input', 'hook_event_name']);

/** Recursively collect .ts files under a directory. */
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Extract the string literals inside the `passThrough` array in input.ts. */
function readPassThrough(): Set<string> {
  const src = fs.readFileSync(INPUT_LIB, 'utf8');
  const start = src.indexOf('const passThrough = [');
  if (start === -1) throw new Error('passThrough array not found in lib/input.ts');
  const end = src.indexOf('];', start);
  if (end === -1) throw new Error('passThrough array not terminated');
  const body = src.slice(start, end);
  return new Set([...body.matchAll(/'([^']+)'/g)].map((m) => m[1] as string));
}

/**
 * Find every `interface X extends HookInput { ... }` block and return the
 * top-level field names it declares, keyed by source file.
 *
 * Only depth-1 keys count — nested object fields are properties of a payload
 * value, not top-level input fields, so the allowlist has no bearing on them.
 */
function readDeclaredFields(): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  for (const file of walk(HOOKS_DIR)) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /interface\s+\w+\s+extends\s+HookInput\s*\{/g;
    let m: RegExpExecArray | null = re.exec(src);

    while (m !== null) {
      // Walk braces from the opening `{` to find the matching close.
      let depth = 0;
      let i = m.index + m[0].length - 1;
      const bodyStart = i + 1;
      let bodyEnd = -1;
      for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
          depth--;
          if (depth === 0) {
            bodyEnd = i;
            break;
          }
        }
      }
      if (bodyEnd === -1) break;

      // Collect depth-1 `name?:` / `name:` keys, skipping comments.
      const body = src.slice(bodyStart, bodyEnd);
      const fields = new Set<string>();
      let d = 0;
      for (const rawLine of body.split('\n')) {
        const line = rawLine.trim();
        const opens = (rawLine.match(/\{/g) || []).length;
        const closes = (rawLine.match(/\}/g) || []).length;
        if (d === 0 && !line.startsWith('*') && !line.startsWith('//') && !line.startsWith('/*')) {
          const fm = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/);
          if (fm) fields.add(fm[1] as string);
        }
        d += opens - closes;
      }

      const rel = path.relative(SRC, file);
      const existing = result.get(rel) ?? new Set<string>();
      for (const f of fields) existing.add(f);
      result.set(rel, existing);

      m = re.exec(src);
    }
  }

  return result;
}

describe('normalizeInput passThrough completeness (structural guard)', () => {
  it('finds the passThrough allowlist and the handler interfaces', () => {
    // Sanity: if either parser silently returns nothing, the guard below would
    // pass vacuously. Assert the harness itself works before trusting it.
    const allow = readPassThrough();
    const declared = readDeclaredFields();

    expect(allow.size).toBeGreaterThan(5);
    expect(declared.size).toBeGreaterThan(0);
  });

  it('carries every input field that a hook handler declares', () => {
    const allow = readPassThrough();
    const declared = readDeclaredFields();

    const violations: string[] = [];
    for (const [file, fields] of declared) {
      for (const field of fields) {
        if (ALWAYS_SET.has(field)) continue;
        if (!allow.has(field)) {
          violations.push(`${file} declares '${field}', which is not in passThrough`);
        }
      }
    }

    // A violation means that handler is INERT: normalizeInput deletes the field
    // before the handler runs, and the handler degrades to a silent default.
    // Fix by adding the field to `passThrough` in lib/input.ts -- and first
    // confirm the field name against a captured payload, because a wrong name
    // added to the allowlist is still inert.
    expect(violations).toEqual([]);
  });

  it('carries the agent-team and post-tool fields confirmed against live payloads', () => {
    // Regression pin for the specific names captured from CC 2.1.220.
    // Complements the structural check above: that one catches new instances,
    // this one stops a known-good field being removed.
    const allow = readPassThrough();

    for (const field of [
      // TeammateIdle / Task* (captured 2026-07-25, ctk 2.8.5)
      'teammate_name',
      'team_name',
      'task_id',
      'task_subject',
      'task_description',
      // PostToolUse / PostToolUseFailure (captured 2026-07-25, ctk 2.9.0)
      'tool_response',
      'error',
      'is_interrupt',
    ]) {
      expect(allow.has(field), `passThrough must carry '${field}'`).toBe(true);
    }
  });
});
