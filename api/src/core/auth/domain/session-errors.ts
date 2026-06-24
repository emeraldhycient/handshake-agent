/**
 * Session / step-up domain errors (Fix G, CLAUDE.md §3.4 / §4.1).
 *
 * Pure module — no Nest, no Prisma. Stable `code` property lets callers
 * switch-branch on the error type without relying on instanceof across
 * module boundaries.
 */

export type SessionErrorCode = 'STEP_UP_REQUIRED';

/** Base class for session-related errors. */
export abstract class SessionError extends Error {
  abstract readonly code: SessionErrorCode;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain (needed when transpiling to ES5/CommonJS).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown by SessionService.assertStepUpFresh when there is no active session
 * for the user+device pair, or when the recorded stepUpCompletedAt is null or
 * older than the configured TTL.
 *
 * Callers (e.g. executeSend after PIN passes) treat this as a hard barrier —
 * no transaction proceeds until a fresh step-up is recorded.
 */
export class StepUpRequiredError extends SessionError {
  readonly code = 'STEP_UP_REQUIRED' as const;

  constructor(reason: 'no_session' | 'not_completed' | 'expired') {
    const msg =
      reason === 'no_session'
        ? 'No active session found for this user/device — step-up required.'
        : reason === 'not_completed'
          ? 'No step-up has been completed on this session — step-up required.'
          : 'Step-up has expired — a fresh step-up is required.';
    super(msg);
  }
}
