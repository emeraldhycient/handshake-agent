/**
 * Pure double-entry ledger domain for crypto settlement operations.
 *
 * No framework imports, no Prisma imports — domain-only (CLAUDE.md §4.1).
 * Decimal arithmetic is performed with BigInt at 18 decimal places of scale
 * to avoid IEEE-754 float drift on money values (schema: Decimal(38,18)).
 *
 * Invariants (enforced by buildBuyLedgerEntries / buildDepositLedgerEntries):
 *  1. Per-currency signed amounts sum to exactly 0.
 *  2. Every amount is non-zero; direction matches the sign.
 *  3. sequence === prevSequence + 1 per account.
 *  4. balanceAfter === prevBalance + signedAmount (exact decimal).
 *  5. ≥2 entries returned in a deterministic order.
 */

// ---------------------------------------------------------------------------
// Enums — mirror api/prisma/schema/06-engine.prisma (no @prisma/client import)
// ---------------------------------------------------------------------------

export enum LedgerAccountType {
  user_wallet = 'user_wallet',
  platform_float = 'platform_float',
  processor_settlement = 'processor_settlement',
  treasury_reserve = 'treasury_reserve',
  clearing = 'clearing',
  compensation = 'compensation',
}

export enum LedgerDirection {
  debit = 'debit',
  credit = 'credit',
}

// ---------------------------------------------------------------------------
// Domain error
// ---------------------------------------------------------------------------

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * `AccountKey` identifies a unique account for a given currency.
 * Format: `${LedgerAccountType}:${accountId}:${currency}`
 */
export type AccountKey = string;

/** Last persisted state for a specific account. */
export interface AccountState {
  /** The last sequence number written for this account (0 if none). */
  sequence: number;
  /** Current running balance as a decimal string (e.g. "12345.67"). */
  balance: string;
}

/** Input to the pure ledger builder. */
export interface BuildBuyLedgerInput {
  userId: string;
  /** accountId for the user_wallet USDT account. */
  walletId: string;
  /** Gross NGN the user pays, as a decimal string (e.g. "5000"). */
  fiatAmount: string;
  /** USDT delivered to the user, as a decimal string (e.g. "3.06"). */
  cryptoAmount: string;
  /** NGN processing fee (part of fiatAmount), as a decimal string. */
  processingFee: string;
  postedAt: Date;
  /**
   * Current per-account state. Missing keys default to
   * { sequence: 0, balance: '0' }.
   */
  accountStates: Record<AccountKey, AccountState>;
}

/**
 * One ledger row ready for persistence. Excludes `id` and `transactionId`
 * (the caller adds those before inserting).
 */
export interface LedgerEntryDraft {
  accountType: LedgerAccountType;
  accountId: string;
  currency: string;
  /** Signed decimal string: positive = credit, negative = debit. */
  amount: string;
  direction: LedgerDirection;
  description: string;
  /** Running balance after this entry, as a decimal string. */
  balanceAfter: string;
  /** Per-(accountType,accountId) monotonic counter. */
  sequence: number;
  postedAt: Date;
}

// ---------------------------------------------------------------------------
// Decimal-safe arithmetic helpers (BigInt at 18 decimal places of scale)
// ---------------------------------------------------------------------------

/** Scale factor: 10^18, matching the Decimal(38,18) DB type. */
const SCALE = 10n ** 18n;

/**
 * Parse a signed decimal string into a scaled BigInt.
 * Throws `LedgerError` if the string is not a valid decimal.
 */
function toScaled(value: string): bigint {
  const s = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new LedgerError(`Invalid decimal string: "${value}"`);
  }
  const isNeg = s.startsWith('-');
  const abs = isNeg ? s.slice(1) : s;
  const [whole = '0', frac = ''] = abs.split('.');
  // Truncate or pad fractional part to exactly 18 digits.
  const fracPadded = frac.slice(0, 18).padEnd(18, '0');
  const scaled = BigInt(whole) * SCALE + BigInt(fracPadded);
  return isNeg ? -scaled : scaled;
}

/**
 * Convert a scaled BigInt back to a canonical decimal string.
 * Always returns the minimum number of decimal places needed (no trailing zeros
 * beyond what is necessary), but at least one decimal place when the value has
 * a non-zero fractional part in scaled form.
 *
 * Special case: if the fractional part is all zeros, returns an integer string.
 */
function fromScaled(scaled: bigint): string {
  const isNeg = scaled < 0n;
  const abs = isNeg ? -scaled : scaled;
  const whole = abs / SCALE;
  const frac = abs % SCALE;

  if (frac === 0n) {
    return (isNeg ? '-' : '') + whole.toString();
  }

  // Pad fractional part to 18 digits then strip trailing zeros.
  const fracStr = frac.toString().padStart(18, '0').replace(/0+$/, '');
  return (isNeg ? '-' : '') + whole.toString() + '.' + fracStr;
}

/**
 * Add two decimal strings safely and return the result as a decimal string.
 */
function decimalAdd(a: string, b: string): string {
  return fromScaled(toScaled(a) + toScaled(b));
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function accountKey(
  type: LedgerAccountType,
  accountId: string,
  currency: string,
): AccountKey {
  return `${type}:${accountId}:${currency}`;
}

function getState(
  states: Record<AccountKey, AccountState>,
  type: LedgerAccountType,
  accountId: string,
  currency: string,
): AccountState {
  return (
    states[accountKey(type, accountId, currency)] ?? {
      sequence: 0,
      balance: '0',
    }
  );
}

interface EntrySpec {
  accountType: LedgerAccountType;
  accountId: string;
  currency: string;
  amount: string; // signed decimal string
  description: string;
}

function buildEntry(
  spec: EntrySpec,
  states: Record<AccountKey, AccountState>,
  postedAt: Date,
): LedgerEntryDraft {
  const prev = getState(
    states,
    spec.accountType,
    spec.accountId,
    spec.currency,
  );
  const sequence = prev.sequence + 1;
  const balanceAfter = decimalAdd(prev.balance, spec.amount);
  const isNeg = spec.amount.startsWith('-');
  const direction = isNeg ? LedgerDirection.debit : LedgerDirection.credit;

  return {
    accountType: spec.accountType,
    accountId: spec.accountId,
    currency: spec.currency,
    amount: spec.amount,
    direction,
    description: spec.description,
    balanceAfter,
    sequence,
    postedAt,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function assertPositiveDecimal(value: string, fieldName: string): bigint {
  let scaled: bigint;
  try {
    scaled = toScaled(value);
  } catch {
    throw new LedgerError(`${fieldName} is not a valid decimal: "${value}"`);
  }
  if (scaled <= 0n) {
    throw new LedgerError(`${fieldName} must be positive (got "${value}")`);
  }
  return scaled;
}

function assertNonNegativeDecimal(value: string, fieldName: string): bigint {
  let scaled: bigint;
  try {
    scaled = toScaled(value);
  } catch {
    throw new LedgerError(`${fieldName} is not a valid decimal: "${value}"`);
  }
  if (scaled < 0n) {
    throw new LedgerError(`${fieldName} must be non-negative (got "${value}")`);
  }
  return scaled;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Produce the balanced double-entry `LedgerEntryDraft` rows for a crypto BUY
 * settlement (4 or 5 entries depending on whether processingFee is zero).
 *
 * The function is pure: it reads prior account state from `input.accountStates`
 * and computes the next `sequence` and `balanceAfter` values deterministically.
 * The caller (execution engine) persists the returned rows inside a DB
 * transaction after adding `id` and `transactionId`.
 *
 * Account mapping (credit positive, debit negative; per-currency sums = 0):
 *
 * NGN leg (sum = 0) — processingFee > 0 (3 entries):
 *  + processor_settlement / ngn_processor / NGN  +fiatAmount          (NGN received)
 *  − treasury_reserve    / ngn_treasury  / NGN  −(fiatAmount − fee)  (cost basis)
 *  − platform_float      / ngn_fees      / NGN  −processingFee        (fee revenue)
 *
 * NGN leg (sum = 0) — processingFee = 0 (2 entries, fee entry omitted):
 *  + processor_settlement / ngn_processor / NGN  +fiatAmount          (NGN received)
 *  − treasury_reserve    / ngn_treasury  / NGN  −fiatAmount           (cost basis)
 *
 * USDT leg (sum = 0, always 2 entries):
 *  + user_wallet         / walletId      / USDT +cryptoAmount (delivered to user)
 *  − treasury_reserve    / usdt_treasury / USDT −cryptoAmount (sourced from treasury)
 *
 * Zero-amount entries are never emitted (invariant 2). A zero processingFee is a
 * legitimate business case (promotions / zero-fee tier) — the fee entry is simply
 * omitted rather than rejecting the input.
 */
export function buildBuyLedgerEntries(
  input: BuildBuyLedgerInput,
): LedgerEntryDraft[] {
  const {
    walletId,
    fiatAmount,
    processingFee,
    cryptoAmount,
    postedAt,
    accountStates,
  } = input;

  // -- Validation --
  const scaledFiat = assertPositiveDecimal(fiatAmount, 'fiatAmount');
  const scaledFee = assertNonNegativeDecimal(processingFee, 'processingFee');
  assertPositiveDecimal(cryptoAmount, 'cryptoAmount');

  if (scaledFee >= scaledFiat) {
    throw new LedgerError(
      `processingFee ("${processingFee}") must be less than fiatAmount ("${fiatAmount}")`,
    );
  }

  // Derived amounts (exact BigInt arithmetic).
  const costBasis = fromScaled(-(scaledFiat - scaledFee)); // negative (debit)
  const negCrypto = fromScaled(-toScaled(cryptoAmount)); // negative (debit)

  // -- Build entries in deterministic order --
  // NGN leg: when processingFee is zero, omit the platform_float fee entry to
  // preserve the invariant that every LedgerEntry.amount is non-zero.
  // The two remaining NGN entries still balance: +fiatAmount − fiatAmount = 0.
  const ngnSpecs: EntrySpec[] = [
    {
      accountType: LedgerAccountType.processor_settlement,
      accountId: 'ngn_processor',
      currency: 'NGN',
      amount: fiatAmount,
      description: `Buy: NGN ${fiatAmount} collected from user via processor`,
    },
    {
      accountType: LedgerAccountType.treasury_reserve,
      accountId: 'ngn_treasury',
      currency: 'NGN',
      amount: costBasis,
      description: `Buy: NGN ${fromScaled(scaledFiat - scaledFee)} cost basis of USDT sourced from treasury`,
    },
    // Fee entry only emitted when processingFee > 0 (a zero entry violates invariant 2).
    ...(scaledFee > 0n
      ? [
          {
            accountType: LedgerAccountType.platform_float,
            accountId: 'ngn_fees',
            currency: 'NGN',
            amount: fromScaled(-scaledFee),
            description: `Buy: NGN ${processingFee} processing fee booked to platform`,
          } satisfies EntrySpec,
        ]
      : []),
  ];

  const specs: EntrySpec[] = [
    ...ngnSpecs,
    // USDT leg
    {
      accountType: LedgerAccountType.user_wallet,
      accountId: walletId,
      currency: 'USDT',
      amount: cryptoAmount,
      description: `Buy: USDT ${cryptoAmount} delivered to user wallet`,
    },
    {
      accountType: LedgerAccountType.treasury_reserve,
      accountId: 'usdt_treasury',
      currency: 'USDT',
      amount: negCrypto,
      description: `Buy: USDT ${cryptoAmount} sourced from treasury`,
    },
  ];

  return specs.map((spec) => buildEntry(spec, accountStates, postedAt));
}

// ---------------------------------------------------------------------------
// Deposit ledger (inbound on-chain credit)
// ---------------------------------------------------------------------------

/** Input to the pure deposit ledger builder. */
export interface BuildDepositLedgerInput {
  /** accountId for the user_wallet USDT account. */
  walletId: string;
  /** USDT credited to the user from the on-chain deposit, as a decimal string. */
  cryptoAmount: string;
  postedAt: Date;
  /**
   * Current per-account state. Missing keys default to
   * { sequence: 0, balance: '0' }.
   */
  accountStates: Record<AccountKey, AccountState>;
}

/**
 * Produce the balanced double-entry `LedgerEntryDraft` rows for an on-chain
 * USDT DEPOSIT settlement (exactly 2 entries).
 *
 * The function is pure: it reads prior account state from `input.accountStates`
 * and computes the next `sequence` and `balanceAfter` values deterministically.
 * The caller (settlement repo) persists the returned rows inside a DB transaction.
 *
 * Account mapping (credit positive, debit negative; per-currency sum = 0):
 *
 * USDT leg (sum = 0, always 2 entries):
 *  + user_wallet         / walletId                / USDT  +cryptoAmount (credited to user)
 *  − clearing            / usdt_external_deposits   / USDT  −cryptoAmount (contra account)
 */
export function buildDepositLedgerEntries(
  input: BuildDepositLedgerInput,
): LedgerEntryDraft[] {
  const { walletId, cryptoAmount, postedAt, accountStates } = input;

  // -- Validation --
  assertPositiveDecimal(cryptoAmount, 'cryptoAmount');

  const negCrypto = fromScaled(-toScaled(cryptoAmount));

  const specs: EntrySpec[] = [
    {
      accountType: LedgerAccountType.user_wallet,
      accountId: walletId,
      currency: 'USDT',
      amount: cryptoAmount,
      description: `Deposit: USDT ${cryptoAmount} credited to user wallet from on-chain deposit`,
    },
    {
      accountType: LedgerAccountType.clearing,
      accountId: 'usdt_external_deposits',
      currency: 'USDT',
      amount: negCrypto,
      description: `Deposit: USDT ${cryptoAmount} contra clearing for external inbound deposit`,
    },
  ];

  return specs.map((spec) => buildEntry(spec, accountStates, postedAt));
}
