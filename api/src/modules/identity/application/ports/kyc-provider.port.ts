import type { KycTierLevel } from '@handshake-agent/contracts';

/**
 * DI token and port contract for the KYC verification provider.
 *
 * Infrastructure provides the concrete adapter (mock, or the real Sumsub
 * adapter — task 3.3). Application code only depends on this token and the
 * types below — it never imports infrastructure or the concrete class
 * (clean-arch §4.1).
 */
export const KYC_PROVIDER = Symbol('KYC_PROVIDER');

// ---------------------------------------------------------------------------
// Application-layer tier type — NOT the Prisma enum.
// Infrastructure maps Prisma's KycTier enum to this string-literal union before
// returning; application and domain stay DB-agnostic.
// ---------------------------------------------------------------------------

/**
 * String-literal union for KYC tier — the application-layer representation.
 * Maps 1-to-1 to the Prisma `KycTier` enum but is defined here so the
 * application layer never imports `@prisma/client` (CLAUDE.md §3.2 / §4.1).
 */
export type KycTierValue = 'unverified' | 'tier_1' | 'tier_2' | 'tier_3';

// ---------------------------------------------------------------------------
// Async verification-session (Sumsub WebSDK) input / output — task 3.3
// ---------------------------------------------------------------------------

export interface CreateVerificationSessionInput {
  /** Our internal user id — sent to Sumsub as `externalUserId`/`userId`. */
  userId: string;
  /** Our tier — the adapter maps this to the Sumsub dashboard LEVEL NAME. */
  level: KycTierLevel;
}

export interface CreateVerificationSessionResult {
  /** Short-lived Sumsub WebSDK access token the frontend passes to the SDK init call. */
  token: string;
  /** Sumsub applicant reference (externalUserId-derived) for audit / reconciliation. */
  applicantId: string;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IKycProvider {
  /**
   * Mints a short-lived Sumsub WebSDK access token so the frontend can launch
   * an in-browser verification session for a tier_2/tier_3 upgrade. Read-only
   * from the money-path's perspective — it never grants a tier itself; the
   * tier is only granted once Sumsub's `applicantReviewed` webhook reports a
   * GREEN review (a later task).
   */
  createVerificationSession(
    input: CreateVerificationSessionInput,
  ): Promise<CreateVerificationSessionResult>;
}
