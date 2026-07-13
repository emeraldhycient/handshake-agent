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
// Port input / output shapes
// ---------------------------------------------------------------------------

export interface KycVerifyInput {
  /** Nigerian national identification number (optional; nin OR bvn required). */
  nin?: string;
  /** Nigerian bank verification number (optional; nin OR bvn required). */
  bvn?: string;
  firstName: string;
  lastName: string;
  /** ISO-8601 date string (optional, e.g. "1990-05-15"). */
  dateOfBirth?: string;
}

export interface KycVerifyResult {
  /** Whether the verification passed at the given tier. */
  approved: boolean;
  /** The tier granted if approved, or 'unverified' if not. */
  tier: KycTierValue;
  /** Opaque provider reference id for audit / reconciliation. */
  reference: string;
  /** Human-readable rejection reason (present when approved is false). */
  reason?: string;
}

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
   * Submits the identity fields for verification and returns the result.
   * Implementations must be idempotent (the execution engine may retry).
   *
   * This is the legacy synchronous NIN/BVN path still used by /kyc/submit and
   * /kyc/complete (tier_1 onboarding). It is distinct from
   * `createVerificationSession` (the tier_2/tier_3 Sumsub WebSDK upgrade path).
   */
  verify(input: KycVerifyInput): Promise<KycVerifyResult>;

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
