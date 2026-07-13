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
 * The supplied channelAddress has no matching Contact + ChannelIdentity in the
 * system. The caller should guide the user through onboarding first.
 */
export class ContactNotFoundError extends KycDomainError {
  readonly code = 'CONTACT_NOT_FOUND' as const;

  constructor(channelAddress: string) {
    super(
      `No Contact found for channel address: ${channelAddress}. ` +
        'The user must be onboarded before completing KYC.',
    );
  }
}

/**
 * Friendly, client-safe copy for a KYC rejection. The raw provider `reason`
 * (which may carry internal provider detail) is kept on the error for
 * server-side logging only and is NEVER sent to the client (CLAUDE.md §3.3).
 */
export const KYC_REJECTED_USER_MESSAGE =
  "We couldn't verify your identity. Please check that your NIN or BVN is " +
  'correct (11 digits) and that your name matches your records, then try ' +
  'again.';

/**
 * The KYC provider rejected the submitted identity data. Carries the raw
 * provider `reason` for logging and a separate `userMessage` for display —
 * callers map the friendly `userMessage` to the HTTP response, never `reason`.
 */
export class KycRejectedError extends KycDomainError {
  readonly code = 'KYC_REJECTED' as const;

  /** Client-safe message — safe to surface verbatim to the user. */
  readonly userMessage = KYC_REJECTED_USER_MESSAGE;

  constructor(readonly reason: string | undefined) {
    super(
      reason
        ? `KYC verification was rejected: ${reason}`
        : 'KYC verification was rejected by the provider.',
    );
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
 * The Contact is already linked to a verified User. The service returns the
 * existing userId (idempotent) and this error is NOT thrown — the service
 * documents the idempotent-return behavior. However, callers that want to
 * distinguish the "already done" branch from the "just done" branch can catch
 * this typed error if the service is configured to throw instead.
 *
 * Current behavior (K2): the service returns `{ userId }` of the existing user
 * (idempotent). This class exists as a typed signal for future callers.
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
