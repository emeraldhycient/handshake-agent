/**
 * The canonical scale-18 decimal codec (CLAUDE.md §13.1 — one primitive per concept).
 *
 * Money in this system is carried as decimal STRINGS across every boundary and as
 * `Decimal(38,18)` in Postgres. Aggregating those values requires exact integer
 * arithmetic: an IEEE-754 `number` cannot represent 18 fractional digits without
 * drift (`0.1 + 0.2 !== 0.3`), and drift on a money path is a correctness bug, not
 * a rounding preference. So callers parse to a BigInt scaled by 10^18, accumulate
 * or multiply in integer space, and render back to a canonical decimal string.
 *
 * Extracted VERBATIM from the two semantically-identical private copies in the
 * `admin` module — `admin/domain/tx-profit.ts` (`toScaled`/`fromScaled`) and
 * `admin/infrastructure/metrics-read.prisma.repository.ts`
 * (`toScaledBigInt`/`fromScaledBigInt`). Lives in `core/common` because it is
 * framework-free and crosses module boundaries; it imports nothing, so `domain`
 * stays pure (dependency-cruiser `api-domain-is-pure`) — the same shape as the
 * existing `webhooks/domain` → `core/crypto/hmac` edge.
 *
 * STILL FORKED ELSEWHERE (known, deliberately out of scope — this PR does not
 * touch the transactions money-WRITE path): a third identical `toScaledBigInt` in
 * `transactions/infrastructure/ledger.prisma.repository.ts`, plus `fromScaled`
 * variants in `transactions/domain/ledger.ts`,
 * `transactions/infrastructure/settlement.prisma.repository.ts`,
 * `identity/infrastructure/velocity.prisma.repository.ts`, and inline copies in
 * `execution.service.ts` / `proposal.service.ts`. Re-point them in follow-ups,
 * one money-path module at a time, each with its own parity proof.
 *
 * `transactions/domain/ledger.ts` keeps its OWN `toScaled` on purpose: it
 * VALIDATES and throws `LedgerError` on a malformed string, because a bad ledger
 * leg must fail closed. Do not collapse that one — it answers a different question.
 *
 * INPUT CONTRACT — plain decimal strings only (`-?digits[.digits]`). This is a
 * codec, not a validator: it does not reject garbage, and it does NOT accept
 * exponential notation. Note that `Prisma.Decimal.toString()` DOES emit exponential
 * form outside 1e-7 … 1e21 (`'0.000000000000000001'` → `'1e-18'`), which throws
 * `SyntaxError` here — so a caller reading a `Decimal(38,18)` column must not
 * assume `.toString()` is always safe input. That is pre-existing behaviour of all
 * the forks, preserved verbatim and now pinned by the spec; today's callers stay
 * inside the safe range (fiat is 2-dp and the only registered asset is 6-dp).
 */

/** Decimal places carried internally (matches the ledger's `Decimal(38,18)`). */
const SCALE_18 = 18;

/** Scale factor 10^18 — divide a scaled×scaled product by this to remove one scale. */
export const SCALE_18_FACTOR = 10n ** BigInt(SCALE_18);

/**
 * Parses a signed decimal string into a scaled BigInt (×10^18) for exact integer
 * arithmetic — floats cannot represent 18-digit ledger amounts without drift.
 * Accepts an optional leading '-', an integer part, and an optional fraction;
 * fractional digits beyond 18 are TRUNCATED (never rounded).
 */
export function toScaled18(value: string): bigint {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [intPart, fracPart = ''] = unsigned.split('.');
  const fracPadded = (fracPart + '0'.repeat(SCALE_18)).slice(0, SCALE_18);
  const magnitude = BigInt((intPart || '0') + fracPadded);
  return negative ? -magnitude : magnitude;
}

/**
 * Converts a scaled BigInt back to a canonical decimal string (no trailing zeros,
 * no trailing dot). The inverse of `toScaled18` for every representable value.
 */
export function fromScaled18(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / SCALE_18_FACTOR;
  const frac = abs % SCALE_18_FACTOR;
  if (frac === 0n) {
    return (negative ? '-' : '') + whole.toString();
  }
  const fracStr = frac.toString().padStart(SCALE_18, '0').replace(/0+$/, '');
  return (negative ? '-' : '') + whole.toString() + '.' + fracStr;
}
