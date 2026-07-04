/**
 * Admin platform domain errors. Pure — no Nest, no Prisma. Each carries a stable
 * `code` (its cross-boundary discriminant) so the global DomainExceptionFilter
 * maps it to the right HTTP status without importing these classes.
 */

export type AdminErrorCode =
  | 'ADMIN_INVALID_CREDENTIALS'
  | 'ADMIN_ACCOUNT_LOCKED'
  | 'ADMIN_MFA_REQUIRED'
  | 'ADMIN_MFA_INVALID'
  | 'ADMIN_INACTIVE'
  | 'ADMIN_STEP_UP_REQUIRED'
  | 'ADMIN_PERMISSION_DENIED'
  | 'ADMIN_INVITATION_INVALID'
  | 'ADMIN_BUILTIN_ROLE_IMMUTABLE'
  | 'ADMIN_BOOTSTRAP_FORBIDDEN'
  | 'ADMIN_NOT_FOUND'
  | 'ADMIN_TXN_NOT_TRIAGEABLE'
  | 'ADMIN_SELF_APPROVAL_FORBIDDEN'
  | 'ADMIN_CHANGE_REQUEST_NOT_PENDING'
  | 'ADMIN_CHANGE_REQUEST_NOT_APPLICABLE'
  | 'ADMIN_BULK_CONFIRMATION_REQUIRED'
  | 'ADMIN_MANUAL_CREDIT_NOT_ALLOWED'
  | 'ADMIN_PAYOUT_RETRY_BLOCKED'
  | 'ADMIN_SELF_ACTION_FORBIDDEN';

export abstract class AdminError extends Error {
  abstract readonly code: AdminErrorCode;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Wrong email/password — deliberately indistinguishable from unknown-email. */
export class AdminInvalidCredentialsError extends AdminError {
  readonly code = 'ADMIN_INVALID_CREDENTIALS' as const;
  constructor() {
    super('Invalid admin credentials.');
  }
}

/**
 * The account is temporarily locked after too many consecutive failed logins
 * (credential-stuffing / password-spray guard, §3.3). The per-account counter is
 * incremented atomically before the password verify so a concurrent burst is
 * capped at maxAttempts. Maps to HTTP 429 (Too Many Requests) — mirrors the
 * end-user OTP/PIN lockout semantics; the operator retries after the window.
 */
export class AdminAccountLockedError extends AdminError {
  readonly code = 'ADMIN_ACCOUNT_LOCKED' as const;
  constructor() {
    super('This admin account is temporarily locked. Please try again later.');
  }
}

/** Password ok but MFA is enabled and no/empty TOTP (or recovery code) supplied. */
export class AdminMfaRequiredError extends AdminError {
  readonly code = 'ADMIN_MFA_REQUIRED' as const;
  constructor() {
    super('A multi-factor code is required.');
  }
}

/** A supplied TOTP or recovery code did not verify. */
export class AdminMfaInvalidError extends AdminError {
  readonly code = 'ADMIN_MFA_INVALID' as const;
  constructor() {
    super('The multi-factor code is invalid.');
  }
}

/** The admin account is not active (pending / suspended / offboarded). */
export class AdminInactiveError extends AdminError {
  readonly code = 'ADMIN_INACTIVE' as const;
  constructor() {
    super('This admin account is not active.');
  }
}

/** A sensitive action requires a fresh step-up (re-auth) that is absent/stale. */
export class AdminStepUpRequiredError extends AdminError {
  readonly code = 'ADMIN_STEP_UP_REQUIRED' as const;
  constructor() {
    super('Step-up re-authentication is required for this action.');
  }
}

/** The admin's role does not grant the required permission (default-deny). */
export class AdminPermissionDeniedError extends AdminError {
  readonly code = 'ADMIN_PERMISSION_DENIED' as const;
  constructor() {
    super('You do not have permission to perform this action.');
  }
}

/** Invitation token is unknown, already accepted, or expired. */
export class AdminInvitationInvalidError extends AdminError {
  readonly code = 'ADMIN_INVITATION_INVALID' as const;
  constructor() {
    super('This invitation is invalid or has expired.');
  }
}

/** Attempt to mutate or delete a built-in role. */
export class BuiltinRoleImmutableError extends AdminError {
  readonly code = 'ADMIN_BUILTIN_ROLE_IMMUTABLE' as const;
  constructor() {
    super('Built-in roles cannot be modified.');
  }
}

/** Bootstrap attempted with a bad token or while admins already exist. */
export class AdminBootstrapForbiddenError extends AdminError {
  readonly code = 'ADMIN_BOOTSTRAP_FORBIDDEN' as const;
  constructor() {
    super('Bootstrap is not available.');
  }
}

/** A referenced admin user / role was not found. */
export class AdminNotFoundError extends AdminError {
  readonly code = 'ADMIN_NOT_FOUND' as const;
  constructor(what = 'Resource') {
    super(`${what} not found.`);
  }
}

/**
 * An operator attempted a lifecycle action on their OWN account that would lock
 * them out — suspending or offboarding themselves. Blocked server-side (§3.3)
 * regardless of the operator's permissions; the UI also hides the control on the
 * self row. Maps to HTTP 403.
 */
export class AdminSelfActionForbiddenError extends AdminError {
  readonly code = 'ADMIN_SELF_ACTION_FORBIDDEN' as const;
  constructor(action = 'perform this action on') {
    super(`You cannot ${action} your own admin account.`);
  }
}

/**
 * A bulk broadcast targets more recipients than the large-set threshold, but the
 * operator did not explicitly acknowledge it (`confirmLargeSet` was false). The
 * server re-checks this server-side (§3.3) — the client's flag alone is never
 * trusted to bypass the gate; nothing is enqueued until the operator confirms.
 */
export class AdminBulkConfirmationRequiredError extends AdminError {
  readonly code = 'ADMIN_BULK_CONFIRMATION_REQUIRED' as const;
  constructor(recipientCount: number, threshold: number) {
    super(
      `This broadcast targets ${recipientCount} users (over the ${threshold} large-set threshold); explicit confirmation is required.`,
    );
  }
}

/**
 * A manual credit was requested for a user whose server-side state forbids it —
 * a deactivated account, a sanctions-flagged user, or no custodial wallet on the
 * credited asset's network. This is the money-endpoint server-side re-check
 * (§3.3): the engine credit never runs when it fires. Maps to HTTP 422.
 */
export class ManualCreditNotAllowedError extends AdminError {
  readonly code = 'ADMIN_MANUAL_CREDIT_NOT_ALLOWED' as const;
  constructor(reason: string) {
    super(`Manual credit is not allowed: ${reason}`);
  }
}
