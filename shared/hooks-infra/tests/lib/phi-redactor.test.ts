/**
 * Tests for phi-redactor lib.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_PHI_PATTERNS, luhn, redactPhi } from '../../src/lib/phi-redactor.js';

describe('redactPhi', () => {
  describe('SSN pattern', () => {
    it('redacts a standalone SSN', () => {
      const result = redactPhi('Patient SSN: 123-45-6789 confirmed.');
      expect(result.text).toBe('Patient SSN: [SSN-REDACTED] confirmed.');
      expect(result.matchedPatterns).toContain('ssn-dashed');
      expect(result.totalSubstitutions).toBe(1);
    });

    it('redacts multiple SSNs in one message', () => {
      const result = redactPhi('First: 111-22-3333. Second: 444-55-6666.');
      expect(result.text).toBe('First: [SSN-REDACTED]. Second: [SSN-REDACTED].');
      expect(result.totalSubstitutions).toBe(2);
    });

    it('does NOT redact 9 plain digits (could be timestamp/ID)', () => {
      const result = redactPhi('Request ID: 123456789 succeeded.');
      expect(result.text).toBe('Request ID: 123456789 succeeded.');
      expect(result.totalSubstitutions).toBe(0);
    });
  });

  describe('US phone pattern', () => {
    it('redacts (###) ###-#### format', () => {
      const result = redactPhi('Call (555) 123-4567 for help.');
      expect(result.text).toBe('Call [PHONE-REDACTED] for help.');
    });

    it('redacts ###-###-#### format', () => {
      const result = redactPhi('Phone: 555-123-4567');
      expect(result.text).toBe('Phone: [PHONE-REDACTED]');
    });

    it('does NOT redact a single 3-digit token (e.g. error code)', () => {
      const result = redactPhi('HTTP 404 error');
      expect(result.text).toBe('HTTP 404 error');
      expect(result.totalSubstitutions).toBe(0);
    });
  });

  describe('credit card pattern', () => {
    it('redacts space-separated CC number', () => {
      const result = redactPhi('Card: 4111 1111 1111 1111 charged.');
      expect(result.text).toBe('Card: [CC-REDACTED] charged.');
    });

    it('redacts dash-separated CC number', () => {
      const result = redactPhi('Card: 4111-1111-1111-1111');
      expect(result.text).toBe('Card: [CC-REDACTED]');
    });
  });

  describe('mixed and pass-through cases', () => {
    it('returns input unchanged when nothing matches', () => {
      const input = 'No sensitive data here at all.';
      const result = redactPhi(input);
      expect(result.text).toBe(input);
      expect(result.totalSubstitutions).toBe(0);
      expect(result.matchedPatterns).toEqual([]);
    });

    it('handles empty string gracefully', () => {
      const result = redactPhi('');
      expect(result.text).toBe('');
      expect(result.totalSubstitutions).toBe(0);
    });

    it('redacts mixed patterns in one pass', () => {
      const result = redactPhi(
        'Patient 123-45-6789 reached at (555) 123-4567.'
      );
      expect(result.text).toBe(
        'Patient [SSN-REDACTED] reached at [PHONE-REDACTED].'
      );
      expect(result.totalSubstitutions).toBe(2);
      expect(result.matchedPatterns).toEqual(
        expect.arrayContaining(['ssn-dashed', 'us-phone-parens'])
      );
    });

    it('is idempotent — running twice does not double-redact', () => {
      const once = redactPhi('SSN 123-45-6789');
      const twice = redactPhi(once.text);
      expect(twice.text).toBe(once.text);
      expect(twice.totalSubstitutions).toBe(0);
    });

    it('handles repeated calls safely (regex lastIndex reset)', () => {
      const input = 'SSN 123-45-6789 here.';
      for (let i = 0; i < 3; i++) {
        const r = redactPhi(input);
        expect(r.totalSubstitutions).toBe(1);
      }
    });
  });

  describe('false-positive guards', () => {
    it('does NOT match ISO timestamps as dates', () => {
      const input = 'Event at 2026-05-27 14:30:00 UTC';
      const result = redactPhi(input);
      expect(result.text).toBe(input);
    });

    it('does NOT match version strings', () => {
      const input = 'Release v2.1.152 shipped';
      const result = redactPhi(input);
      expect(result.text).toBe(input);
    });

    it('does NOT match commit emails (no email pattern by design)', () => {
      const input = 'See commit by alice@example.com';
      const result = redactPhi(input);
      expect(result.text).toBe(input);
    });
  });

  describe('custom pattern injection', () => {
    it('accepts a custom pattern set', () => {
      const custom = [
        {
          id: 'fake-id',
          regex: /MRN-\d{5}/g,
          replacement: '[MRN-REDACTED]',
        },
      ];
      const result = redactPhi('Patient MRN-12345 admitted.', custom);
      expect(result.text).toBe('Patient [MRN-REDACTED] admitted.');
      expect(result.matchedPatterns).toEqual(['fake-id']);
    });

    it('default pattern list has at least 4 entries', () => {
      expect(DEFAULT_PHI_PATTERNS.length).toBeGreaterThanOrEqual(4);
    });
  });
});

describe('luhn gating (precision) — added by adversarial review of #56', () => {
  it('leaves a grouped non-card number alone', () => {
    // Was redacted as [CC-REDACTED] before the Luhn gate: nothing in the regex
    // separates a build id from a card, but a checksum does.
    for (const text of ['build 1234-5678-9012-3456', 'key 9999 8888 7777 6666']) {
      const r = redactPhi(text);
      expect(r.text, text).toBe(text);
      expect(r.totalSubstitutions, text).toBe(0);
    }
  });

  it('is a filter, not a proof — a Luhn-valid non-card is still redacted', () => {
    // Roughly 1 grouped 16-digit number in 10 passes Luhn by chance, and my
    // first draft of the test above used one of them ('1111 2222 3333 4444')
    // as a supposed negative. Pinning the real behaviour rather than the
    // behaviour I assumed: the gate raises precision, it does not guarantee it.
    expect(redactPhi('key 1111 2222 3333 4444').text).toContain('[CC-REDACTED]');
  });

  it('still redacts a Luhn-valid card, formatted or plain', () => {
    // 4111-1111-1111-1111 is the standard test card and IS Luhn-valid, so the
    // gate does not rescue it — by design.
    for (const text of ['card 4111 1111 1111 1111', 'card 4111-1111-1111-1111', 'card 4111111111111111']) {
      const r = redactPhi(text);
      expect(r.text, text).toContain('[CC-REDACTED]');
      expect(r.matchedPatterns.length, text).toBeGreaterThan(0);
    }
  });

  it('closes the unseparated-card recall gap without matching long ids', () => {
    expect(redactPhi('id 1234567890123456').totalSubstitutions).toBe(0);
    expect(redactPhi('pan 4111111111111111').text).toContain('[CC-REDACTED]');
  });

  it('counts only substitutions actually applied, never vetoed matches', () => {
    // The tally feeds the hook's "Redacted N match(es)" log line. Counting
    // matches rather than substitutions would assert redactions that a
    // validate() veto prevented — the exact class this release removes.
    const r = redactPhi('build 1234-5678-9012-3456 and card 4111-1111-1111-1111');

    expect(r.totalSubstitutions).toBe(1);
    expect(r.text).toContain('1234-5678-9012-3456');
    expect(r.text).toContain('[CC-REDACTED]');
  });
});

describe('non-string input fails closed', () => {
  it('does not throw, and never returns a value it did not inspect', () => {
    // Previously: `current.match is not a function` for number/object/array,
    // and redactPhi(null).text === null while the type says string.
    for (const bad of [null, undefined, 123, {}, [], true]) {
      const r = redactPhi(bad as unknown as string);

      expect(typeof r.text, String(bad)).toBe('string');
      expect(r.text, String(bad)).toBe('');
      expect(r.totalSubstitutions, String(bad)).toBe(0);
    }
  });

  it('still passes an empty string through unchanged', () => {
    expect(redactPhi('').text).toBe('');
  });
});

describe('luhn', () => {
  it('accepts known-valid card numbers', () => {
    for (const n of ['4111111111111111', '5500005555555559', '378282246310005']) {
      expect(luhn(n), n).toBe(true);
    }
  });

  it('rejects a transposed digit and out-of-range lengths', () => {
    expect(luhn('4111111111111112')).toBe(false);
    expect(luhn('123456789012')).toBe(false);
    expect(luhn('12345678901234567890')).toBe(false);
  });
});
