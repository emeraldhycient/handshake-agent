/**
 * Domain errors for the deterministic execution engine (task 4.5a, CLAUDE.md §3.1).
 *
 * These are pure domain errors — no Nest, no Prisma, no framework imports.
 * They carry stable error codes so callers can branch on type without relying on
 * message strings. All extend Error directly for maximum portability.
 *
 * PIN/directive/gate errors propagate from their own domain files (reused here
 * by the engine service).
 */

/**
 * Thrown when the Proposal cannot be executed: not found, wrong owner, wrong status.
 * Code: ENGINE_PROPOSAL_NOT_EXECUTABLE
 */
export class ProposalNotExecutableError extends Error {
  readonly code = 'ENGINE_PROPOSAL_NOT_EXECUTABLE' as const;

  constructor(reason: string) {
    super(`Proposal not executable: ${reason}`);
    this.name = 'ProposalNotExecutableError';
  }
}

/**
 * Thrown when the Proposal's expiresAt is in the past at execution time.
 * Code: ENGINE_PROPOSAL_EXPIRED
 */
export class ProposalExpiredError extends Error {
  readonly code = 'ENGINE_PROPOSAL_EXPIRED' as const;

  constructor() {
    super('Proposal has expired and can no longer be executed');
    this.name = 'ProposalExpiredError';
  }
}

/**
 * Thrown when the effective FX rate has drifted beyond the configured maximum
 * drift basis points since the original quote was taken.
 * Code: ENGINE_QUOTE_DRIFT
 */
export class QuoteDriftError extends Error {
  readonly code = 'ENGINE_QUOTE_DRIFT' as const;

  constructor(driftBps: number, maxBps: number) {
    super(
      `FX rate drifted ${driftBps.toFixed(2)} bps — exceeds max allowed ${maxBps} bps; please re-quote`,
    );
    this.name = 'QuoteDriftError';
  }
}

/**
 * Thrown when settleBuyPayment is called for a Transaction whose status is not
 * 'settling' (and not already 'completed' — that is handled as idempotent).
 * Code: ENGINE_SETTLEMENT_INVALID_STATUS
 */
export class SettlementInvalidStatusError extends Error {
  readonly code = 'ENGINE_SETTLEMENT_INVALID_STATUS' as const;

  constructor(status: string) {
    super(
      `Cannot settle transaction with status '${status}'; expected 'settling'`,
    );
    this.name = 'SettlementInvalidStatusError';
  }
}

/**
 * Thrown by ProposalService.createSellProposal when the user's ledger balance
 * for the asset being sold is less than the requested cryptoAmount.
 * Code: SELL_INSUFFICIENT_BALANCE
 */
export class InsufficientBalanceError extends Error {
  readonly code = 'SELL_INSUFFICIENT_BALANCE' as const;

  constructor(available: string, requested: string, asset: string) {
    super(
      `Insufficient ${asset} balance: have ${available}, need ${requested}`,
    );
    this.name = 'InsufficientBalanceError';
  }
}

/**
 * Thrown by the settlement kernel when RECEIPT_SIGNING_KEY is empty.
 * The kernel is fail-closed: no unsigned receipt is ever written.
 * Code: RECEIPT_NOT_SIGNABLE
 */
export class ReceiptNotSignableError extends Error {
  readonly code = 'RECEIPT_NOT_SIGNABLE' as const;

  constructor() {
    super(
      'RECEIPT_SIGNING_KEY is not configured — cannot mint a signed receipt (fail-closed)',
    );
    this.name = 'ReceiptNotSignableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
