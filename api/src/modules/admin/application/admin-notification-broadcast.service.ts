import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  BroadcastSchedule,
  BroadcastSendRequest,
  BroadcastSendResponse,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import {
  NOTIFICATION_TEMPLATE_REPOSITORY,
  type INotificationTemplateRepository,
} from '../../notifications/application/ports/notification-template.repository.port';
import { BroadcastTemplateUnknownError } from '../domain/admin-errors';
import { AdminApprovalsService } from './admin-approvals.service';
import {
  BROADCAST_DISPATCH_REPOSITORY,
  type IBroadcastDispatchRepository,
} from './ports/broadcast-dispatch.repository.port';

/**
 * The DB-admin config key for the maker-checker size gate (root §7). Tunable from
 * the admin console via the AppSetting layer without a deploy; falls back to the
 * default constant below when unset. Any cohort whose resolved size is AT/ABOVE
 * this many recipients must go through a second admin (§3.5).
 */
const MAKER_CHECKER_THRESHOLD_KEY =
  'notifications.broadcast.makerCheckerThreshold';
const DEFAULT_MAKER_CHECKER_THRESHOLD = 10_000;

/**
 * Phase 7 — the admin Comms BROADCAST-SEND service. An operator picks an audience
 * cohort + template + schedule; this service resolves the cohort size SERVER-SIDE
 * (never trusting the client) and decides the disposition:
 *
 *   - SMALL audience (below the maker-checker threshold) → dispatch directly by
 *     enqueueing the broadcast into the notifications outbox (idempotent, audited).
 *   - LARGE audience (at/above the threshold) → capture a pending
 *     `notification_broadcast` ChangeRequest for a SECOND admin (four-eyes, §3.5);
 *     NOTHING is dispatched until that request is approved, at which point the SAME
 *     outbox enqueue is re-run by the approvals applier.
 *
 * FUNDS-SAFETY: a broadcast moves NO money (§3.1). It holds no Prisma import — it
 * reaches recipients only through the injected BROADCAST_DISPATCH_REPOSITORY port
 * (§3.2), defers dual-control to the shared approvals engine, and audits every
 * direct dispatch immutably. The outbox enqueue is idempotency-anchored on a
 * per-broadcast id, so a replay never double-blasts.
 */
@Injectable()
export class AdminNotificationBroadcastService {
  constructor(
    @Inject(BROADCAST_DISPATCH_REPOSITORY)
    private readonly dispatch: IBroadcastDispatchRepository,
    @Inject(NOTIFICATION_TEMPLATE_REPOSITORY)
    private readonly templates: INotificationTemplateRepository,
    private readonly approvals: AdminApprovalsService,
    private readonly audit: AuditService,
    private readonly config: EffectiveConfigService,
  ) {}

  /**
   * Send (or queue-for-approval) a broadcast. The size gate is resolved from the
   * live cohort count, not the request — the client's reach estimate is never
   * trusted (§3.3). The templateKey is validated FAIL-CLOSED against the template
   * store before EITHER branch (§3.6): an unknown key would make the outbox
   * worker dead-letter every recipient, so nothing is enqueued and nothing enters
   * the maker-checker inbox for it — the request 422s instead.
   */
  async send(
    input: BroadcastSendRequest,
    adminId: string,
  ): Promise<BroadcastSendResponse> {
    if (!(await this.templates.existsByKey(input.templateKey))) {
      throw new BroadcastTemplateUnknownError(input.templateKey);
    }

    const recipientCount = await this.dispatch.countAudience(input.audience);

    if (recipientCount >= this.threshold()) {
      return this.queueForApproval(input, recipientCount, adminId);
    }
    return this.dispatchNow(input, adminId);
  }

  // ── private ────────────────────────────────────────────────────────────────────

  /** Enqueue the broadcast into the outbox now (small audience) + audit. */
  private async dispatchNow(
    input: BroadcastSendRequest,
    adminId: string,
  ): Promise<BroadcastSendResponse> {
    const broadcastId = randomUUID();
    const result = await this.dispatch.enqueueBroadcast({
      broadcastId,
      audience: input.audience,
      templateKey: input.templateKey,
      templateVars: {
        audience: input.audience,
        templateKey: input.templateKey,
        reason: input.reason,
      },
      sendAt: scheduleSendAt(input.schedule),
    });

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Broadcast:${broadcastId}`,
      action: 'admin_update',
      after: {
        audience: input.audience,
        templateKey: input.templateKey,
        schedule: input.schedule,
        reason: input.reason,
        recipientCount: result.recipientCount,
        enqueuedCount: result.enqueuedCount,
      },
    });

    return {
      outcome: 'dispatched',
      recipientCount: result.recipientCount,
      changeRequestId: null,
    };
  }

  /**
   * Capture a pending `notification_broadcast` ChangeRequest (large audience) —
   * dispatches NOTHING. The approvals engine audits the request; on approval the
   * applier re-runs the same outbox enqueue (see AdminApprovalsService).
   */
  private async queueForApproval(
    input: BroadcastSendRequest,
    recipientCount: number,
    adminId: string,
  ): Promise<BroadcastSendResponse> {
    const created = await this.approvals.create(
      {
        kind: 'notification_broadcast',
        resource: `notification.broadcast.${input.audience}`,
        payload: {
          audience: input.audience,
          templateKey: input.templateKey,
          schedule: input.schedule,
          recipientCount,
        },
        reason: input.reason,
      },
      adminId,
    );

    return {
      outcome: 'queued_for_approval',
      recipientCount,
      changeRequestId: created.id,
    };
  }

  /** The size gate, from the DB-admin layer, defaulting when unset/non-numeric. */
  private threshold(): number {
    const value = this.config.get<unknown>(MAKER_CHECKER_THRESHOLD_KEY);
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : DEFAULT_MAKER_CHECKER_THRESHOLD;
  }
}

/** The ISO send time for a schedule, or null for an immediate send. */
function scheduleSendAt(schedule: BroadcastSchedule): string | null {
  return schedule.kind === 'scheduled' ? schedule.sendAt : null;
}
