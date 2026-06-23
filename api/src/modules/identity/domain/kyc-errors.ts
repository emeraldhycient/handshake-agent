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
 * The KYC provider rejected the submitted identity data. Carries the provider
 * reason for display / logging.
 */
export class KycRejectedError extends KycDomainError {
  readonly code = 'KYC_REJECTED' as const;

  constructor(readonly reason: string | undefined) {
    super(
      reason
        ? `KYC verification was rejected: ${reason}`
        : 'KYC verification was rejected by the provider.',
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
