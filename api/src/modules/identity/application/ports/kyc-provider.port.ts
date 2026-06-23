/**
 * DI token and port contract for the KYC verification provider.
 *
 * Infrastructure provides the concrete adapter (mock for now; a real
 * NIN/BVN/liveness provider implements the same interface later).
 * Application code only depends on this token and the types below — it never
 * imports infrastructure or the concrete class (clean-arch §4.1).
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
// Port interface
// ---------------------------------------------------------------------------

export interface IKycProvider {
  /**
   * Submits the identity fields for verification and returns the result.
   * Implementations must be idempotent (the execution engine may retry).
   */
  verify(input: KycVerifyInput): Promise<KycVerifyResult>;
}
