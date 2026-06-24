/**
 * Domain error hierarchy for compliance/sanctions screening (N2).
 *
 * Pure domain — NO Nest, NO Prisma, NO external imports.
 * Each error carries a stable `code` string so callers can switch on type
 * without instanceof gymnastics across module boundaries (CLAUDE.md §4.1).
 */

export abstract class ComplianceDomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain (needed when target < ES2022 transpiles classes).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The destination address was flagged by the sanctions screener.
 * The caller (N3 send proposal) must block the send and surface this error.
 *
 * Carries the screening reference for audit traceability and the reason
 * text from the provider (or a generic message when absent).
 */
export class SanctionsBlockedError extends ComplianceDomainError {
  readonly code = 'SANCTIONS_BLOCKED' as const;

  constructor(
    readonly address: string,
    readonly reason: string | undefined,
    readonly complianceEventId: string,
    readonly reference: string,
  ) {
    super(
      reason
        ? `Send blocked: destination address flagged — ${reason} (event: ${complianceEventId})`
        : `Send blocked: destination address is sanctioned (event: ${complianceEventId})`,
    );
  }
}
