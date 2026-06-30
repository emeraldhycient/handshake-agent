/**
 * Admin platform domain errors. Pure — no Nest, no Prisma. Each carries a stable
 * `code` (its cross-boundary discriminant) so the global DomainExceptionFilter
 * maps it to the right HTTP status without importing these classes.
 */

export type AdminErrorCode =
  | 'ADMIN_INVALID_CREDENTIALS'
  | 'ADMIN_MFA_REQUIRED'
  | 'ADMIN_MFA_INVALID'
  | 'ADMIN_INACTIVE'
  | 'ADMIN_STEP_UP_REQUIRED'
  | 'ADMIN_PERMISSION_DENIED'
  | 'ADMIN_INVITATION_INVALID'
  | 'ADMIN_BUILTIN_ROLE_IMMUTABLE'
  | 'ADMIN_BOOTSTRAP_FORBIDDEN'
  | 'ADMIN_NOT_FOUND';

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
