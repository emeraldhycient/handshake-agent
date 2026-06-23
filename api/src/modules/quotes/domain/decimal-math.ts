/**
 * Decimal-safe arithmetic for crypto amounts (task N1).
 *
 * JavaScript `number` has float drift at edge cases:
 *   0.1 + 0.2 === 0.30000000000000004
 *   1 + 0.000001 === 1.000001 (OK in most cases but not guaranteed at all precisions)
 *
 * We carry amounts as decimal strings and use BigInt (integer arithmetic on
 * scaled minor units) to avoid all float representation issues.
 *
 * These helpers are PURE — no imports, no side effects, no framework.
 */

/**
 * Returns the number of decimal places in a decimal string.
 * '10.5' → 1, '1' → 0, '0.000001' → 6.
 */
function countDecimals(s: string): number {
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * Converts a decimal string to a BigInt scaled to `decimals` places.
 * '10.5' with decimals=6 → 10_500_000n
 * '1'    with decimals=6 →  1_000_000n
 */
function toScaledBigInt(s: string, decimals: number): bigint {
  const dot = s.indexOf('.');
  let intPart: string;
  let fracPart: string;

  if (dot === -1) {
    intPart = s;
    fracPart = '';
  } else {
    intPart = s.slice(0, dot);
    fracPart = s.slice(dot + 1);
  }

  // Pad or truncate fractional part to exactly `decimals` digits.
  const paddedFrac = fracPart.padEnd(decimals, '0').slice(0, decimals);

  return BigInt(intPart + paddedFrac);
}

/**
 * Converts a scaled BigInt back to a decimal string with `decimals` places,
 * then strips trailing zeros (and a trailing dot).
 * 11_500_000n with decimals=6 → '11.5'
 *  1_000_001n with decimals=6 → '1.000001'
 */
function fromScaledBigInt(n: bigint, decimals: number): string {
  if (decimals === 0) return n.toString();

  const s = n.toString().padStart(decimals + 1, '0');
  const intPart = s.slice(0, s.length - decimals);
  const fracPart = s.slice(s.length - decimals);

  // Strip trailing zeros from the fractional part.
  const trimmed = fracPart.replace(/0+$/, '');
  return trimmed ? `${intPart}.${trimmed}` : intPart;
}

/**
 * Adds two non-negative decimal strings and returns the result as a decimal
 * string with trailing zeros stripped.
 *
 * Uses BigInt arithmetic on integer-scaled values to avoid float drift.
 *
 * @example
 *   addDecimalStrings('10.5', '1')       // '11.5'
 *   addDecimalStrings('0.000001', '1')   // '1.000001'
 *   addDecimalStrings('100', '1')        // '101'
 *
 * @throws RangeError if either argument is not a valid non-negative decimal string.
 */
export function addDecimalStrings(a: string, b: string): string {
  // Basic validation — callers (QuotesService) apply Zod validation first.
  if (!/^\d+(\.\d+)?$/.test(a)) {
    throw new RangeError(`addDecimalStrings: invalid decimal string "${a}"`);
  }
  if (!/^\d+(\.\d+)?$/.test(b)) {
    throw new RangeError(`addDecimalStrings: invalid decimal string "${b}"`);
  }

  // Scale both values to the highest precision present in either operand.
  const decimals = Math.max(countDecimals(a), countDecimals(b));
  const aScaled = toScaledBigInt(a, decimals);
  const bScaled = toScaledBigInt(b, decimals);
  const sumScaled = aScaled + bScaled;

  return fromScaledBigInt(sumScaled, decimals);
}
