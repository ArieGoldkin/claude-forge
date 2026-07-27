/**
 * Tests for the plugin-identity helpers and getHookEnvironment().
 *
 * Why this file exists (#74). The rule "the log-level variable is named
 * UPPER(CLAUDE_PLUGIN_NAME)_LOG_LEVEL" used to be written twice: once in
 * lib/logging.ts (covered by logging.test.ts's identity table) and once inline
 * inside getHookEnvironment() in src/types.ts, which had ZERO tests and ZERO
 * callers while being re-exported as public API from all five plugins. The two
 * copies had already diverged in behaviour: the types.ts copy neither
 * lower-cased nor validated the value, so `<PLUGIN>_LOG_LEVEL=BOGUS` returned
 * `'BOGUS'` typed as a LogLevel while the logger fell back to 'warn'.
 *
 * This suite is deliberately IDENTITY-INDEPENDENT. logging.test.ts is
 * parameterised by tree (six identities off one file) because the logger
 * captures CLAUDE_PLUGIN_NAME at module load. getHookEnvironment() reads it at
 * CALL time, so these tests can set the name themselves and assert the same
 * expectations in all six trees. The one place the tree's own identity is used
 * (the no-argument default) reads it from process.env rather than a table, so
 * this file needs no per-tree mapping.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPluginName, logLevelEnvVarName, resolveLogLevel } from '../../src/lib/logging.js';
import { getHookEnvironment } from '../../src/types.js';

/** Every environment variable this suite touches, saved and restored verbatim. */
const MANAGED_VARS = [
  'CLAUDE_PLUGIN_NAME',
  'CLAUDE_PROJECT_DIR',
  'CLAUDE_PLUGIN_ROOT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_SESSION_ID',
] as const;

/**
 * Log-level variables set during the run. Collected so cleanup can remove them
 * even when a test invents a plugin name — leaving e.g. TEST_LOG_LEVEL behind
 * would leak into whatever ran next in the same worker.
 */
let touchedLogVars: string[] = [];
let saved: Record<string, string | undefined> = {};

/** Set the log-level variable for `pluginName` and register it for cleanup. */
function setLogLevelFor(pluginName: string, value: string): string {
  const name = logLevelEnvVarName(pluginName);
  process.env[name] = value;
  touchedLogVars.push(name);
  return name;
}

beforeEach(() => {
  saved = {};
  for (const key of MANAGED_VARS) {
    saved[key] = process.env[key];
  }
  touchedLogVars = [];
  // The tree's own log-level variable is cleared so an inherited value cannot
  // make a "defaults to warn" assertion pass or fail for the wrong reason.
  const ownVar = logLevelEnvVarName();
  saved[ownVar] = process.env[ownVar];
  touchedLogVars.push(ownVar);
  delete process.env[ownVar];
});

afterEach(() => {
  for (const name of touchedLogVars) {
    delete process.env[name];
  }
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('getPluginName', () => {
  it('should return the value of CLAUDE_PLUGIN_NAME when set', () => {
    process.env['CLAUDE_PLUGIN_NAME'] = 'continuity';
    expect(getPluginName()).toBe('continuity');
  });

  it('should default to "plugin" when CLAUDE_PLUGIN_NAME is unset', () => {
    delete process.env['CLAUDE_PLUGIN_NAME'];
    expect(getPluginName()).toBe('plugin');
  });

  it('should default to "plugin" when CLAUDE_PLUGIN_NAME is empty', () => {
    process.env['CLAUDE_PLUGIN_NAME'] = '';
    expect(getPluginName()).toBe('plugin');
  });
});

describe('logLevelEnvVarName', () => {
  it('should derive UPPER(name)_LOG_LEVEL from an explicit plugin name', () => {
    expect(logLevelEnvVarName('ai')).toBe('AI_LOG_LEVEL');
    expect(logLevelEnvVarName('continuity')).toBe('CONTINUITY_LOG_LEVEL');
    expect(logLevelEnvVarName('devops')).toBe('DEVOPS_LOG_LEVEL');
    expect(logLevelEnvVarName('engineering')).toBe('ENGINEERING_LOG_LEVEL');
    expect(logLevelEnvVarName('frontend')).toBe('FRONTEND_LOG_LEVEL');
  });

  it('should derive the name of the tree it is running in when called with no argument', () => {
    // Identity-independent by construction: both sides come from the same
    // configured value, so this asserts the default-argument wiring rather than
    // restating a hard-coded table.
    const configured = process.env['CLAUDE_PLUGIN_NAME'] || 'plugin';
    expect(logLevelEnvVarName()).toBe(`${configured.toUpperCase()}_LOG_LEVEL`);
  });

  it('should NOT normalise a name that is not a valid shell identifier', () => {
    // The constraint is enforced upstream by scripts/validate-versions.sh, not
    // papered over here. Normalising would let `ai-toolkit` work by accident
    // and re-open the gap between the log directory name and the variable name
    // that #63 was about. This test pins the deliberate absence of a fix.
    expect(logLevelEnvVarName('ai-toolkit')).toBe('AI-TOOLKIT_LOG_LEVEL');
    expect(/^[A-Za-z_][A-Za-z0-9_]*$/.test(logLevelEnvVarName('ai-toolkit'))).toBe(false);
    expect(/^[A-Za-z_][A-Za-z0-9_]*$/.test(logLevelEnvVarName('ai'))).toBe(true);
  });
});

describe('resolveLogLevel', () => {
  it('should default to warn when the variable is unset', () => {
    expect(resolveLogLevel('testplugin')).toBe('warn');
  });

  it.each(['debug', 'info', 'warn', 'error'] as const)('should resolve %s', (level) => {
    setLogLevelFor('testplugin', level);
    expect(resolveLogLevel('testplugin')).toBe(level);
  });

  it('should be case-insensitive', () => {
    setLogLevelFor('testplugin', 'DEBUG');
    expect(resolveLogLevel('testplugin')).toBe('debug');
  });

  it('should fall back to warn on an unrecognised value', () => {
    setLogLevelFor('testplugin', 'verbose');
    expect(resolveLogLevel('testplugin')).toBe('warn');
  });

  it('should fall back to warn for inherited Object.prototype keys', () => {
    // `'toString' in LOG_LEVEL_VALUES` is true through the prototype chain. The
    // pre-#74 `in` check accepted these, then indexed to undefined — which
    // silences every log line rather than falling back to 'warn'.
    for (const key of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      setLogLevelFor('testplugin', key);
      expect(resolveLogLevel('testplugin')).toBe('warn');
    }
  });

  it('should read the variable belonging to the name it was given', () => {
    setLogLevelFor('alpha', 'debug');
    setLogLevelFor('beta', 'error');
    expect(resolveLogLevel('alpha')).toBe('debug');
    expect(resolveLogLevel('beta')).toBe('error');
    expect(resolveLogLevel('gamma')).toBe('warn');
  });
});

describe('getHookEnvironment', () => {
  describe('projectDir', () => {
    it('should read CLAUDE_PROJECT_DIR when set', () => {
      process.env['CLAUDE_PROJECT_DIR'] = '/tmp/some-project';
      expect(getHookEnvironment().projectDir).toBe('/tmp/some-project');
    });

    it('should fall back to the current working directory', () => {
      delete process.env['CLAUDE_PROJECT_DIR'];
      expect(getHookEnvironment().projectDir).toBe(process.cwd());
    });
  });

  describe('pluginRoot', () => {
    it('should read CLAUDE_PLUGIN_ROOT when set', () => {
      process.env['CLAUDE_PLUGIN_ROOT'] = '/tmp/plugin-root';
      expect(getHookEnvironment().pluginRoot).toBe('/tmp/plugin-root');
    });

    it('should fall back to an empty string', () => {
      delete process.env['CLAUDE_PLUGIN_ROOT'];
      expect(getHookEnvironment().pluginRoot).toBe('');
    });
  });

  describe('sessionId', () => {
    it('should prefer CLAUDE_CODE_SESSION_ID (CC v2.1.132+)', () => {
      process.env['CLAUDE_CODE_SESSION_ID'] = 'new-style';
      process.env['CLAUDE_SESSION_ID'] = 'old-style';
      expect(getHookEnvironment().sessionId).toBe('new-style');
    });

    it('should fall back to CLAUDE_SESSION_ID for older runtimes', () => {
      delete process.env['CLAUDE_CODE_SESSION_ID'];
      process.env['CLAUDE_SESSION_ID'] = 'old-style';
      expect(getHookEnvironment().sessionId).toBe('old-style');
    });

    it('should fall back to "unknown" when neither is set', () => {
      delete process.env['CLAUDE_CODE_SESSION_ID'];
      delete process.env['CLAUDE_SESSION_ID'];
      expect(getHookEnvironment().sessionId).toBe('unknown');
    });
  });

  describe('logLevel', () => {
    it('should read the variable derived from CLAUDE_PLUGIN_NAME', () => {
      process.env['CLAUDE_PLUGIN_NAME'] = 'testplugin';
      setLogLevelFor('testplugin', 'debug');
      expect(getHookEnvironment().logLevel).toBe('debug');
    });

    it('should default to warn when the variable is unset', () => {
      process.env['CLAUDE_PLUGIN_NAME'] = 'testplugin';
      expect(getHookEnvironment().logLevel).toBe('warn');
    });

    it('should lower-case the value (regression: returned "DEBUG")', () => {
      process.env['CLAUDE_PLUGIN_NAME'] = 'testplugin';
      setLogLevelFor('testplugin', 'DEBUG');
      expect(getHookEnvironment().logLevel).toBe('debug');
    });

    it('should reject an invalid value (regression: returned it verbatim)', () => {
      process.env['CLAUDE_PLUGIN_NAME'] = 'testplugin';
      setLogLevelFor('testplugin', 'BOGUS');
      // Pre-#74 this returned 'BOGUS' typed as 'debug' | 'info' | 'warn' | 'error'.
      expect(getHookEnvironment().logLevel).toBe('warn');
    });

    it('should agree with resolveLogLevel for the same plugin name', () => {
      // The point of #74: one variable must not resolve to two different
      // answers depending on which reader is asked.
      for (const value of ['debug', 'INFO', 'warn', 'error', 'nonsense', '']) {
        process.env['CLAUDE_PLUGIN_NAME'] = 'testplugin';
        setLogLevelFor('testplugin', value);
        expect(getHookEnvironment().logLevel).toBe(resolveLogLevel('testplugin'));
      }
    });

    it('should read CLAUDE_PLUGIN_NAME at call time, not module-load time', () => {
      // Deliberate difference from lib/logging.ts, which captures the name once
      // at module load to keep a hook process's log directory stable.
      setLogLevelFor('alpha', 'debug');
      setLogLevelFor('beta', 'error');

      process.env['CLAUDE_PLUGIN_NAME'] = 'alpha';
      expect(getHookEnvironment().logLevel).toBe('debug');

      process.env['CLAUDE_PLUGIN_NAME'] = 'beta';
      expect(getHookEnvironment().logLevel).toBe('error');
    });

    it('should fall back to "plugin" when CLAUDE_PLUGIN_NAME is unset', () => {
      delete process.env['CLAUDE_PLUGIN_NAME'];
      setLogLevelFor('plugin', 'error');
      expect(getHookEnvironment().logLevel).toBe('error');
    });
  });
});
