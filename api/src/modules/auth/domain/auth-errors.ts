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

/**
 * Device binding hit the `User.pinnedDeviceId` UNIQUE constraint: the device
 * fingerprint being bound is already pinned to a DIFFERENT user (a shared or
 * re-used browser, or a device that changed owners). §3.4 pins one device per
 * identity, so this collision is an expected, actionable outcome — the caller
 * (login/verify) must surface it as a clean 409, not as the raw Prisma P2002
 * that would otherwise escape to the global filter as an opaque 500.
 */
export class DeviceAlreadyBoundError extends AuthDomainError {
  readonly code = 'DEVICE_ALREADY_BOUND' as const;

  constructor() {
    super('This device is already linked to another account');
    this.name = 'DeviceAlreadyBoundError';
  }
}

/**
 * PayID minting could not find a free handle for a new user after exhausting
 * both the incrementing-suffix retries and the random-suffix fallback (Spec 2,
 * Task 3). This is effectively unreachable — the random suffix makes a full
 * exhaustion astronomically unlikely — but minting is inside the signup
 * transaction, so a typed error (rather than a bare `throw new Error`) keeps
 * parity with {@link DeviceAlreadyBoundError} and lets the controller map it to
 * a clean 500 instead of leaking a raw Error to the global filter.
 */
export class PayIdMintExhaustedError extends AuthDomainError {
  readonly code = 'PAYID_MINT_EXHAUSTED' as const;

  constructor() {
    super('Could not allocate a PayID — please try again');
    this.name = 'PayIdMintExhaustedError';
  }
}
