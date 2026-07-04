/**
 * DI token + port for the admin VERIFICATION-OUTBOX repository (admin-initiated
 * resend-verification, Phase 9).
 *
 * Enqueues a single onboarding/verification nudge into the notifications module's
 * OUTBOX (one `Notification` row) — the same outbox the deterministic dispatch
 * worker already drains, so no email provider is called here. This is the ONLY
 * door to the database for the resend-verification service (clean-arch §4.1,
 * CLAUDE.md §3.2); the concrete Prisma adapter lives in `admin/infrastructure`.
 *
 * FUNDS-SAFETY: a verification nudge moves NO money (§3.1). The enqueue is
 * IDEMPOTENT — the row is anchored on the outbox's `(eventRef, eventType)` unique
 * via the caller-supplied `eventRef`, so an accidental same-request replay inserts
 * nothing new rather than double-sending.
 */

export const VERIFICATION_OUTBOX_REPOSITORY = Symbol(
  'VERIFICATION_OUTBOX_REPOSITORY',
);

/** The parameters a verification enqueue needs. */
export interface EnqueueVerificationInput {
  /** The target user (resolved from the route :id, re-checked server-side). */
  userId: string;
  /**
   * Stable idempotency ref for this enqueue; a same-request replay on the outbox
   * `(eventRef, eventType)` unique is a no-op rather than a double-send. A fresh
   * resend request carries a fresh ref (the operator's intent is to send again).
   */
  eventRef: string;
  /** Points at the NotificationTemplate.templateKey for the verification nudge. */
  templateKey: string;
  /** Frozen render variables for the outbox row (the resend context). */
  templateVars: Record<string, unknown>;
}

/** The result of a verification enqueue. */
export interface EnqueueVerificationResult {
  /**
   * The id of the outbox row (existing row's id when the eventRef already
   * matched — the idempotent no-op case).
   */
  notificationId: string;
}

export interface IVerificationOutboxRepository {
  /**
   * Insert one verification/onboarding `Notification` into the outbox for the
   * target user, idempotently on the supplied `eventRef`. The dispatch worker
   * later renders + sends it; this repository calls no email provider.
   */
  enqueueVerification(
    input: EnqueueVerificationInput,
  ): Promise<EnqueueVerificationResult>;
}
