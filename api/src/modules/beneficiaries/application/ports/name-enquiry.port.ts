/**
 * DI token and port contract for the bank name-enquiry provider (Fix E).
 *
 * Infrastructure provides the concrete adapter (MockNameEnquiry for now; a
 * real provider such as a NIBSS/bank API implements the same interface later).
 * Application code only depends on this token and the types below — it never
 * imports infrastructure or the concrete class (clean-arch §4.1).
 */
export const BANK_NAME_ENQUIRY = Symbol('BANK_NAME_ENQUIRY');

// ---------------------------------------------------------------------------
// Port input / output shapes
// ---------------------------------------------------------------------------

export interface NameEnquiryInput {
  /** Receiving-bank sort code / CBN code (e.g. "058" for GTB). */
  bankCode: string;
  /** 10-digit NUBAN account number. */
  accountNumber: string;
}

export interface NameEnquiryResult {
  /** Resolved account-holder name as returned by the bank / clearing house. */
  accountName: string;
  /** Provider identifier (e.g. "mock", "nibss", "paystack"). */
  provider: string;
  /** Provider-side correlation reference for traceability / audit. */
  reference: string;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface INameEnquiry {
  /**
   * Resolves the account-holder name for a given bank code + account number.
   * Implementations must be idempotent (the execution engine may retry).
   *
   * @throws A domain-level error when the account is not found or the lookup
   *         fails — the caller must NOT persist any beneficiary in that case.
   */
  resolve(input: NameEnquiryInput): Promise<NameEnquiryResult>;
}
