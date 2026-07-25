/**
 * Tests for secret-detector PostToolUse hook
 *
 * These tests verify that the hook correctly:
 * - Exports SECRET_PATTERNS array
 * - Detects all secret pattern types (AWS, Anthropic, JWT, etc.)
 * - Avoids false positives
 * - Handles guard conditions (non-Bash, empty command, no output)
 * - Respects size limits
 * - Returns correct result structure
 *
 * @module tests/posttool/secret-detector
 */

import { describe, expect, it } from 'vitest';
import {
  SECRET_PATTERNS,
  scanForSecrets,
  secretDetector,
} from '../../src/posttool/secret-detector.js';
import type { HookInput } from '../../src/types.js';

// =============================================================================
// TEST HELPERS
// =============================================================================

interface PostToolUseInput extends HookInput {
  tool_response?: {
    stdout?: string;
    stderr?: string;
    exit_code?: number;
    output?: string;
  };
}

function createBashOutputInput(
  command: string,
  stdout: string,
  options?: { stderr?: string; exit_code?: number }
): PostToolUseInput {
  return {
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: {
      stdout,
      stderr: options?.stderr,
      exit_code: options?.exit_code ?? 0,
    },
  };
}

function createBashNoOutputInput(command: string): HookInput {
  return {
    tool_name: 'Bash',
    tool_input: { command },
  };
}

// =============================================================================
// PATTERN EXPORT TESTS
// =============================================================================

describe('SECRET_PATTERNS export', () => {
  it('should export SECRET_PATTERNS array', () => {
    expect(Array.isArray(SECRET_PATTERNS)).toBe(true);
    expect(SECRET_PATTERNS.length).toBeGreaterThan(0);
  });

  it('each pattern should have type and pattern fields', () => {
    for (const entry of SECRET_PATTERNS) {
      expect(typeof entry.type).toBe('string');
      expect(entry.pattern).toBeInstanceOf(RegExp);
    }
  });
});

// =============================================================================
// scanForSecrets UNIT TESTS
// =============================================================================

// Real-looking fixtures built from split literals so this test file's own
// content never trips the pre-write secret gate. The canonical AWS doc
// keys (AKIA…EXAMPLE) are allowlisted and tested separately below.
const REAL_LOOKING_AWS_ACCESS_KEY = `AKIA${'IOSFODNN7QWERTY0'}`;
const REAL_LOOKING_AWS_SECRET_KEY = `wJalrXUtnFEMI/K7MDENG/${'bPxRfiCYTESTKEY123'}`;
const EXAMPLE_AWS_ACCESS_KEY = `AKIA${'IOSFODNN7EXAMPLE'}`;
const EXAMPLE_AWS_SECRET_KEY = `wJalrXUtnFEMI/K7MDENG/${'bPxRfiCYEXAMPLEKEY'}`;

describe('scanForSecrets', () => {
  describe('AWS Access Key ID', () => {
    it('should detect AKIA key', () => {
      const result = scanForSecrets(`AWS_ACCESS_KEY_ID=${REAL_LOOKING_AWS_ACCESS_KEY}`);
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('AWS Access Key ID');
    });

    it('should not match short AKIA prefix', () => {
      const result = scanForSecrets('AKIA12345');
      expect(result.secretTypes).not.toContain('AWS Access Key ID');
    });
  });

  describe('AWS Secret Access Key', () => {
    it('should detect aws_secret_access_key with = separator', () => {
      const result = scanForSecrets(`aws_secret_access_key=${REAL_LOOKING_AWS_SECRET_KEY}`);
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('AWS Secret Access Key');
    });

    it('should detect AWS_SECRET_ACCESS_KEY with : separator', () => {
      const result = scanForSecrets(`AWS_SECRET_ACCESS_KEY: ${REAL_LOOKING_AWS_SECRET_KEY}`);
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('AWS Secret Access Key');
    });

    it('should not match short values', () => {
      const result = scanForSecrets('aws_secret_access_key=short');
      expect(result.secretTypes).not.toContain('AWS Secret Access Key');
    });
  });

  describe('example-key allowlist (review !207 #2)', () => {
    it('does NOT flag the canonical AWS doc access key', () => {
      const result = scanForSecrets(`AWS_ACCESS_KEY_ID=${EXAMPLE_AWS_ACCESS_KEY}`);
      expect(result.secretTypes).not.toContain('AWS Access Key ID');
    });

    it('does NOT flag the canonical AWS doc secret key', () => {
      const result = scanForSecrets(`aws_secret_access_key=${EXAMPLE_AWS_SECRET_KEY}`);
      expect(result.secretTypes).not.toContain('AWS Secret Access Key');
    });

    it('still flags a real-looking key sitting NEXT TO an allowlisted example', () => {
      const text = [
        `AWS_ACCESS_KEY_ID=${EXAMPLE_AWS_ACCESS_KEY}`,
        `AWS_ACCESS_KEY_ID=${REAL_LOOKING_AWS_ACCESS_KEY}`,
      ].join('\n');
      const result = scanForSecrets(text);
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('AWS Access Key ID');
    });
  });

  describe('AWS Session Token', () => {
    it('should detect long session token', () => {
      const longToken = 'A'.repeat(150);
      const result = scanForSecrets(`aws_session_token=${longToken}`);
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('AWS Session Token');
    });

    it('should detect AWS_SESSION_TOKEN env var', () => {
      const longToken = `FwoGZXIvYXdzEBYaDH${'A'.repeat(100)}`;
      const result = scanForSecrets(`AWS_SESSION_TOKEN=${longToken}`);
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('AWS Session Token');
    });
  });

  describe('Anthropic API Key', () => {
    it('should detect sk-ant- prefix key', () => {
      const result = scanForSecrets('ANTHROPIC_API_KEY=sk-ant-' + 'api03-abc123def456ghi789');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Anthropic API Key');
    });

    it('should not match short sk-ant- key', () => {
      const result = scanForSecrets('sk-ant-short');
      expect(result.secretTypes).not.toContain('Anthropic API Key');
    });
  });

  describe('Private Key', () => {
    it('should detect RSA private key header', () => {
      const result = scanForSecrets('-----BEGIN RSA PRIVATE KEY-----');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Private Key');
    });

    it('should detect EC private key header', () => {
      const result = scanForSecrets('-----BEGIN EC PRIVATE KEY-----');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Private Key');
    });

    it('should detect generic PRIVATE KEY header', () => {
      const result = scanForSecrets('-----BEGIN PRIVATE KEY-----');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Private Key');
    });

    it('should not match public key header', () => {
      const result = scanForSecrets('-----BEGIN PUBLIC KEY-----');
      expect(result.secretTypes).not.toContain('Private Key');
    });
  });

  describe('JWT Token', () => {
    it('should detect JWT token', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const result = scanForSecrets(jwt);
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('JWT Token');
    });

    it('should not match partial JWT', () => {
      const result = scanForSecrets('eyJhbGci.eyJzdWI.short');
      expect(result.secretTypes).not.toContain('JWT Token');
    });
  });

  describe('Database Connection String', () => {
    it('should detect postgresql connection string', () => {
      const result = scanForSecrets('postgresql://admin:s3cret@localhost:5432/db');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Database Connection String');
    });

    it('should detect mysql connection string', () => {
      const result = scanForSecrets('mysql://root:password@db.example.com:3306/mydb');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Database Connection String');
    });

    it('should detect mongodb connection string', () => {
      const result = scanForSecrets('mongodb://user:pass@mongo.example.com:27017/test');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Database Connection String');
    });

    it('should detect redis connection string', () => {
      const result = scanForSecrets('redis://default:mypassword@redis.example.com:6379');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Database Connection String');
    });

    it('should not match URL without credentials', () => {
      const result = scanForSecrets('postgresql://localhost:5432/db');
      expect(result.secretTypes).not.toContain('Database Connection String');
    });
  });

  describe('Bearer Token', () => {
    it('should detect Bearer token', () => {
      const result = scanForSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Bearer Token');
    });

    it('should not match short Bearer value', () => {
      const result = scanForSecrets('Bearer short');
      expect(result.secretTypes).not.toContain('Bearer Token');
    });
  });

  describe('Secret Key-Value pairs', () => {
    it('should detect password=value', () => {
      const result = scanForSecrets('password=mysecretpassword123');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Secret Key-Value');
    });

    it('should detect api_key=value', () => {
      const result = scanForSecrets('api_key=abcdefghijklmnop');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Secret Key-Value');
    });

    it('should detect SECRET=value (case insensitive)', () => {
      const result = scanForSecrets('SECRET=longvaluehere12');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Secret Key-Value');
    });

    it('should not match short values', () => {
      const result = scanForSecrets('password=short');
      expect(result.secretTypes).not.toContain('Secret Key-Value');
    });
  });

  describe('GitHub Token', () => {
    it('should detect ghp_ personal access token', () => {
      const result = scanForSecrets('ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('GitHub Token');
    });

    it('should detect gho_ OAuth token', () => {
      const result = scanForSecrets('gho_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('GitHub Token');
    });

    it('should not match short gh token', () => {
      const result = scanForSecrets('ghp_short');
      expect(result.secretTypes).not.toContain('GitHub Token');
    });
  });

  describe('Slack Token', () => {
    it('should detect xoxb- bot token', () => {
      const result = scanForSecrets('xoxb-' + '123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUv');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Slack Token');
    });

    it('should detect xoxp- user token', () => {
      const result = scanForSecrets('xoxp-' + '123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUv');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Slack Token');
    });
  });

  describe('OpenAI API Key', () => {
    it('should detect sk- prefix key', () => {
      const result = scanForSecrets('OPENAI_API_KEY=sk-' + 'proj1234567890abcdefghij');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('OpenAI API Key');
    });

    it('should NOT match sk-ant- (Anthropic key)', () => {
      // sk-ant- should match Anthropic, not OpenAI
      const result = scanForSecrets('sk-ant-' + 'api03-abcdefghijklmnopqrst');
      expect(result.secretTypes).not.toContain('OpenAI API Key');
      expect(result.secretTypes).toContain('Anthropic API Key');
    });
  });

  describe('modernized patterns (audit P1)', () => {
    // Split literals keep this file's own content out of the pre-write gate.
    it('should detect GitLab glpat- token', () => {
      const result = scanForSecrets(`GITLAB_TOKEN=${'glpat-'}${'AbCdEf123456_-aBcDeF7890'}`);
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('GitLab Token');
    });

    it('should detect GitHub fine-grained github_pat_ token', () => {
      const result = scanForSecrets(`${'github_pat_'}${'11ABCDEFG0abcdefghijklmnopqrstuv'}`);
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('GitHub Fine-Grained Token');
    });

    it('should detect OpenAI sk-proj- key (hyphenated form)', () => {
      const result = scanForSecrets(`OPENAI_API_KEY=${'sk-proj-'}${'AbCd1234EfGh5678IjKl9012'}`);
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('OpenAI Project Key');
    });

    it('should detect Slack xapp- app-level token', () => {
      const result = scanForSecrets(`${'xapp-'}${'1-A0123456789-1234567890123-abcdef'}`);
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Slack App Token');
    });

    it('should detect PGP private key armor header', () => {
      const result = scanForSecrets('-----BEGIN PGP PRIVATE KEY BLOCK-----');
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Private Key');
    });

    it('should detect double-quoted password value', () => {
      const result = scanForSecrets(`password="${'hunter2hunter2'}"`);
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Secret Key-Value');
    });

    it('should detect single-quoted api_key value', () => {
      const result = scanForSecrets(`api_key='${'AbCd1234EfGh5678'}'`);
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('Secret Key-Value');
    });

    it('should NOT flag quoted prose mentioning passwords', () => {
      const result = scanForSecrets('password: "use a strong password here"');
      expect(result.secretTypes).not.toContain('Secret Key-Value');
    });
  });

  describe('clean output', () => {
    it('should not detect secrets in clean output', () => {
      const result = scanForSecrets('Hello world\nnpm test passed\nAll 42 tests passed');
      expect(result.detected).toBe(false);
      expect(result.secretTypes).toHaveLength(0);
    });

    it('should not detect secrets in typical build output', () => {
      const result = scanForSecrets(
        'Compiling TypeScript...\n✓ 25 modules transformed.\ndist/index.js  4.2kB\nBuild complete.'
      );
      expect(result.detected).toBe(false);
      expect(result.secretTypes).toHaveLength(0);
    });
  });

  describe('multiple secrets', () => {
    it('should detect multiple secret types in one output', () => {
      const output = [
        `AWS_ACCESS_KEY_ID=${REAL_LOOKING_AWS_ACCESS_KEY}`,
        `aws_secret_access_key=${REAL_LOOKING_AWS_SECRET_KEY}`,
        'ANTHROPIC_API_KEY=sk-ant-' + 'api03-abcdefghijklmnopqrstuvwxyz',
      ].join('\n');

      const result = scanForSecrets(output);
      expect(result.detected).toBe(true);
      expect(result.secretTypes).toContain('AWS Access Key ID');
      expect(result.secretTypes).toContain('AWS Secret Access Key');
      expect(result.secretTypes).toContain('Anthropic API Key');
    });
  });
});

// =============================================================================
// secretDetector INTEGRATION TESTS
// =============================================================================

describe('secretDetector', () => {
  describe('guards', () => {
    it('should skip non-Bash tools', async () => {
      const input: HookInput = {
        tool_name: 'Write',
        tool_input: { file_path: 'test.ts' },
      };
      const result = await secretDetector(input);
      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should skip empty command', async () => {
      const input: HookInput = {
        tool_name: 'Bash',
        tool_input: {},
      };
      const result = await secretDetector(input);
      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('no output', () => {
    it('should return silent success when no tool_response', async () => {
      const input = createBashNoOutputInput('echo hello');
      const result = await secretDetector(input);
      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should return silent success when output is empty', async () => {
      const input = createBashOutputInput('echo hello', '');
      const result = await secretDetector(input);
      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('clean output', () => {
    it('should return silent success for clean output', async () => {
      const input = createBashOutputInput('npm test', 'All tests passed\n42 passing');
      const result = await secretDetector(input);
      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('secret detection', () => {
    it('should warn when AWS key is in output', async () => {
      const input = createBashOutputInput(
        'cat config',
        `AWS_ACCESS_KEY_ID=${REAL_LOOKING_AWS_ACCESS_KEY}\nother stuff`
      );
      const result = await secretDetector(input);

      expect(result.continue).toBe(true);
      expect(result.systemMessage).toContain('Potential secrets detected');
      expect(result.systemMessage).toContain('AWS Access Key ID');
      expect(result.hookSpecificOutput?.additionalContext).toContain('DO NOT repeat');
    });

    it('should warn when private key is in output', async () => {
      const input = createBashOutputInput(
        'cat key.pem',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...'
      );
      const result = await secretDetector(input);

      expect(result.continue).toBe(true);
      expect(result.systemMessage).toContain('Private Key');
      expect(result.hookSpecificOutput?.additionalContext).toContain('DO NOT repeat');
    });

    it('should detect secrets in stderr as well', async () => {
      const input = createBashOutputInput('some-cmd', '', {
        stderr: 'Error: ANTHROPIC_API_KEY=sk-ant-' + 'api03-abcdefghijklmnopqrstuvwxyz not valid',
      });
      const result = await secretDetector(input);

      expect(result.continue).toBe(true);
      expect(result.systemMessage).toContain('Anthropic API Key');
    });
  });

  describe('size limit', () => {
    it('should skip output larger than 50KB', async () => {
      const largeOutput = 'x'.repeat(60 * 1024);
      const input = createBashOutputInput('cat bigfile', largeOutput);
      const result = await secretDetector(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.systemMessage).toBeUndefined();
    });
  });

  describe('result structure', () => {
    it('should return correct structure for detection', async () => {
      const input = createBashOutputInput('printenv', REAL_LOOKING_AWS_ACCESS_KEY);
      const result = await secretDetector(input);

      expect(result).toMatchObject({
        continue: true,
        systemMessage: expect.stringContaining('AWS Access Key ID'),
        hookSpecificOutput: {
          additionalContext: expect.stringContaining('DO NOT repeat'),
        },
      });
    });

    it('should produce valid JSON when stringified', async () => {
      const input = createBashOutputInput('printenv', REAL_LOOKING_AWS_ACCESS_KEY);
      const result = await secretDetector(input);

      expect(() => JSON.stringify(result)).not.toThrow();
      const parsed = JSON.parse(JSON.stringify(result));
      expect(parsed.continue).toBe(true);
      expect(typeof parsed.systemMessage).toBe('string');
    });
  });
});
