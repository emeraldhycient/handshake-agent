/**
 * Characterization tests for the canonical scale-18 decimal codec.
 *
 * These lock the EXACT behaviour the three forked copies had before extraction
 * (admin/domain/tx-profit.ts, admin/infrastructure/metrics-read.prisma.repository.ts,
 * transactions/infrastructure/ledger.prisma.repository.ts) — including the
 * lenient, non-validating parse, because callers feed it Prisma `Decimal`
 * `toString()` output and already-derived money strings, never raw user input.
 *
 * Written FIRST (red → green): the module under test did not exist yet.
 */
import { SCALE_18_FACTOR, fromScaled18, toScaled18 } from './decimal-scale';

describe('toScaled18', () => {
  it('scales a whole number by 10^18', () => {
    expect(toScaled18('1')).toBe(10n ** 18n);
    expect(toScaled18('1600')).toBe(1600n * 10n ** 18n);
  });

  it('scales a fractional value exactly (no float drift)', () => {
    expect(toScaled18('0.1')).toBe(100000000000000000n);
    // The canonical float-drift case: 0.1 + 0.2 !== 0.3 in IEEE-754.
    expect(toScaled18('0.1') + toScaled18('0.2')).toBe(toScaled18('0.3'));
  });

  it('preserves the sign of a negative amount (ledger legs are signed)', () => {
    expect(toScaled18('-1.5')).toBe(-1500000000000000000n);
    expect(toScaled18('-0')).toBe(0n);
  });

  it('carries a full 18 fractional digits without loss', () => {
    expect(toScaled18('1.000000000000000001')).toBe(10n ** 18n + 1n);
  });

  it('TRUNCATES beyond 18 fractional digits (does not round)', () => {
    // 19 digits: the trailing 9 is dropped, not rounded up.
    expect(toScaled18('0.0000000000000000009')).toBe(0n);
    expect(toScaled18('1.9999999999999999999')).toBe(
      10n ** 18n + 999999999999999999n,
    );
  });

  it('truncates NEGATIVES toward zero, not toward −∞', () => {
    // The sign is stripped before truncation, so -1.9…9 loses its 19th digit the
    // same way +1.9…9 does. A rewrite using BigInt division would floor instead
    // and shift every signed value by 1 ulp — computeTxProfit yields signed spreads.
    expect(toScaled18('-1.9999999999999999999')).toBe(
      -(10n ** 18n + 999999999999999999n),
    );
    expect(toScaled18('-0.0000000000000000009')).toBe(0n);
  });

  it('REJECTS exponential notation — including Prisma Decimal.toString() output', () => {
    // Prisma emits exponential form outside 1e-7 … 1e21, e.g.
    // new Prisma.Decimal('0.000000000000000001').toString() === '1e-18'.
    // The codec has never accepted that; pinned so the input contract is explicit.
    expect(() => toScaled18('1e-18')).toThrow(SyntaxError);
    expect(() => toScaled18('1e+21')).toThrow(SyntaxError);
  });

  it('treats an absent integer part as zero ("​.5" and "-.5")', () => {
    expect(toScaled18('.5')).toBe(500000000000000000n);
    expect(toScaled18('-.5')).toBe(-500000000000000000n);
  });

  it('accepts a trailing dot with no fractional digits', () => {
    expect(toScaled18('7.')).toBe(7n * 10n ** 18n);
  });

  it('handles amounts far beyond Number.MAX_SAFE_INTEGER exactly', () => {
    expect(toScaled18('9007199254740993.000000000000000001')).toBe(
      9007199254740993n * 10n ** 18n + 1n,
    );
  });
});

describe('fromScaled18', () => {
  it('renders a whole scaled value with no fractional part', () => {
    expect(fromScaled18(10n ** 18n)).toBe('1');
    expect(fromScaled18(0n)).toBe('0');
  });

  it('strips trailing zeros from the fraction', () => {
    expect(fromScaled18(1500000000000000000n)).toBe('1.5');
    expect(fromScaled18(100000000000000000n)).toBe('0.1');
  });

  it('zero-pads leading fractional zeros (no digit-shift bug)', () => {
    expect(fromScaled18(1n)).toBe('0.000000000000000001');
    expect(fromScaled18(10n ** 18n + 1n)).toBe('1.000000000000000001');
  });

  it('renders negatives with a single leading minus', () => {
    expect(fromScaled18(-1500000000000000000n)).toBe('-1.5');
    expect(fromScaled18(-(10n ** 18n))).toBe('-1');
    expect(fromScaled18(-1n)).toBe('-0.000000000000000001');
  });

  it('round-trips every representable decimal string', () => {
    for (const value of [
      '0',
      '1',
      '1.5',
      '-1.5',
      '0.000000000000000001',
      '-0.000000000000000001',
      '123456789.987654321',
      '9007199254740993.000000000000000001',
    ]) {
      expect(fromScaled18(toScaled18(value))).toBe(value);
    }
  });

  it('normalizes non-canonical input on the round trip', () => {
    // Trailing zeros and an absent integer part are canonicalized, not preserved.
    expect(fromScaled18(toScaled18('1.500'))).toBe('1.5');
    expect(fromScaled18(toScaled18('.5'))).toBe('0.5');
    expect(fromScaled18(toScaled18('-0'))).toBe('0');
  });
});

describe('SCALE_18_FACTOR', () => {
  it('is 10^18 — the Decimal(38,18) column scale', () => {
    expect(SCALE_18_FACTOR).toBe(10n ** 18n);
  });

  it('removes one scale from a scaled×scaled product (rate × amount)', () => {
    // 1.5 units at a rate of 1600 → 2400, computed entirely at scale-18.
    const product = (toScaled18('1.5') * toScaled18('1600')) / SCALE_18_FACTOR;
    expect(fromScaled18(product)).toBe('2400');
  });
});
