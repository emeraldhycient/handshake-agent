/**
 * DI token and port contract for the sanctions/compliance screening provider.
 *
 * Infrastructure provides the concrete adapter (mock for now; a real provider
 * such as OpenSanctions or TRM implements the same interface later).
 * Application code only depends on this token and the types below — it never
 * imports infrastructure or the concrete class (clean-arch §4.1).
 */
export const SANCTIONS_SCREENER = Symbol('SANCTIONS_SCREENER');

// ---------------------------------------------------------------------------
// Port input / output shapes
// ---------------------------------------------------------------------------

export interface SanctionsScreenInput {
  /** The crypto address to screen. */
  address: string;
  /** The blockchain network (e.g. "tron", "evm"). */
  network: string;
  /** Optional: userId of the initiating user (for audit trail). */
  userId?: string;
}

export interface SanctionsScreenIdentityInput {
  /** The subject user's id — the identity (not an address) to screen. */
  userId: string;
  /** Optional caller-supplied correlation reference for traceability. */
  reference?: string | null;
}

export interface SanctionsScreenResult {
  /** Whether the address passed screening (true = clear, false = flagged). */
  passed: boolean;
  /** Human-readable reason when passed is false. */
  reason?: string;
  /** Screening provider identifier (e.g. "mock", "open_sanctions", "trm"). */
  provider: string;
  /** Provider-side correlation/reference id for traceability. */
  reference: string;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface ISanctionsScreener {
  /**
   * Screens a crypto address against a sanctions/compliance provider.
   * Implementations must be idempotent (the execution engine may retry).
   *
   * @returns SanctionsScreenResult — passed:true means clear to proceed;
   *          passed:false means the address is flagged and the send must be blocked.
   */
  screen(input: SanctionsScreenInput): Promise<SanctionsScreenResult>;

  /**
   * Screens a counterparty by IDENTITY (userId) rather than by on-chain
   * address. Used for internal (user→user) transfers, which have no
   * destination address to AML-screen — the subject is a KYC-verified platform
   * user. This is a distinct capability from {@link screen}: providers that
   * only do address AML (e.g. Blockradar) return a safe pass-through here
   * rather than fail-closing, and must NOT attempt an address lookup.
   *
   * Implementations must be non-throwing and idempotent.
   *
   * @returns SanctionsScreenResult — passed:true means clear to proceed;
   *          passed:false means the counterparty identity is flagged and the
   *          transfer must be blocked.
   */
  screenIdentity(
    input: SanctionsScreenIdentityInput,
  ): Promise<SanctionsScreenResult>;
}
