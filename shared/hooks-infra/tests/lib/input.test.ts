/**
 * Tests for input parsing library
 *
 * @module tests/lib/input
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAgentId,
  getAgentType,
  getCommand,
  getContent,
  getDurationMs,
  getField,
  getFilePath,
  getNewString,
  getOldString,
  getPattern,
  getProjectDir,
  getSessionId,
  getToolInput,
  getToolName,
  parseHookInput,
} from '../../src/lib/input.js';
import type { HookInput } from '../../src/types.js';

// Inherited-env runners (e.g., Claude Code itself) export
// CLAUDE_CODE_SESSION_ID. The session-id resolver prefers env over the
// 'unknown' fallback, so tests asserting 'unknown' must clear both vars.
const ORIGINAL_CC_SESSION_ID = process.env['CLAUDE_CODE_SESSION_ID'];
const ORIGINAL_SESSION_ID = process.env['CLAUDE_SESSION_ID'];

beforeEach(() => {
  delete process.env['CLAUDE_CODE_SESSION_ID'];
  delete process.env['CLAUDE_SESSION_ID'];
});

afterEach(() => {
  if (ORIGINAL_CC_SESSION_ID !== undefined) {
    process.env['CLAUDE_CODE_SESSION_ID'] = ORIGINAL_CC_SESSION_ID;
  }
  if (ORIGINAL_SESSION_ID !== undefined) {
    process.env['CLAUDE_SESSION_ID'] = ORIGINAL_SESSION_ID;
  }
});

describe('parseHookInput', () => {
  describe('valid inputs', () => {
    it('should parse valid Bash tool input', () => {
      const json = '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}';
      const result = parseHookInput(json);

      expect(result).not.toBeNull();
      expect(result?.tool_name).toBe('Bash');
      expect(result?.tool_input.command).toBe('ls -la');
    });

    it('should parse valid Write tool input', () => {
      const json =
        '{"tool_name":"Write","tool_input":{"file_path":"/path/to/file.ts","content":"hello"}}';
      const result = parseHookInput(json);

      expect(result).not.toBeNull();
      expect(result?.tool_name).toBe('Write');
      expect(result?.tool_input.file_path).toBe('/path/to/file.ts');
      expect(result?.tool_input.content).toBe('hello');
    });

    it('should parse valid Edit tool input', () => {
      const json =
        '{"tool_name":"Edit","tool_input":{"file_path":"/file.ts","old_string":"foo","new_string":"bar"}}';
      const result = parseHookInput(json);

      expect(result).not.toBeNull();
      expect(result?.tool_name).toBe('Edit');
      expect(result?.tool_input.old_string).toBe('foo');
      expect(result?.tool_input.new_string).toBe('bar');
    });

    it('should parse input with session_id', () => {
      const json =
        '{"tool_name":"Read","tool_input":{"file_path":"/file.ts"},"session_id":"abc123"}';
      const result = parseHookInput(json);

      expect(result).not.toBeNull();
      expect(result?.session_id).toBe('abc123');
    });

    it('should parse all valid tool names', () => {
      const toolNames = [
        'Bash',
        'Write',
        'Edit',
        'MultiEdit',
        'Read',
        'Glob',
        'Grep',
        'Task',
        'TodoWrite',
        'TodoRead',
      ];

      for (const toolName of toolNames) {
        const json = `{"tool_name":"${toolName}","tool_input":{}}`;
        const result = parseHookInput(json);
        expect(result).not.toBeNull();
        expect(result?.tool_name).toBe(toolName);
      }
    });
  });

  describe('invalid inputs - graceful fallback (never returns null)', () => {
    // New behavior: parseHookInput never returns null, always returns valid default
    // Graceful fallback: always returns a valid default input

    it('should return default input for empty string', () => {
      const result = parseHookInput('');
      expect(result).not.toBeNull();
      expect(result.tool_name).toBe('');
      expect(result.tool_input).toEqual({});
    });

    it('should return default input for whitespace-only string', () => {
      const result1 = parseHookInput('   ');
      expect(result1.tool_name).toBe('');

      const result2 = parseHookInput('\n\t');
      expect(result2.tool_name).toBe('');
    });

    it('should return default input for malformed JSON', () => {
      expect(parseHookInput('{').tool_name).toBe('');
      expect(parseHookInput('{"tool_name":').tool_name).toBe('');
      expect(parseHookInput('not json').tool_name).toBe('');
    });

    it('should return default input for missing tool_name', () => {
      const result = parseHookInput('{"tool_input":{}}');
      expect(result.tool_name).toBe('');
    });

    it('should preserve invalid tool_name for hooks to handle', () => {
      // Invalid tool names are preserved - hooks can decide what to do
      const result = parseHookInput('{"tool_name":"InvalidTool","tool_input":{}}');
      expect(result.tool_name).toBe('InvalidTool');
    });

    it('should return default for empty or non-string tool_name', () => {
      expect(parseHookInput('{"tool_name":"","tool_input":{}}').tool_name).toBe('');
      expect(parseHookInput('{"tool_name":123,"tool_input":{}}').tool_name).toBe('');
    });

    it('should provide default tool_input when missing', () => {
      // For tool events, tool_input is normalized to empty object if missing
      const result = parseHookInput('{"tool_name":"Bash"}');
      expect(result.tool_input).toEqual({});
    });

    it('should provide default for non-object tool_input', () => {
      expect(parseHookInput('{"tool_name":"Bash","tool_input":"string"}').tool_input).toEqual({});
      expect(parseHookInput('{"tool_name":"Bash","tool_input":123}').tool_input).toEqual({});
      expect(parseHookInput('{"tool_name":"Bash","tool_input":null}').tool_input).toEqual({});
    });

    it('should use default session_id for non-string session_id', () => {
      const result = parseHookInput('{"tool_name":"Bash","tool_input":{},"session_id":123}');
      expect(result.session_id).toBe('unknown');
    });

    it('should return default input for array input', () => {
      const result = parseHookInput('[]');
      expect(result.tool_name).toBe('');
    });

    it('should return default input for primitive values', () => {
      expect(parseHookInput('null').tool_name).toBe('');
      expect(parseHookInput('123').tool_name).toBe('');
      expect(parseHookInput('"string"').tool_name).toBe('');
      expect(parseHookInput('true').tool_name).toBe('');
    });
  });

  describe('hook_event_name normalization (Claude Code compatibility)', () => {
    it('should normalize hook_event_name to tool_name for SessionStart', () => {
      const json = '{"hook_event_name":"SessionStart","source":"startup","session_id":"abc"}';
      const result = parseHookInput(json);

      expect(result.tool_name).toBe('SessionStart');
      expect(result.session_id).toBe('abc');
    });

    it('should preserve source field for lifecycle events', () => {
      const json = '{"hook_event_name":"SessionStart","source":"resume"}';
      const result = parseHookInput(json);

      expect(result.tool_name).toBe('SessionStart');
      expect((result as Record<string, unknown>)['source']).toBe('resume');
    });

    it('should prefer tool_name over hook_event_name when both present', () => {
      const json =
        '{"tool_name":"Bash","hook_event_name":"SessionStart","tool_input":{"command":"ls"}}';
      const result = parseHookInput(json);

      expect(result.tool_name).toBe('Bash');
    });
  });

  // Regression: ctk 2.8.4 corrected the agent-team handlers to read
  // teammate_name/team_name, but normalizeInput's passThrough allowlist did not
  // include those names -- so they were stripped before any handler saw them and
  // every idle still logged "unknown". The 2.8.4 verification checked WHAT CC
  // SENDS (binary strings, live probe, message envelope) but never that the field
  // survived our own normalizer. These assertions pin the data flow, not the name.
  describe('agent-team field passthrough (2.8.5 regression)', () => {
    // Captured verbatim from a real TeammateIdle payload, 2026-07-25.
    const REAL_TEAMMATE_IDLE_PAYLOAD =
      '{"session_id":"a5f8a1c4","transcript_path":"/tmp/t.jsonl","cwd":"/repo",' +
      '"permission_mode":"auto","hook_event_name":"TeammateIdle",' +
      '"teammate_name":"r1-probe-C","team_name":"session-9d7a8f62"}';

    it('should preserve teammate_name and team_name from a real TeammateIdle payload', () => {
      const result = parseHookInput(REAL_TEAMMATE_IDLE_PAYLOAD) as Record<string, unknown>;

      expect(result['teammate_name']).toBe('r1-probe-C');
      expect(result['team_name']).toBe('session-9d7a8f62');
    });

    it('should NOT silently coerce a present teammate_name into undefined', () => {
      // The exact failure shape: handlers do `input.teammate_name || 'unknown'`,
      // so a dropped field degrades to a plausible default instead of throwing.
      const result = parseHookInput(REAL_TEAMMATE_IDLE_PAYLOAD) as Record<string, unknown>;

      expect(result['teammate_name']).toBeDefined();
      expect(result['teammate_name']).not.toBe('unknown');
    });

    it('should preserve task_id, task_subject and task_description for Task* events', () => {
      const json =
        '{"hook_event_name":"TaskCreated","task_id":"t-42","task_subject":"Fix login",' +
        '"task_description":"Users cannot log in","teammate_name":"builder","team_name":"team-1"}';
      const result = parseHookInput(json) as Record<string, unknown>;

      expect(result['task_id']).toBe('t-42');
      expect(result['task_subject']).toBe('Fix login');
      expect(result['task_description']).toBe('Users cannot log in');
      expect(result['teammate_name']).toBe('builder');
    });

    it('should still pass through legacy agent_id/agent_type when an event sends them', () => {
      const json = '{"hook_event_name":"SubagentStop","agent_id":"a-1","agent_type":"general"}';
      const result = parseHookInput(json) as Record<string, unknown>;

      expect(result['agent_id']).toBe('a-1');
      expect(result['agent_type']).toBe('general');
    });
  });
});

describe('getToolName', () => {
  it('should extract tool name', () => {
    const input: HookInput = { tool_name: 'Bash', tool_input: {} };
    expect(getToolName(input)).toBe('Bash');
  });
});

describe('getFilePath', () => {
  it('should extract file_path', () => {
    const input: HookInput = { tool_name: 'Write', tool_input: { file_path: '/path/to/file.ts' } };
    expect(getFilePath(input)).toBe('/path/to/file.ts');
  });

  it('should fall back to path field', () => {
    const input: HookInput = { tool_name: 'Glob', tool_input: { path: '/search/dir' } };
    expect(getFilePath(input)).toBe('/search/dir');
  });

  it('should prefer file_path over path', () => {
    const input: HookInput = {
      tool_name: 'Read',
      tool_input: { file_path: '/preferred/path.ts', path: '/fallback/path' },
    };
    expect(getFilePath(input)).toBe('/preferred/path.ts');
  });

  it('should return undefined when no path present', () => {
    const input: HookInput = { tool_name: 'Bash', tool_input: { command: 'ls' } };
    expect(getFilePath(input)).toBeUndefined();
  });

  it('should return undefined for empty file_path', () => {
    const input: HookInput = { tool_name: 'Write', tool_input: { file_path: '' } };
    expect(getFilePath(input)).toBeUndefined();
  });
});

describe('getCommand', () => {
  it('should extract command', () => {
    const input: HookInput = { tool_name: 'Bash', tool_input: { command: 'git status' } };
    expect(getCommand(input)).toBe('git status');
  });

  it('should return undefined when no command present', () => {
    const input: HookInput = { tool_name: 'Write', tool_input: { file_path: '/file.ts' } };
    expect(getCommand(input)).toBeUndefined();
  });

  it('should return empty string command', () => {
    const input: HookInput = { tool_name: 'Bash', tool_input: { command: '' } };
    expect(getCommand(input)).toBe('');
  });
});

describe('getSessionId', () => {
  it('should extract session_id from input', () => {
    const input: HookInput = {
      tool_name: 'Bash',
      tool_input: {},
      session_id: 'session-123',
    };
    expect(getSessionId(input)).toBe('session-123');
  });

  it('should return unknown when no session_id', () => {
    const input: HookInput = { tool_name: 'Bash', tool_input: {} };
    expect(getSessionId(input)).toBe('unknown');
  });

  it('should return unknown for empty session_id', () => {
    const input: HookInput = { tool_name: 'Bash', tool_input: {}, session_id: '' };
    expect(getSessionId(input)).toBe('unknown');
  });
});

describe('getProjectDir', () => {
  it('should return process.cwd() when env not set', () => {
    const originalEnv = process.env['CLAUDE_PROJECT_DIR'];
    delete process.env['CLAUDE_PROJECT_DIR'];

    expect(getProjectDir()).toBe(process.cwd());

    if (originalEnv) {
      process.env['CLAUDE_PROJECT_DIR'] = originalEnv;
    }
  });
});

describe('getContent', () => {
  it('should extract content', () => {
    const input: HookInput = {
      tool_name: 'Write',
      tool_input: { file_path: '/file.ts', content: 'file content' },
    };
    expect(getContent(input)).toBe('file content');
  });

  it('should return undefined when no content', () => {
    const input: HookInput = { tool_name: 'Bash', tool_input: { command: 'ls' } };
    expect(getContent(input)).toBeUndefined();
  });
});

describe('getPattern', () => {
  it('should extract pattern', () => {
    const input: HookInput = {
      tool_name: 'Grep',
      tool_input: { pattern: 'search.*pattern' },
    };
    expect(getPattern(input)).toBe('search.*pattern');
  });

  it('should return undefined when no pattern', () => {
    const input: HookInput = { tool_name: 'Bash', tool_input: { command: 'ls' } };
    expect(getPattern(input)).toBeUndefined();
  });
});

describe('getOldString', () => {
  it('should extract old_string', () => {
    const input: HookInput = {
      tool_name: 'Edit',
      tool_input: { file_path: '/file.ts', old_string: 'old', new_string: 'new' },
    };
    expect(getOldString(input)).toBe('old');
  });

  it('should return undefined when no old_string', () => {
    const input: HookInput = { tool_name: 'Bash', tool_input: { command: 'ls' } };
    expect(getOldString(input)).toBeUndefined();
  });
});

describe('getNewString', () => {
  it('should extract new_string', () => {
    const input: HookInput = {
      tool_name: 'Edit',
      tool_input: { file_path: '/file.ts', old_string: 'old', new_string: 'new' },
    };
    expect(getNewString(input)).toBe('new');
  });

  it('should return undefined when no new_string', () => {
    const input: HookInput = { tool_name: 'Bash', tool_input: { command: 'ls' } };
    expect(getNewString(input)).toBeUndefined();
  });
});

describe('getField', () => {
  it('should extract arbitrary fields', () => {
    const input: HookInput = {
      tool_name: 'Bash',
      tool_input: { command: 'ls', timeout: 5000, description: 'list files' },
    };
    expect(getField<number>(input, 'timeout')).toBe(5000);
    expect(getField<string>(input, 'description')).toBe('list files');
  });

  it('should return undefined for non-existent fields', () => {
    const input: HookInput = { tool_name: 'Bash', tool_input: { command: 'ls' } };
    expect(getField(input, 'nonexistent')).toBeUndefined();
  });
});

describe('getToolInput', () => {
  it('should return the tool_input object', () => {
    const toolInput = { command: 'ls', timeout: 5000 };
    const input: HookInput = { tool_name: 'Bash', tool_input: toolInput };
    expect(getToolInput(input)).toBe(toolInput);
  });
});

describe('getAgentId', () => {
  it('should return agent_id when present', () => {
    const input: HookInput = {
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      agent_id: 'agent-abc-123',
    };
    expect(getAgentId(input)).toBe('agent-abc-123');
  });

  it('should return undefined when agent_id is not present', () => {
    const input: HookInput = { tool_name: 'Bash', tool_input: { command: 'ls' } };
    expect(getAgentId(input)).toBeUndefined();
  });

  it('should parse agent_id from JSON input via passthrough', () => {
    const json = '{"tool_name":"Bash","tool_input":{"command":"ls"},"agent_id":"sub-1"}';
    const input = parseHookInput(json);
    expect(getAgentId(input)).toBe('sub-1');
  });
});

describe('getAgentType', () => {
  it('should return agent_type when present', () => {
    const input: HookInput = {
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      agent_type: 'Explore',
    };
    expect(getAgentType(input)).toBe('Explore');
  });

  it('should return undefined when agent_type is not present', () => {
    const input: HookInput = { tool_name: 'Bash', tool_input: { command: 'ls' } };
    expect(getAgentType(input)).toBeUndefined();
  });

  it('should parse agent_type from JSON input via passthrough', () => {
    const json =
      '{"tool_name":"Bash","tool_input":{"command":"ls"},"agent_type":"security-reviewer"}';
    const input = parseHookInput(json);
    expect(getAgentType(input)).toBe('security-reviewer');
  });

  it('should parse both agent_id and agent_type together', () => {
    const json =
      '{"tool_name":"Bash","tool_input":{"command":"ls"},"agent_id":"a-1","agent_type":"Explore"}';
    const input = parseHookInput(json);
    expect(getAgentId(input)).toBe('a-1');
    expect(getAgentType(input)).toBe('Explore');
  });
});

describe('getDurationMs', () => {
  it('should return duration_ms when present', () => {
    const input: HookInput = {
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      duration_ms: 1234,
    };
    expect(getDurationMs(input)).toBe(1234);
  });

  it('should return undefined when duration_ms is not present (PreToolUse-style input)', () => {
    const input: HookInput = { tool_name: 'Bash', tool_input: { command: 'ls' } };
    expect(getDurationMs(input)).toBeUndefined();
  });

  it('should return 0 when duration_ms is exactly zero (instantaneous tool call)', () => {
    const input: HookInput = {
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/foo' },
      duration_ms: 0,
    };
    expect(getDurationMs(input)).toBe(0);
  });

  it('should parse duration_ms from JSON input via passthrough', () => {
    const json = '{"tool_name":"Bash","tool_input":{"command":"ls"},"duration_ms":5678}';
    const input = parseHookInput(json);
    expect(getDurationMs(input)).toBe(5678);
  });
});
