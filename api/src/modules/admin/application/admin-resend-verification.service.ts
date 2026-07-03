import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../../../core/audit/application/audit.service';
import {
  IDENTITY_REPOSITORY,
  type IIdentityRepository,
} from '../../identity/application/ports/identity.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';
import {
  VERIFICATION_OUTBOX_REPOSITORY,
  type IVerificationOutboxRepository,
} from './ports/verification-outbox.repository.port';

/**
 * The NotificationTemplate.templateKey the resend nudge renders. A code-level
 * routing choice (which template to send), not an ops-tunable business value —
 * the template's CONTENT is admin-editable via the NotificationTemplate layer,
 * but the key that selects it is a static default (§7).
 */
const VERIFICATION_TEMPLATE_KEY = 'onboarding.verification.resend';

/**
 * ADM Phase 9 — the admin RESEND-VERIFICATION service. An operator re-sends a
 * user's onboarding/verification nudge (e.g. the email never arrived). This
 * service:
 *
 *   1. re-checks the target user SERVER-SIDE (§3.3) — 404 on an unknown id, so an
 *      enqueue can never target a non-existent account;
 *   2. ENQUEUES one verification `Notification` into the outbox (the dispatch
 *      worker sends it later — no email provider is called here); and
 *   3. immutably audits the resend as `admin_update` against `User:<id>`, carrying
 *      the operator's optional reason.
 *
 * FUNDS-SAFETY: a verification nudge moves NO money (§3.1). The service holds no
 * Prisma import — it reaches the DB only through the injected identity + outbox
 * ports (§3.2). The enqueue happens BEFORE the audit, so we never record a send
 * that did not occur. It is a LOW-RISK write (no step-up); the reason is optional.
 */
@Injectable()
export class AdminResendVerificationService {
  constructor(
    @Inject(IDENTITY_REPOSITORY)
    private readonly identity: IIdentityRepository,
    @Inject(VERIFICATION_OUTBOX_REPOSITORY)
    private readonly outbox: IVerificationOutboxRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Re-enqueue the verification nudge for the target user. The user id is the
   * route :id — never trusted from the body. `reason` is the operator's optional
   * audited justification (a resend is often a courtesy action).
   */
  async resend(
    userId: string,
    adminId: string,
    reason: string | undefined,
  ): Promise<void> {
    const user = await this.identity.loadUser(userId);
    if (!user) throw new AdminNotFoundError('User');

    // A fresh ref per request — the operator's intent is to send again — while the
    // outbox unique still absorbs an accidental same-request replay (idempotent).
    const eventRef = `verification-resend:${randomUUID()}`;
    await this.outbox.enqueueVerification({
      userId,
      eventRef,
      templateKey: VERIFICATION_TEMPLATE_KEY,
      templateVars: { userId, reason: reason ?? null },
    });

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `User:${userId}`,
      action: 'admin_update',
      details: {
        kind: 'resend_verification',
        eventRef,
        reason: reason ?? null,
      },
    });
  }
}
