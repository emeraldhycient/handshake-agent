/**
 * Direct spec for the ledger's decimal codec pair — `toScaled` / `fromScaled`.
 *
 * These two functions are the arithmetic domain the whole money path shares: the
 * ledger builders, ProposalService/ExecutionService comparisons, and the velocity
 * counters (read and write) all convert through them. Until now they were only
 * exercised transitively through the entry builders, so a regression in the codec
 * itself could only be caught indirectly. These cases pin the codec on its own.
 *
 * The invariant that matters everywhere: `toScaled(fromScaled(x)) === x` for every
 * scaled bigint, so a value never drifts on the round trip. The other direction is
 * a canonicalizing projection rather than an identity — `fromScaled` emits one
 * canonical spelling per value, so `'1.50'` comes back as `'1.5'`. That is why the
 * money path compares scaled bigints and never the rendered strings; the
 * canonicalization cases below pin it explicitly.
 */

import { fromScaled, toScaled, LedgerError } from './ledger';

/** 10^18 — the scale factor, matching the Decimal(38,18) DB type. */
const SCALE = 10n ** 18n;

describe('ledger decimal codec', () => {
  describe('fromScaled', () => {
    it('renders zero as the bare integer "0"', () => {
      expect(fromScaled(0n)).toBe('0');
    });

    it('renders a whole number with no decimal point', () => {
      expect(fromScaled(SCALE)).toBe('1');
      expect(fromScaled(50_000n * SCALE)).toBe('50000');
    });

    it('renders the smallest representable unit (1e-18) at full precision', () => {
      expect(fromScaled(1n)).toBe('0.000000000000000001');
    });

    it('strips trailing zeros from the fractional part', () => {
      expect(fromScaled(SCALE / 2n)).toBe('0.5');
      expect(fromScaled(SCALE / 10n)).toBe('0.1');
      expect(fromScaled((SCALE * 3n) / 4n)).toBe('0.75');
    });

    it('keeps every significant fractional digit (no rounding to 2dp/6dp)', () => {
      expect(fromScaled(toScaled('999999.123456789012345678'))).toBe(
        '999999.123456789012345678',
      );
    });

    it('carries the sign onto negative values, whole and fractional', () => {
      expect(fromScaled(-SCALE)).toBe('-1');
      expect(fromScaled(-SCALE / 2n)).toBe('-0.5');
      expect(fromScaled(-1n)).toBe('-0.000000000000000001');
    });

    it('does not lose precision on wholes beyond Number.MAX_SAFE_INTEGER', () => {
      const huge = '123456789012345678901234';
      expect(fromScaled(BigInt(huge) * SCALE)).toBe(huge);
    });

    it('renders the largest sub-1 value at full precision', () => {
      expect(fromScaled(SCALE - 1n)).toBe('0.999999999999999999');
    });

    // The fraction is padded back out to 18 digits BEFORE trailing zeros are
    // stripped. Without that padding the leading zero is lost and 0.01 renders as
    // 0.1 — a 10× error. The all-nines case above cannot catch this (its remainder
    // is already 18 digits, so padding is a no-op there).
    it('pads a fraction with leading zeros back to its true magnitude', () => {
      expect(fromScaled(SCALE / 100n)).toBe('0.01');
      expect(fromScaled(45_000n * SCALE + SCALE / 20n)).toBe('45000.05');
    });
  });

  describe('toScaled', () => {
    it('scales an integer string by 10^18', () => {
      expect(toScaled('1')).toBe(SCALE);
      expect(toScaled('0')).toBe(0n);
    });

    it('pads a short fractional part out to 18 digits', () => {
      expect(toScaled('0.5')).toBe(SCALE / 2n);
      expect(toScaled('1.25')).toBe(SCALE + SCALE / 4n);
    });

    it('truncates (does not round) beyond 18 decimal places', () => {
      // 19 digits: the 19th is dropped, not rounded up.
      expect(toScaled('0.9999999999999999999')).toBe(SCALE - 1n);
    });

    it('accepts a leading minus and negates the scaled value', () => {
      expect(toScaled('-1')).toBe(-SCALE);
      expect(toScaled('-0.5')).toBe(-SCALE / 2n);
    });

    it('trims surrounding whitespace before parsing', () => {
      expect(toScaled('  1.5  ')).toBe(SCALE + SCALE / 2n);
    });

    it('throws LedgerError on a non-decimal string rather than coercing', () => {
      for (const bad of ['', 'abc', '1.2.3', '1e-18', '+1', '1,5', 'NaN']) {
        expect(() => toScaled(bad)).toThrow(LedgerError);
      }
    });
  });

  describe('round trip', () => {
    const canonical = [
      '0',
      '1',
      '0.5',
      '0.01',
      '1.25',
      '50000',
      '50000.5',
      '999999.123456',
      '0.000000000000000001',
      '-1',
      '-0.5',
      '-999999.123456789012345678',
    ];

    it.each(canonical)(
      'fromScaled(toScaled("%s")) returns the same canonical string',
      (value) => {
        expect(fromScaled(toScaled(value))).toBe(value);
      },
    );

    // The string direction is a projection onto one canonical spelling per value,
    // NOT an identity. These inputs are all valid and all representable in 18 dp,
    // and every one comes back spelled differently — which is exactly why the gate
    // and the ledger compare scaled bigints instead of strings.
    const nonCanonical: Array<[string, string]> = [
      ['1.50', '1.5'],
      ['0.10', '0.1'],
      ['50000.000000000000000000', '50000'],
      ['007', '7'],
      ['-0', '0'],
      ['  1.5  ', '1.5'],
    ];

    it.each(nonCanonical)(
      'canonicalizes "%s" to "%s" (round trip preserves the value, not the spelling)',
      (input, canonicalForm) => {
        expect(fromScaled(toScaled(input))).toBe(canonicalForm);
        // The value itself is untouched — both spellings scale to one bigint.
        expect(toScaled(input)).toBe(toScaled(canonicalForm));
      },
    );

    const scaledValues = [
      0n,
      1n,
      -1n,
      SCALE,
      -SCALE,
      SCALE - 1n,
      SCALE + 1n,
      9n * 10n ** 17n,
      123456789n,
      -123456789n,
    ];

    it.each(scaledValues.map((v) => [v.toString()]))(
      'toScaled(fromScaled(%s)) returns the same scaled bigint',
      (asString) => {
        const scaled = BigInt(asString);
        expect(toScaled(fromScaled(scaled))).toBe(scaled);
      },
    );
  });
});
