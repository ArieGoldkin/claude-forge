/**
 * Regression tests for error-warner rule resolution.
 *
 * These deliberately do NOT mock loadErrorRules. The existing
 * error-warner.test.ts mocks it, which is why the hook could ship inert:
 * the mock supplied rules that production never had. ctk wires error-warner,
 * so CLAUDE_PLUGIN_ROOT resolves to the ctk plugin root -- if ctk ships no
 * .claude/rules/error_rules.json, loadErrorRules returns null and the hook
 * silently no-ops for every user.
 *
 * @module tests/posttool/error-warner-rules-resolution
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearRulesCache, loadErrorRules } from '../../src/lib/error-rules.js';

/** ctk plugin root: tests/posttool -> hooks/tests -> hooks -> plugin root */
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('error-warner rule resolution (regression)', () => {
  const originalPluginRoot = process.env['CLAUDE_PLUGIN_ROOT'];
  let emptyProjectDir: string;

  beforeEach(() => {
    clearRulesCache();
    // A project dir with no .claude/rules -- forces the plugin-root fallback
    emptyProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctk-no-rules-'));
  });

  afterEach(() => {
    clearRulesCache();
    if (originalPluginRoot === undefined) {
      delete process.env['CLAUDE_PLUGIN_ROOT'];
    } else {
      process.env['CLAUDE_PLUGIN_ROOT'] = originalPluginRoot;
    }
    fs.rmSync(emptyProjectDir, { recursive: true, force: true });
  });

  it('ctk ships default error rules at the plugin fallback path', () => {
    // The actual defect: ctk had no .claude/ dir at all, so the fallback
    // in error-rules.ts always missed.
    const rulesPath = path.join(PLUGIN_ROOT, '.claude', 'rules', 'error_rules.json');
    expect(fs.existsSync(rulesPath)).toBe(true);
  });

  it('shipped default rules are valid JSON with a non-empty rules array', () => {
    const rulesPath = path.join(PLUGIN_ROOT, '.claude', 'rules', 'error_rules.json');
    const config = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    expect(Array.isArray(config.rules)).toBe(true);
    expect(config.rules.length).toBeGreaterThan(0);
    for (const rule of config.rules) {
      expect(typeof rule.id).toBe('string');
      expect(typeof rule.pattern).toBe('string');
      expect(typeof rule.message).toBe('string');
    }
  });

  it('loadErrorRules falls back to ctk plugin defaults when the project has no rules', async () => {
    process.env['CLAUDE_PLUGIN_ROOT'] = PLUGIN_ROOT;

    const rules = await loadErrorRules(emptyProjectDir);

    // Before the fix this returned null -> error-warner returned silent success
    // for every user, forever.
    expect(rules).not.toBeNull();
    expect(rules?.rules.length).toBeGreaterThan(0);
  });

  it('returns null when no project rules and no plugin root (documents the failure mode)', async () => {
    delete process.env['CLAUDE_PLUGIN_ROOT'];

    const rules = await loadErrorRules(emptyProjectDir);

    expect(rules).toBeNull();
  });
});
