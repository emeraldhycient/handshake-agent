import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  ApplyUserTagsRequest,
  ApplyUserTagsResponse,
  BulkMessageRequest,
  BulkMessageResponse,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { AdminBulkConfirmationRequiredError } from '../domain/admin-errors';
import {
  USER_BULK_REPOSITORY,
  type IUserBulkRepository,
} from './ports/user-bulk.repository.port';

/**
 * The DB-admin config key for the bulk-message large-set gate (root §7). Tunable
 * from the admin console via the AppSetting layer without a deploy; falls back to
 * the default constant below when unset. A selection AT/ABOVE this many recipients
 * requires an explicit `confirmLargeSet` acknowledgement (a maker gate, §3.5).
 */
const LARGE_SET_THRESHOLD_KEY = 'notifications.bulk.largeSetThreshold';
const DEFAULT_LARGE_SET_THRESHOLD = 100;

/**
 * Phase 7 — the admin USERS-DIRECTORY BULK service. Two actions over an EXPLICIT
 * selected set of end-user ids (the Users bulk bar):
 *
 *   - applyTags:    idempotently apply an operator tag to the selection.
 *   - queueMessage: enqueue a templated broadcast onto the notifications OUTBOX.
 *
 * FUNDS-SAFETY: NEITHER moves money (§3.1). A tag is a pure annotation that confers
 * no authorization; a message references an admin-authored template (the model never
 * authors it) and enqueues onto the same at-most-once outbox the dispatch worker
 * drains — never a direct send. It holds no Prisma import — it reaches data only
 * through the injected USER_BULK_REPOSITORY port (§3.2). Both actions re-check the
 * selection SERVER-SIDE (existence-filter, §3.3), are idempotent, and are immutably
 * audited. The message path enforces the large-set gate server-side — the client's
 * `confirmLargeSet` flag alone is never trusted to bypass it.
 */
@Injectable()
export class AdminUserBulkService {
  constructor(
    @Inject(USER_BULK_REPOSITORY)
    private readonly repo: IUserBulkRepository,
    private readonly audit: AuditService,
    private readonly config: EffectiveConfigService,
  ) {}

  /**
   * Apply `tag` to every existing user in the selection. Idempotent on the
   * (userId, tag) unique — `applied` counts only NEWLY-created rows. The tag is
   * lower-cased so re-applying "VIP" then "vip" is one row. A selection with no
   * existing user is a no-op (no write, no audit).
   */
  async applyTags(
    input: ApplyUserTagsRequest,
    adminId: string,
  ): Promise<ApplyUserTagsResponse> {
    const tag = input.tag.toLowerCase();
    const userIds = await this.repo.filterExistingUserIds(input.userIds);

    if (userIds.length === 0) {
      return { tag, requested: 0, applied: 0 };
    }

    const { created } = await this.repo.applyTag(userIds, tag, adminId);

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `UserTag:${tag}`,
      action: 'admin_update',
      details: { reason: input.reason },
      after: { tag, requested: userIds.length, applied: created },
    });

    return { tag, requested: userIds.length, applied: created };
  }

  /**
   * Queue a templated broadcast to every existing user in the selection. Enqueues
   * onto the notifications outbox under a shared `broadcastRef`, idempotently per
   * recipient. Enforces the large-set gate SERVER-SIDE: a selection at/above the
   * threshold throws unless `confirmLargeSet` is explicitly true — nothing is
   * enqueued when the gate blocks. A selection with no existing user is a no-op.
   */
  async queueMessage(
    input: BulkMessageRequest,
    adminId: string,
  ): Promise<BulkMessageResponse> {
    const broadcastRef = `bulk_${randomUUID()}`;
    const userIds = await this.repo.filterExistingUserIds(input.userIds);

    if (userIds.length === 0) {
      return {
        broadcastRef,
        eventType: input.eventType,
        requested: 0,
        queued: 0,
      };
    }

    const threshold = this.largeSetThreshold();
    if (userIds.length >= threshold && !input.confirmLargeSet) {
      throw new AdminBulkConfirmationRequiredError(userIds.length, threshold);
    }

    const { enqueued } = await this.repo.enqueueMessage({
      userIds,
      eventType: input.eventType,
      templateKey: input.templateKey,
      templateVars: { ...input.variables, reason: input.reason },
      broadcastRef,
    });

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Broadcast:${broadcastRef}`,
      action: 'admin_update',
      details: { reason: input.reason },
      after: {
        eventType: input.eventType,
        templateKey: input.templateKey,
        requested: userIds.length,
        queued: enqueued,
      },
    });

    return {
      broadcastRef,
      eventType: input.eventType,
      requested: userIds.length,
      queued: enqueued,
    };
  }

  /** The large-set gate, from the DB-admin layer, defaulting when unset/non-numeric. */
  private largeSetThreshold(): number {
    const value = this.config.get<unknown>(LARGE_SET_THRESHOLD_KEY);
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : DEFAULT_LARGE_SET_THRESHOLD;
  }
}
