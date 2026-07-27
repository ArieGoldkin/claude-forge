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
 * This suite is IDENTITY-INDEPENDENT IN OUTCOME — the same assertions pass in
 * all six trees, so it needs no per-tree mapping table (logging.test.ts has one
 * because the logger captures CLAUDE_PLUGIN_NAME at module load, while
 * getHookEnvironment() reads it at call time).
 *
 * It is NOT identity-independent in DETECTION POWER, and that distinction is
 * load-bearing. The no-argument default tests below can only distinguish a
 * hardcoded default from the real captured name in a tree whose name differs
 * from the hardcoded one: mutating the default to `'plugin'` is an EQUIVALENT
 * MUTANT in shared/hooks-infra (which runs as 'plugin') while going red in every
 * plugin tree. Consequence: the CI `shared-tests` job alone cannot catch that
 * regression — only the per-plugin matrix can. Do not "simplify" CI on the
 * assumption that the shared run covers this file.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPluginName, logLevelEnvVarName, resolveLogLevel } from '../../src/lib/logging.js';
import { getHookEnvironment } from '../../src/types.js';

/**
 * The plugin name as it stood when the modules under test were imported.
 *
 * Captured at file scope, before any test mutates the environment, so it equals
 * the value lib/logging.ts captured into its module-level PLUGIN_NAME. This is
 * what lets the load-time-capture test below assert the invariant without
 * hardcoding a per-tree table.
 */
const LOAD_TIME_PLUGIN_NAME = process.env['CLAUDE_PLUGIN_NAME'] || 'plugin';

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

  it('should bind the default plugin name at module load, NOT at call time', () => {
    // Pins the invariant lib/logging.ts documents on its PLUGIN_NAME const: the
    // logger's identity is fixed for the lifetime of a hook process, which is
    // what keeps its log directory stable. Changing the default parameter to a
    // call-time `getPluginName()` reads identically in every other test in this
    // file — it was the one mutation the suite could not detect.
    process.env['CLAUDE_PLUGIN_NAME'] = 'a-different-plugin-entirely';

    expect(logLevelEnvVarName()).toBe(`${LOAD_TIME_PLUGIN_NAME.toUpperCase()}_LOG_LEVEL`);
    expect(resolveLogLevel()).toBe('warn');

    // ...while the call-time reader DOES observe the change. The divergence is
    // deliberate; asserting both halves is what makes it a contract rather than
    // an accident.
    expect(getPluginName()).toBe('a-different-plugin-entirely');
    expect(logLevelEnvVarName(getPluginName())).toBe('A-DIFFERENT-PLUGIN-ENTIRELY_LOG_LEVEL');
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
    // Only prototype keys that are ALREADY lower-case can reach the membership
    // test, because the value is lower-cased first. These two are the whole
    // reachable set, and each defeats the pre-#74 `in` check differently:
    //   constructor -> `in` true, indexes to the Object constructor (a function)
    //   __proto__   -> `in` true, indexes to Object.prototype (an object)
    // Neither is undefined. The damage is in shouldLog(), where `number >= fn`
    // and `number >= object` both coerce to NaN and compare false — silencing
    // every log line. Object.hasOwn is false for both.
    for (const key of ['constructor', '__proto__']) {
      setLogLevelFor('testplugin', key);
      expect(resolveLogLevel('testplugin')).toBe('warn');
    }
  });

  it('should reject mixed-case prototype keys via lower-casing, not via hasOwn', () => {
    // Kept to pin WHY these are safe, which is not the same reason as above:
    // `toString` arrives as `tostring`, which is not a key under either check.
    // An earlier version of this suite listed them alongside `constructor` as
    // if they exercised the prototype-chain fix. They never did.
    for (const key of ['toString', 'valueOf', 'hasOwnProperty']) {
      setLogLevelFor('testplugin', key);
      expect(resolveLogLevel('testplugin')).toBe('warn');
      expect(key.toLowerCase() in ({ debug: 0, info: 1, warn: 2, error: 3 } as const)).toBe(false);
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
