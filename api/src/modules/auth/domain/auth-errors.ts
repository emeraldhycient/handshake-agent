/** Base for all auth domain errors (mapped to HTTP in the controller). */
export abstract class AuthDomainError extends Error {}

/** JWT_SECRET is not configured — token operations are disabled (fail-closed). */
export class TokenSigningDisabledError extends AuthDomainError {
  constructor() {
    super('Token signing is disabled (JWT_SECRET not configured)');
    this.name = 'TokenSigningDisabledError';
  }
}

/** The email-verification token is missing, expired, or already used. */
export class InvalidVerificationTokenError extends AuthDomainError {
  constructor() {
    super('Verification link is invalid or has expired');
    this.name = 'InvalidVerificationTokenError';
  }
}

/** The login OTP is wrong or expired. Generic on purpose. */
export class InvalidOtpError extends AuthDomainError {
  constructor() {
    super('The code is invalid or has expired');
    this.name = 'InvalidOtpError';
  }
}

/**
 * The login OTP challenge has exhausted its guess budget (attemptCount reached
 * the cap). Distinct from {@link InvalidOtpError} so the controller can tell the
 * user to request a fresh code rather than retrying a dead one.
 *
 * Safe to distinguish without leaking account enumeration: this branch is only
 * reachable for a real verified user with a real active challenge — an
 * unknown/unverified email never reaches it (it throws InvalidOtpError first).
 * The message reveals only that guessing was attempted, never whether the email
 * is registered.
 */
export class OtpLockedError extends AuthDomainError {
  readonly code = 'OTP_LOCKED' as const;

  constructor() {
    super('Too many attempts. Please request a new code.');
    this.name = 'OtpLockedError';
  }
}

/** The presented refresh token is unknown, expired, or revoked. */
export class InvalidRefreshTokenError extends AuthDomainError {
  constructor() {
    super('Session expired — please sign in again');
    this.name = 'InvalidRefreshTokenError';
  }
}

/**
 * The session is valid but the underlying user account no longer exists
 * (e.g. deleted). Distinct from {@link InvalidRefreshTokenError}: this is not
 * an authentication failure, so it must not be reported as 401 (which the web
 * client treats as an expired-token signal and retries — a silent loop).
 */
export class UserNotFoundError extends AuthDomainError {
  readonly code = 'USER_NOT_FOUND' as const;

  constructor() {
    super('User account not found');
    this.name = 'UserNotFoundError';
  }
}
