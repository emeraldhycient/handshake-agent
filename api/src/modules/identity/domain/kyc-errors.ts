/**
 * Domain error hierarchy for KYC verification (K2).
 *
 * Pure domain — NO Nest, NO Prisma, NO external imports.
 * Each error carries a stable `code` string so callers can switch on type
 * without instanceof gymnastics across module boundaries (CLAUDE.md §4.1).
 */

export abstract class KycDomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain (needed when target < ES2022 transpiles classes).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The user requested a Sumsub verification-session `level` above what their
 * current KYC tier permits (task 3.4). The tier ladder must be climbed one
 * rung at a time: minting a `tier_2` token requires `tierAtLeast(kycTier,
 * 'tier_1')`; minting a `tier_3` token requires `tierAtLeast(kycTier,
 * 'tier_2')`. An `unverified` user requesting `tier_2` (or any user trying to
 * skip a rung) hits this — mapped to a 403 by DomainExceptionFilter.
 */
export class SumsubPrerequisiteNotMetError extends KycDomainError {
  readonly code = 'SUMSUB_PREREQUISITE_NOT_MET' as const;

  constructor(
    readonly requestedLevel: string,
    readonly requiredTier: string,
    readonly actualTier: string,
  ) {
    super(
      `Cannot request Sumsub verification level '${requestedLevel}': requires ` +
        `KYC tier '${requiredTier}' or above; this account is '${actualTier}'.`,
    );
  }
}

/**
 * A Contact/User is already linked/verified. Not currently thrown by any
 * caller (the legacy idempotent-return callers were retired — see
 * docs/superpowers/plans/2026-07-13-retire-legacy-sync-kyc-endpoints.md);
 * this class is kept as a typed signal for future callers that need to
 * distinguish an "already done" branch from a "just done" branch.
 */
export class AlreadyVerifiedError extends KycDomainError {
  readonly code = 'ALREADY_VERIFIED' as const;

  constructor(readonly userId: string) {
    super(
      `Contact is already linked to a verified User: ${userId}. ` +
        'Returning existing userId (idempotent).',
    );
  }
}
