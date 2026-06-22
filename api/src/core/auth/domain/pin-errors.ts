/**
 * PIN domain errors (task 4.3, CLAUDE.md §4.1 / §3.4).
 *
 * Pure module — no Nest, no Prisma. Stable `code` property lets callers
 * switch-branch on the error type without relying on instanceof across
 * module boundaries.
 */

export type PinErrorCode = 'PIN_NOT_SET' | 'PIN_LOCKED' | 'PIN_INVALID';

/** Base class for all PIN-related errors. */
export abstract class PinError extends Error {
  abstract readonly code: PinErrorCode;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain (needed when transpiling to ES5/CommonJS).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The user has no PIN set yet; they must call `setPin` first. */
export class PinNotSetError extends PinError {
  readonly code = 'PIN_NOT_SET' as const;

  constructor() {
    super('No PIN has been set for this user.');
  }
}

/** The account is temporarily locked due to too many failed attempts. */
export class PinLockedError extends PinError {
  readonly code = 'PIN_LOCKED' as const;

  constructor(readonly lockedUntil: Date) {
    super(
      `Account is locked until ${lockedUntil.toISOString()} due to repeated PIN failures.`,
    );
  }
}

/** The supplied PIN did not match the stored hash. */
export class PinInvalidError extends PinError {
  readonly code = 'PIN_INVALID' as const;

  constructor(remainingAttempts: number) {
    super(
      `Incorrect PIN. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining before lockout.`,
    );
  }
}
