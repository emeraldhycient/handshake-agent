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
  /** accountId for the user_wallet crypto account. */
  walletId: string;
  /** Gross fiat the user pays in `fiatCurrency`, as a decimal string (NGN example: "5000"). */
  fiatAmount: string;
  /** Crypto amount delivered to the user, as a decimal string (e.g. "3.06"). */
  cryptoAmount: string;
  /** Fiat processing fee (part of fiatAmount) in `fiatCurrency`, as a decimal string. */
  processingFee: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Used as the `currency`
   * label on all crypto legs so reads and writes key by (walletId, asset).
   */
  asset: string;
  /**
   * The fiat currency code (e.g. 'NGN'). Used as the `currency` label on all
   * fiat legs and to derive the fiat bookkeeping account ids, so adding a
   * currency is config — not a code change.
   */
  fiatCurrency: string;
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
 * fiatCurrency leg (sum = 0) — processingFee > 0 (3 entries):
 *  + processor_settlement / ${fc}_processor / fiatCurrency  +fiatAmount          (fiat received)
 *  − treasury_reserve    / ${fc}_treasury  / fiatCurrency  −(fiatAmount − fee)  (cost basis)
 *  − platform_float      / ${fc}_fees      / fiatCurrency  −processingFee        (fee revenue)
 *
 * fiatCurrency leg (sum = 0) — processingFee = 0 (2 entries, fee entry omitted):
 *  + processor_settlement / ${fc}_processor / fiatCurrency  +fiatAmount          (fiat received)
 *  − treasury_reserve    / ${fc}_treasury  / fiatCurrency  −fiatAmount           (cost basis)
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
    asset,
    fiatCurrency,
    postedAt,
    accountStates,
  } = input;
  const fc = fiatCurrency.toLowerCase();

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
      accountId: `${fc}_processor`,
      currency: fiatCurrency,
      amount: fiatAmount,
      description: `Buy: ${fiatCurrency} ${fiatAmount} collected from user via processor`,
    },
    {
      accountType: LedgerAccountType.treasury_reserve,
      accountId: `${fc}_treasury`,
      currency: fiatCurrency,
      amount: costBasis,
      description: `Buy: ${fiatCurrency} ${fromScaled(scaledFiat - scaledFee)} cost basis of ${asset} sourced from treasury`,
    },
    // Fee entry only emitted when processingFee > 0 (a zero entry violates invariant 2).
    ...(scaledFee > 0n
      ? [
          {
            accountType: LedgerAccountType.platform_float,
            accountId: `${fc}_fees`,
            currency: fiatCurrency,
            amount: fromScaled(-scaledFee),
            description: `Buy: ${fiatCurrency} ${processingFee} processing fee booked to platform`,
          } satisfies EntrySpec,
        ]
      : []),
  ];

  const specs: EntrySpec[] = [
    ...ngnSpecs,
    // Crypto leg — currency is the passed asset (e.g. 'USDT', 'USDC')
    {
      accountType: LedgerAccountType.user_wallet,
      accountId: walletId,
      currency: asset,
      amount: cryptoAmount,
      description: `Buy: ${asset} ${cryptoAmount} delivered to user wallet`,
    },
    {
      accountType: LedgerAccountType.treasury_reserve,
      accountId: 'usdt_treasury',
      currency: asset,
      amount: negCrypto,
      description: `Buy: ${asset} ${cryptoAmount} sourced from treasury`,
    },
  ];

  return specs.map((spec) => buildEntry(spec, accountStates, postedAt));
}

// ---------------------------------------------------------------------------
// Deposit ledger (inbound on-chain credit)
// ---------------------------------------------------------------------------

/** Input to the pure deposit ledger builder. */
export interface BuildDepositLedgerInput {
  /** accountId for the user_wallet crypto account. */
  walletId: string;
  /** Crypto amount credited to the user from the on-chain deposit, as a decimal string. */
  cryptoAmount: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Used as the `currency`
   * label on all crypto legs so reads and writes key by (walletId, asset).
   */
  asset: string;
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
  const { walletId, cryptoAmount, asset, postedAt, accountStates } = input;

  // -- Validation --
  assertPositiveDecimal(cryptoAmount, 'cryptoAmount');

  const negCrypto = fromScaled(-toScaled(cryptoAmount));

  // Crypto leg — currency is the passed asset (e.g. 'USDT', 'USDC')
  const specs: EntrySpec[] = [
    {
      accountType: LedgerAccountType.user_wallet,
      accountId: walletId,
      currency: asset,
      amount: cryptoAmount,
      description: `Deposit: ${asset} ${cryptoAmount} credited to user wallet from on-chain deposit`,
    },
    {
      accountType: LedgerAccountType.clearing,
      accountId: 'usdt_external_deposits',
      currency: asset,
      amount: negCrypto,
      description: `Deposit: ${asset} ${cryptoAmount} contra clearing for external inbound deposit`,
    },
  ];

  return specs.map((spec) => buildEntry(spec, accountStates, postedAt));
}

// ---------------------------------------------------------------------------
// Manual credit ledger (admin, engine-brokered — Phase 7)
// ---------------------------------------------------------------------------

/** Treasury account id that funds an admin manual credit (mirrors buy's crypto source). */
const MANUAL_CREDIT_TREASURY_ACCOUNT_ID = 'usdt_treasury';

/** Input to the pure manual-credit ledger builder. */
export interface BuildManualCreditLedgerInput {
  /** accountId for the user_wallet crypto account. */
  walletId: string;
  /** Crypto amount credited to the user (positive decimal string, e.g. "25.5"). */
  cryptoAmount: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Used as the `currency`
   * label on both legs so reads and writes key by (walletId, asset).
   */
  asset: string;
  postedAt: Date;
  /**
   * Current per-account state. Missing keys default to
   * { sequence: 0, balance: '0' }.
   */
  accountStates: Record<AccountKey, AccountState>;
}

/**
 * Produce the balanced double-entry `LedgerEntryDraft` rows for an admin
 * MANUAL CREDIT (exactly 2 entries). The credit is sourced from the treasury —
 * the platform funds a goodwill/reconciliation credit exactly as a buy sources
 * the delivered crypto from treasury.
 *
 * Account mapping (credit positive, debit negative; per-currency sum = 0):
 *  + user_wallet      / walletId      / asset  +cryptoAmount  (credited to user)
 *  − treasury_reserve / usdt_treasury / asset  −cryptoAmount  (sourced from treasury)
 */
export function buildManualCreditEntries(
  input: BuildManualCreditLedgerInput,
): LedgerEntryDraft[] {
  const { walletId, cryptoAmount, asset, postedAt, accountStates } = input;

  // -- Validation -- fail closed on a zero / negative / malformed amount.
  assertPositiveDecimal(cryptoAmount, 'cryptoAmount');

  const negCrypto = fromScaled(-toScaled(cryptoAmount));

  const specs: EntrySpec[] = [
    {
      accountType: LedgerAccountType.user_wallet,
      accountId: walletId,
      currency: asset,
      amount: cryptoAmount,
      description: `Manual credit: ${asset} ${cryptoAmount} credited to user wallet by admin`,
    },
    {
      accountType: LedgerAccountType.treasury_reserve,
      accountId: MANUAL_CREDIT_TREASURY_ACCOUNT_ID,
      currency: asset,
      amount: negCrypto,
      description: `Manual credit: ${asset} ${cryptoAmount} sourced from treasury`,
    },
  ];

  return specs.map((spec) => buildEntry(spec, accountStates, postedAt));
}

// ---------------------------------------------------------------------------
// Sell ledger — two-phase (reserve at execute, finalize or refund at settle)
// ---------------------------------------------------------------------------

/**
 * Re-export `toScaled` so application-layer consumers (e.g. ProposalService,
 * ExecutionService) can perform decimal-safe comparisons using the same scale
 * factor as the ledger domain without redefining the helper (DRY — root §13.2).
 */
export { toScaled };

// ── Phase 1: Reserve (execute) ──────────────────────────────────────────────

/** Input to buildSellReserveEntries. */
export interface BuildSellReserveInput {
  /** accountId for the user_wallet crypto account. */
  walletId: string;
  /** Crypto amount the user is selling, as a decimal string (e.g. "3.06"). */
  cryptoAmount: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Used as the `currency`
   * label on all crypto legs so reads and writes key by (walletId, asset).
   */
  asset: string;
  postedAt: Date;
  /**
   * Current per-account state. Missing keys default to
   * { sequence: 0, balance: '0' }.
   */
  accountStates: Record<AccountKey, AccountState>;
}

/**
 * Produce the balanced double-entry `LedgerEntryDraft` rows for the RESERVE
 * phase of a crypto SELL (exactly 2 USDT entries; no NGN entries).
 *
 * The USDT is moved from the user's wallet into the clearing account so it
 * cannot be double-spent while the NGN payout is in flight.
 *
 * Account mapping (credit positive, debit negative; USDT sum = 0):
 *  − user_wallet / walletId           / USDT  −cryptoAmount  (hold from user)
 *  + clearing    / usdt_sell_clearing / USDT  +cryptoAmount  (in clearing)
 */
export function buildSellReserveEntries(
  input: BuildSellReserveInput,
): LedgerEntryDraft[] {
  const { walletId, cryptoAmount, asset, postedAt, accountStates } = input;

  assertPositiveDecimal(cryptoAmount, 'cryptoAmount');

  const scaledCrypto = toScaled(cryptoAmount);
  const posCrypto = fromScaled(scaledCrypto);
  const negCrypto = fromScaled(-scaledCrypto);

  // Crypto leg — currency is the passed asset (e.g. 'USDT', 'USDC')
  const specs: EntrySpec[] = [
    {
      accountType: LedgerAccountType.user_wallet,
      accountId: walletId,
      currency: asset,
      amount: negCrypto,
      description: `Sell reserve: ${asset} ${cryptoAmount} held from user wallet`,
    },
    {
      accountType: LedgerAccountType.clearing,
      accountId: 'usdt_sell_clearing',
      currency: asset,
      amount: posCrypto,
      description: `Sell reserve: ${asset} ${cryptoAmount} moved to clearing`,
    },
  ];

  return specs.map((spec) => buildEntry(spec, accountStates, postedAt));
}

// ── Phase 2a: Finalize (settle — payout success) ───────────────────────────

/** Input to buildSellFinalizeEntries. */
export interface BuildSellFinalizeInput {
  /** accountId for the user_wallet crypto account (used only as metadata — not debited again). */
  walletId: string;
  /** Crypto amount that was reserved (the same value as at reserve). */
  cryptoAmount: string;
  /** Net fiat the user receives in `fiatCurrency` after spread + fee. */
  netFiatAmount: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Used as the `currency`
   * label on all crypto legs so reads and writes key by (walletId, asset).
   */
  asset: string;
  /**
   * The fiat currency code (e.g. 'NGN'). Used as the `currency` label on all
   * fiat payout legs and to derive the fiat bookkeeping account ids, so adding a
   * currency is config — not a code change.
   */
  fiatCurrency: string;
  postedAt: Date;
  accountStates: Record<AccountKey, AccountState>;
}

/**
 * Produce the balanced double-entry `LedgerEntryDraft` rows for the FINALIZE
 * phase of a crypto SELL (4 entries: 2 USDT + 2 NGN).
 *
 * USDT moves from clearing → treasury (completing the sell).
 * NGN moves from treasury → processor_settlement (payout dispatched).
 *
 * Account mapping (credit positive, debit negative; per-currency sum = 0):
 *
 * USDT leg (sum = 0, 2 entries):
 *  − clearing         / usdt_sell_clearing / USDT  −cryptoAmount  (leave clearing)
 *  + treasury_reserve / usdt_treasury      / USDT  +cryptoAmount  (treasury receives)
 *
 * fiatCurrency leg (sum = 0, 2 entries):
 *  − treasury_reserve     / ${fc}_treasury / fiatCurrency  −netFiatAmount  (treasury pays)
 *  + processor_settlement / ${fc}_payout   / fiatCurrency  +netFiatAmount  (payout dispatched)
 */
export function buildSellFinalizeEntries(
  input: BuildSellFinalizeInput,
): LedgerEntryDraft[] {
  const {
    cryptoAmount,
    netFiatAmount,
    asset,
    fiatCurrency,
    postedAt,
    accountStates,
  } = input;
  const fc = fiatCurrency.toLowerCase();

  assertPositiveDecimal(cryptoAmount, 'cryptoAmount');
  assertPositiveDecimal(netFiatAmount, 'netFiatAmount');

  const scaledCrypto = toScaled(cryptoAmount);
  const scaledFiat = toScaled(netFiatAmount);
  const posCrypto = fromScaled(scaledCrypto);
  const negCrypto = fromScaled(-scaledCrypto);
  const posFiat = fromScaled(scaledFiat);
  const negFiat = fromScaled(-scaledFiat);

  // Crypto leg — currency is the passed asset (e.g. 'USDT', 'USDC')
  const specs: EntrySpec[] = [
    // Crypto leg: clearing → treasury
    {
      accountType: LedgerAccountType.clearing,
      accountId: 'usdt_sell_clearing',
      currency: asset,
      amount: negCrypto,
      description: `Sell finalize: ${asset} ${cryptoAmount} leaves clearing to treasury`,
    },
    {
      accountType: LedgerAccountType.treasury_reserve,
      accountId: 'usdt_treasury',
      currency: asset,
      amount: posCrypto,
      description: `Sell finalize: ${asset} ${cryptoAmount} credited to treasury`,
    },
    // Fiat leg: treasury → processor_settlement (payout)
    {
      accountType: LedgerAccountType.treasury_reserve,
      accountId: `${fc}_treasury`,
      currency: fiatCurrency,
      amount: negFiat,
      description: `Sell finalize: ${fiatCurrency} ${netFiatAmount} dispatched from treasury`,
    },
    {
      accountType: LedgerAccountType.processor_settlement,
      accountId: `${fc}_payout`,
      currency: fiatCurrency,
      amount: posFiat,
      description: `Sell finalize: ${fiatCurrency} ${netFiatAmount} credited for payout to user`,
    },
  ];

  return specs.map((spec) => buildEntry(spec, accountStates, postedAt));
}

// ── Phase 2b: Refund (settle — payout failure) ─────────────────────────────

/** Input to buildSellRefundEntries. */
export interface BuildSellRefundInput {
  walletId: string;
  cryptoAmount: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Used as the `currency`
   * label on all crypto legs so reads and writes key by (walletId, asset).
   */
  asset: string;
  postedAt: Date;
  accountStates: Record<AccountKey, AccountState>;
}

/**
 * Produce the balanced double-entry `LedgerEntryDraft` rows for the REFUND
 * phase of a failed crypto SELL (exactly 2 USDT entries; mirrors reserve in
 * reverse).
 *
 * Account mapping (credit positive, debit negative; USDT sum = 0):
 *  − clearing    / usdt_sell_clearing / USDT  −cryptoAmount  (leave clearing)
 *  + user_wallet / walletId           / USDT  +cryptoAmount  (refund to user)
 */
export function buildSellRefundEntries(
  input: BuildSellRefundInput,
): LedgerEntryDraft[] {
  const { walletId, cryptoAmount, asset, postedAt, accountStates } = input;

  assertPositiveDecimal(cryptoAmount, 'cryptoAmount');

  const scaledCrypto = toScaled(cryptoAmount);
  const posCrypto = fromScaled(scaledCrypto);
  const negCrypto = fromScaled(-scaledCrypto);

  // Crypto leg — currency is the passed asset (e.g. 'USDT', 'USDC')
  const specs: EntrySpec[] = [
    {
      accountType: LedgerAccountType.clearing,
      accountId: 'usdt_sell_clearing',
      currency: asset,
      amount: negCrypto,
      description: `Sell refund: ${asset} ${cryptoAmount} leaves clearing`,
    },
    {
      accountType: LedgerAccountType.user_wallet,
      accountId: walletId,
      currency: asset,
      amount: posCrypto,
      description: `Sell refund: ${asset} ${cryptoAmount} returned to user wallet`,
    },
  ];

  return specs.map((spec) => buildEntry(spec, accountStates, postedAt));
}

// ---------------------------------------------------------------------------
// Send ledger — two-phase (reserve at propose, finalize or refund at settle)
// ---------------------------------------------------------------------------

// ── Phase 1: Reserve (propose) ───────────────────────────────────────────────

/** Input to buildSendReserveEntries. */
export interface BuildSendReserveInput {
  /** accountId for the user_wallet crypto account. */
  walletId: string;
  /**
   * Total crypto amount to debit from the user's wallet at reservation time
   * (cryptoAmount + networkFeeCrypto).
   */
  totalDebit: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Used as the `currency`
   * label on all crypto legs so reads and writes key by (walletId, asset).
   */
  asset: string;
  postedAt: Date;
  /**
   * Current per-account state. Missing keys default to
   * { sequence: 0, balance: '0' }.
   */
  accountStates: Record<AccountKey, AccountState>;
}

/**
 * Produce the balanced double-entry `LedgerEntryDraft` rows for the RESERVE
 * phase of an on-chain USDT SEND (exactly 2 USDT entries; no NGN entries).
 *
 * The total debit (cryptoAmount + networkFeeCrypto) is moved from the user's
 * wallet into the send clearing account so it cannot be double-spent while the
 * on-chain broadcast is in flight.
 *
 * Account mapping (credit positive, debit negative; USDT sum = 0):
 *  − user_wallet / walletId            / USDT  −totalDebit  (hold from user)
 *  + clearing    / usdt_send_clearing  / USDT  +totalDebit  (in clearing)
 */
export function buildSendReserveEntries(
  input: BuildSendReserveInput,
): LedgerEntryDraft[] {
  const { walletId, totalDebit, asset, postedAt, accountStates } = input;

  assertPositiveDecimal(totalDebit, 'totalDebit');

  const scaledDebit = toScaled(totalDebit);
  const posDebit = fromScaled(scaledDebit);
  const negDebit = fromScaled(-scaledDebit);

  // Crypto leg — currency is the passed asset (e.g. 'USDT', 'USDC')
  const specs: EntrySpec[] = [
    {
      accountType: LedgerAccountType.user_wallet,
      accountId: walletId,
      currency: asset,
      amount: negDebit,
      description: `Send reserve: ${asset} ${totalDebit} held from user wallet (send + network fee)`,
    },
    {
      accountType: LedgerAccountType.clearing,
      accountId: 'usdt_send_clearing',
      currency: asset,
      amount: posDebit,
      description: `Send reserve: ${asset} ${totalDebit} moved to send clearing`,
    },
  ];

  return specs.map((spec) => buildEntry(spec, accountStates, postedAt));
}

// ── Phase 2a: Finalize (settle — on-chain broadcast confirmed) ───────────────

/** Input to buildSendFinalizeEntries. */
export interface BuildSendFinalizeInput {
  /** accountId for the user_wallet crypto account (used as metadata only — not debited again). */
  walletId: string;
  /** Crypto amount the user is actually sending on-chain (excluding fee). */
  cryptoAmount: string;
  /** Flat on-chain network fee in the same crypto asset. */
  networkFeeCrypto: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Used as the `currency`
   * label on all crypto legs so reads and writes key by (walletId, asset).
   */
  asset: string;
  postedAt: Date;
  accountStates: Record<AccountKey, AccountState>;
}

/**
 * Produce the balanced double-entry `LedgerEntryDraft` rows for the FINALIZE
 * phase of an on-chain USDT SEND (exactly 3 USDT entries; no NGN entries).
 *
 * The total debit (cryptoAmount + networkFeeCrypto) leaves the clearing account:
 *   - cryptoAmount goes to treasury_reserve/usdt_network_out (the on-chain outflow).
 *   - networkFeeCrypto goes to treasury_reserve/usdt_fees (the fee kept by platform).
 *
 * USDT sum = 0 check (let T = cryptoAmount, F = networkFeeCrypto):
 *   clearing:          −(T+F)
 *   usdt_network_out:  +T
 *   usdt_fees:         +F
 *   Sum:               −T−F + T + F = 0 ✓
 *
 * Account mapping:
 *  − clearing         / usdt_send_clearing / USDT  −(cryptoAmount+networkFeeCrypto) (leave clearing)
 *  + treasury_reserve / usdt_network_out   / USDT  +cryptoAmount                   (on-chain outflow)
 *  + treasury_reserve / usdt_fees          / USDT  +networkFeeCrypto               (fee kept)
 */
export function buildSendFinalizeEntries(
  input: BuildSendFinalizeInput,
): LedgerEntryDraft[] {
  const { cryptoAmount, networkFeeCrypto, asset, postedAt, accountStates } =
    input;

  assertPositiveDecimal(cryptoAmount, 'cryptoAmount');
  assertPositiveDecimal(networkFeeCrypto, 'networkFeeCrypto');

  const scaledCrypto = toScaled(cryptoAmount);
  const scaledFee = toScaled(networkFeeCrypto);
  const scaledTotal = scaledCrypto + scaledFee;

  const negTotal = fromScaled(-scaledTotal);
  const posOut = fromScaled(scaledCrypto);
  const posFee = fromScaled(scaledFee);
  const totalDebitStr = fromScaled(scaledTotal);

  // Crypto leg — currency is the passed asset (e.g. 'USDT', 'USDC')
  const specs: EntrySpec[] = [
    // Clearing debit — the total (amount + fee) leaves the clearing account.
    {
      accountType: LedgerAccountType.clearing,
      accountId: 'usdt_send_clearing',
      currency: asset,
      amount: negTotal,
      description: `Send finalize: ${asset} ${totalDebitStr} leaves clearing (${cryptoAmount} sent + ${networkFeeCrypto} fee)`,
    },
    // On-chain outflow credit — the amount the recipient receives.
    {
      accountType: LedgerAccountType.treasury_reserve,
      accountId: 'usdt_network_out',
      currency: asset,
      amount: posOut,
      description: `Send finalize: ${asset} ${cryptoAmount} on-chain outflow to recipient`,
    },
    // Fee credit — the network fee kept by the platform.
    {
      accountType: LedgerAccountType.treasury_reserve,
      accountId: 'usdt_fees',
      currency: asset,
      amount: posFee,
      description: `Send finalize: ${asset} ${networkFeeCrypto} network fee booked to treasury`,
    },
  ];

  return specs.map((spec) => buildEntry(spec, accountStates, postedAt));
}

// ── Phase 2b: Refund (settle — on-chain broadcast failed) ────────────────────

/** Input to buildSendRefundEntries. */
export interface BuildSendRefundInput {
  /** accountId for the user_wallet crypto account. */
  walletId: string;
  /**
   * Total crypto amount to refund (same value as the original totalDebit at reserve).
   */
  totalDebit: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Used as the `currency`
   * label on all crypto legs so reads and writes key by (walletId, asset).
   */
  asset: string;
  postedAt: Date;
  accountStates: Record<AccountKey, AccountState>;
}

/**
 * Produce the balanced double-entry `LedgerEntryDraft` rows for the REFUND
 * phase of a failed on-chain USDT SEND (exactly 2 USDT entries; mirrors
 * reserve in reverse).
 *
 * Account mapping (credit positive, debit negative; USDT sum = 0):
 *  − clearing    / usdt_send_clearing / USDT  −totalDebit  (leave clearing)
 *  + user_wallet / walletId           / USDT  +totalDebit  (refund to user)
 */
export function buildSendRefundEntries(
  input: BuildSendRefundInput,
): LedgerEntryDraft[] {
  const { walletId, totalDebit, asset, postedAt, accountStates } = input;

  assertPositiveDecimal(totalDebit, 'totalDebit');

  const scaledDebit = toScaled(totalDebit);
  const posDebit = fromScaled(scaledDebit);
  const negDebit = fromScaled(-scaledDebit);

  // Crypto leg — currency is the passed asset (e.g. 'USDT', 'USDC')
  const specs: EntrySpec[] = [
    {
      accountType: LedgerAccountType.clearing,
      accountId: 'usdt_send_clearing',
      currency: asset,
      amount: negDebit,
      description: `Send refund: ${asset} ${totalDebit} leaves clearing`,
    },
    {
      accountType: LedgerAccountType.user_wallet,
      accountId: walletId,
      currency: asset,
      amount: posDebit,
      description: `Send refund: ${asset} ${totalDebit} returned to user wallet`,
    },
  ];

  return specs.map((spec) => buildEntry(spec, accountStates, postedAt));
}

// ── Swap — Phase 1: Reserve (fromAsset held while swap is in-flight) ──────────

/** Input to buildSwapReserveEntries. */
export interface BuildSwapReserveInput {
  /** accountId for the user_wallet fromAsset account. */
  walletId: string;
  /** Amount of fromAsset to reserve (decimal string, e.g. "100"). */
  fromAmount: string;
  /** The fromAsset symbol (e.g. 'USDT'). */
  fromAsset: string;
  postedAt: Date;
  accountStates: Record<AccountKey, AccountState>;
}

/**
 * Produce the balanced double-entry `LedgerEntryDraft` rows for the RESERVE
 * phase of a crypto-to-crypto SWAP (exactly 2 fromAsset entries).
 *
 * The fromAmount is moved from the user's wallet into the swap clearing account
 * so it cannot be double-spent while the provider swap is in-flight.
 *
 * Account mapping (credit positive, debit negative; fromAsset sum = 0):
 *  − user_wallet  / walletId          / fromAsset  −fromAmount  (hold from user)
 *  + clearing     / swap_clearing     / fromAsset  +fromAmount  (in clearing)
 */
export function buildSwapReserveEntries(
  input: BuildSwapReserveInput,
): LedgerEntryDraft[] {
  const { walletId, fromAmount, fromAsset, postedAt, accountStates } = input;

  assertPositiveDecimal(fromAmount, 'fromAmount');

  const scaledFrom = toScaled(fromAmount);
  const posFrom = fromScaled(scaledFrom);
  const negFrom = fromScaled(-scaledFrom);

  const specs: EntrySpec[] = [
    {
      accountType: LedgerAccountType.user_wallet,
      accountId: walletId,
      currency: fromAsset,
      amount: negFrom,
      description: `Swap reserve: ${fromAsset} ${fromAmount} held from user wallet`,
    },
    {
      accountType: LedgerAccountType.clearing,
      accountId: 'swap_clearing',
      currency: fromAsset,
      amount: posFrom,
      description: `Swap reserve: ${fromAsset} ${fromAmount} moved to swap clearing`,
    },
  ];

  return specs.map((spec) => buildEntry(spec, accountStates, postedAt));
}

// ── Swap — Phase 2a: Finalize (toAsset credited, fromAsset leaves clearing) ──

/** Input to buildSwapFinalizeEntries. */
export interface BuildSwapFinalizeInput {
  /** accountId for the user_wallet (used for both fromAsset and toAsset legs). */
  walletId: string;
  /** Amount of fromAsset that was reserved and now leaves clearing. */
  fromAmount: string;
  /** The fromAsset symbol (e.g. 'USDT'). */
  fromAsset: string;
  /** Amount of toAsset credited to the user. */
  toAmount: string;
  /** The toAsset symbol (e.g. 'TRX'). */
  toAsset: string;
  postedAt: Date;
  accountStates: Record<AccountKey, AccountState>;
}

/**
 * Produce the balanced double-entry `LedgerEntryDraft` rows for the FINALIZE
 * phase of a completed swap (2 fromAsset + 2 toAsset = 4 entries).
 *
 * fromAsset flow: clearing → treasury_reserve (fromAsset leaves the platform)
 * toAsset flow:  treasury_reserve → user_wallet (toAsset credited to user)
 *
 * Account mapping:
 *  fromAsset legs (sum = 0):
 *    − clearing        / swap_clearing     / fromAsset  −fromAmount  (leave clearing)
 *    + treasury_reserve/ swap_out          / fromAsset  +fromAmount  (provider received)
 *  toAsset legs (sum = 0):
 *    − treasury_reserve/ swap_in           / toAsset    −toAmount    (from treasury)
 *    + user_wallet     / walletId          / toAsset    +toAmount    (credit user)
 */
export function buildSwapFinalizeEntries(
  input: BuildSwapFinalizeInput,
): LedgerEntryDraft[] {
  const {
    walletId,
    fromAmount,
    fromAsset,
    toAmount,
    toAsset,
    postedAt,
    accountStates,
  } = input;

  assertPositiveDecimal(fromAmount, 'fromAmount');
  assertPositiveDecimal(toAmount, 'toAmount');

  const scaledFrom = toScaled(fromAmount);
  const posFrom = fromScaled(scaledFrom);
  const negFrom = fromScaled(-scaledFrom);

  const scaledTo = toScaled(toAmount);
  const posTo = fromScaled(scaledTo);
  const negTo = fromScaled(-scaledTo);

  const specs: EntrySpec[] = [
    // fromAsset leg 1: clearing → treasury_reserve/swap_out
    {
      accountType: LedgerAccountType.clearing,
      accountId: 'swap_clearing',
      currency: fromAsset,
      amount: negFrom,
      description: `Swap finalize: ${fromAsset} ${fromAmount} leaves clearing (sent to provider)`,
    },
    {
      accountType: LedgerAccountType.treasury_reserve,
      accountId: 'swap_out',
      currency: fromAsset,
      amount: posFrom,
      description: `Swap finalize: ${fromAsset} ${fromAmount} booked to swap_out treasury`,
    },
    // toAsset leg: treasury_reserve/swap_in → user_wallet
    {
      accountType: LedgerAccountType.treasury_reserve,
      accountId: 'swap_in',
      currency: toAsset,
      amount: negTo,
      description: `Swap finalize: ${toAsset} ${toAmount} sourced from swap_in treasury`,
    },
    {
      accountType: LedgerAccountType.user_wallet,
      accountId: walletId,
      currency: toAsset,
      amount: posTo,
      description: `Swap finalize: ${toAsset} ${toAmount} credited to user wallet`,
    },
  ];

  return specs.map((spec) => buildEntry(spec, accountStates, postedAt));
}

// ── Swap — Phase 2b: Refund (fromAsset returned to user on failure) ──────────

/** Input to buildSwapRefundEntries. */
export interface BuildSwapRefundInput {
  /** accountId for the user_wallet fromAsset account. */
  walletId: string;
  /** Amount of fromAsset to refund (same as reserve). */
  fromAmount: string;
  /** The fromAsset symbol (e.g. 'USDT'). */
  fromAsset: string;
  postedAt: Date;
  accountStates: Record<AccountKey, AccountState>;
}

/**
 * Produce the balanced double-entry `LedgerEntryDraft` rows for the REFUND
 * phase of a failed swap (2 fromAsset entries; mirrors reserve in reverse).
 *
 * Account mapping (credit positive, debit negative; fromAsset sum = 0):
 *  − clearing    / swap_clearing  / fromAsset  −fromAmount  (leave clearing)
 *  + user_wallet / walletId       / fromAsset  +fromAmount  (refund to user)
 */
export function buildSwapRefundEntries(
  input: BuildSwapRefundInput,
): LedgerEntryDraft[] {
  const { walletId, fromAmount, fromAsset, postedAt, accountStates } = input;

  assertPositiveDecimal(fromAmount, 'fromAmount');

  const scaledFrom = toScaled(fromAmount);
  const posFrom = fromScaled(scaledFrom);
  const negFrom = fromScaled(-scaledFrom);

  const specs: EntrySpec[] = [
    {
      accountType: LedgerAccountType.clearing,
      accountId: 'swap_clearing',
      currency: fromAsset,
      amount: negFrom,
      description: `Swap refund: ${fromAsset} ${fromAmount} leaves clearing`,
    },
    {
      accountType: LedgerAccountType.user_wallet,
      accountId: walletId,
      currency: fromAsset,
      amount: posFrom,
      description: `Swap refund: ${fromAsset} ${fromAmount} returned to user wallet`,
    },
  ];

  return specs.map((spec) => buildEntry(spec, accountStates, postedAt));
}
