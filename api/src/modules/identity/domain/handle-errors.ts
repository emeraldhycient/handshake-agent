/**
 * Handle-resolution domain errors (Spec 2 — PayID + public nicknames +
 * internal transfer). Pure module — no Nest, no Prisma. Stable `code` mirrors
 * the existing profile/pin-errors pattern (the cross-boundary discriminant
 * the global DomainExceptionFilter matches on).
 */

/**
 * The requested handle is already claimed — either by another user's PayID
 * or by an existing public nickname. PayID and public nicknames share ONE
 * namespace (design §4.2), so this is thrown by both `addPublicNickname`
 * (claiming a new nickname) and `changePayId` (renaming a PayID), and by the
 * repository when a DB-level unique-index violation closes a concurrent
 * check-then-act race.
 */
export class HandleTakenError extends Error {
  readonly code = 'HANDLE_TAKEN' as const;

  constructor(readonly handle: string) {
    super(`The handle "${handle}" is already taken.`);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A user may hold at most `max` public nicknames at once (anti-abuse ceiling). */
export class NicknameCapError extends Error {
  readonly code = 'NICKNAME_CAP_EXCEEDED' as const;

  constructor(readonly max: number) {
    super(`You can have at most ${max} public nicknames.`);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * A PayID may be changed exactly once (design §4.1). A second attempt is
 * rejected regardless of whether the new value would otherwise be available.
 */
export class PayIdAlreadyChangedError extends Error {
  readonly code = 'PAYID_ALREADY_CHANGED' as const;

  constructor() {
    super(
      'Your PayID has already been changed once and cannot be changed again.',
    );
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
