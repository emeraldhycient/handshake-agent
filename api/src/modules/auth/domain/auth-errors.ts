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

/** The login OTP is wrong, expired, or exhausted. Generic on purpose. */
export class InvalidOtpError extends AuthDomainError {
  constructor() {
    super('The code is invalid or has expired');
    this.name = 'InvalidOtpError';
  }
}

/** The presented refresh token is unknown, expired, or revoked. */
export class InvalidRefreshTokenError extends AuthDomainError {
  constructor() {
    super('Session expired — please sign in again');
    this.name = 'InvalidRefreshTokenError';
  }
}
