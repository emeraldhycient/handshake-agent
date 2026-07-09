import { addDecimalStrings } from './decimal-math';

/**
 * Characterization tests for the decimal-safe money helper (task N1).
 *
 * `addDecimalStrings` is a money-path domain primitive (used by QuotesService to
 * total `cryptoAmount + networkFeeCrypto`). Root CLAUDE.md §9 puts money math at
 * the ~100%-coverage bar, but before these tests it was only exercised
 * indirectly through two happy-path cases in `quotes.service.spec.ts` — the
 * validation branches, the integer-only path, and trailing-zero normalization
 * were untested. These tests document existing behavior; they change nothing.
 */
describe('addDecimalStrings', () => {
  describe('decimal-safe addition (no float drift)', () => {
    it('adds a fractional and an integer operand (10.5 + 1 = 11.5)', () => {
      // Matches the QuotesService totalDebit example.
      expect(addDecimalStrings('10.5', '1')).toBe('11.5');
    });

    it('adds a sub-unit amount without drift (0.000001 + 1 = 1.000001)', () => {
      expect(addDecimalStrings('0.000001', '1')).toBe('1.000001');
    });

    it('avoids the classic float error (0.1 + 0.2 = 0.3, not 0.30000000000000004)', () => {
      expect(addDecimalStrings('0.1', '0.2')).toBe('0.3');
    });

    it('is commutative', () => {
      expect(addDecimalStrings('0.000001', '1')).toBe(
        addDecimalStrings('1', '0.000001'),
      );
    });

    it('aligns operands of differing precision (1.5 + 0.005 = 1.505)', () => {
      expect(addDecimalStrings('1.5', '0.005')).toBe('1.505');
    });

    it('stays exact beyond Number.MAX_SAFE_INTEGER (BigInt, not float)', () => {
      // 9007199254740993 is not representable as a JS number; BigInt keeps it exact.
      expect(addDecimalStrings('9007199254740993', '2')).toBe(
        '9007199254740995',
      );
    });
  });

  describe('result normalization', () => {
    it('returns a bare integer when both operands are integers (100 + 1 = 101)', () => {
      // Exercises the decimals === 0 branch of the internal formatter.
      expect(addDecimalStrings('100', '1')).toBe('101');
    });

    it('strips a fully-zero fractional part to a bare integer (0.5 + 0.5 = 1)', () => {
      expect(addDecimalStrings('0.5', '0.5')).toBe('1');
    });

    it('strips trailing zeros while padding differing precision (10.50 + 0.50 = 11)', () => {
      expect(addDecimalStrings('10.50', '0.50')).toBe('11');
    });

    it('preserves significant trailing digits but drops insignificant ones (1.500 + 0.005 = 1.505)', () => {
      expect(addDecimalStrings('1.500', '0.005')).toBe('1.505');
    });

    it('handles zero operands (0 + 0 = 0)', () => {
      expect(addDecimalStrings('0', '0')).toBe('0');
    });

    it('handles fractional-zero operands (0.0 + 0.0 = 0)', () => {
      expect(addDecimalStrings('0.0', '0.0')).toBe('0');
    });

    it('adds to zero without changing the other operand (0 + 1.5 = 1.5)', () => {
      expect(addDecimalStrings('0', '1.5')).toBe('1.5');
    });
  });

  describe('input validation', () => {
    it('throws RangeError when the first operand is not a decimal string', () => {
      expect(() => addDecimalStrings('abc', '1')).toThrow(RangeError);
      expect(() => addDecimalStrings('abc', '1')).toThrow(
        /invalid decimal string "abc"/,
      );
    });

    it('throws RangeError when the second operand is not a decimal string', () => {
      expect(() => addDecimalStrings('1', 'xyz')).toThrow(RangeError);
      expect(() => addDecimalStrings('1', 'xyz')).toThrow(
        /invalid decimal string "xyz"/,
      );
    });

    it.each([
      ['empty string', ''],
      ['trailing dot', '1.'],
      ['leading dot', '.5'],
      ['negative sign', '-1'],
      ['scientific notation', '1e6'],
      ['double dot', '1.2.3'],
      ['thousands separator', '1,000'],
      ['whitespace', '1 '],
    ])('rejects a malformed operand: %s', (_label, bad) => {
      expect(() => addDecimalStrings(bad, '1')).toThrow(RangeError);
    });
  });
});
