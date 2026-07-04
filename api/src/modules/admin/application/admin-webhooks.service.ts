/**
 * AdminWebhooksService — the read + replay surface for the durable-webhook
 * console (Track A).
 *
 * list / detail are read-only projections of the WebhookEvent table. retry
 * RE-ENQUEUES a webhook for the worker (resetToReceived → dispatch.enqueue) and
 * writes an audited admin action. It moves NO money and never settles inline —
 * settlement stays engine-brokered in the worker handler (§3.1).
 */
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type {
  WebhookDetail,
  WebhookListItem,
  WebhookListQuery,
  WebhookListResponse,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import {
  WEBHOOK_EVENT_REPOSITORY,
  type IWebhookEventRepository,
  type WebhookEventRecord,
} from '../../webhooks/application/ports/webhook-event.repository.port';
import {
  WEBHOOK_DISPATCH,
  type IWebhookDispatch,
} from '../../webhooks/application/ports/webhook-dispatch.port';
import { AdminNotFoundError } from '../domain/admin-errors';

@Injectable()
export class AdminWebhooksService {
  constructor(
    @Inject(WEBHOOK_EVENT_REPOSITORY)
    private readonly repo: IWebhookEventRepository,
    @Inject(WEBHOOK_DISPATCH)
    private readonly dispatch: IWebhookDispatch,
    private readonly audit: AuditService,
  ) {}

  async list(query: WebhookListQuery): Promise<WebhookListResponse> {
    const page = await this.repo.list({
      provider: query.provider,
      status: query.status,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      cursor: query.cursor,
      limit: query.limit,
    });
    return {
      items: page.items.map((r) => toListItem(r)),
      nextCursor: page.nextCursor,
    };
  }

  async detail(id: string): Promise<WebhookDetail> {
    const record = await this.repo.findById(id);
    if (record === null) throw new AdminNotFoundError('Webhook event');
    return toDetail(record);
  }

  /**
   * Re-enqueue a webhook for processing. Re-arm (status→received) then dispatch;
   * BullMQ's jobId=webhookEventId dedups against any live job. Audited as an
   * operator override. NEVER settles inline (§3.1).
   */
  async retry(
    id: string,
    adminId: string,
    reason: string,
  ): Promise<WebhookDetail> {
    const before = await this.repo.findById(id);
    if (before === null) throw new AdminNotFoundError('Webhook event');

    await this.repo.resetToReceived(id);
    await this.dispatch.enqueue(id);

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `WebhookEvent:${id}`,
      action: 'admin_override',
      details: {
        reason,
        provider: before.provider,
        providerEventId: before.providerEventId,
      },
      before: { status: before.status, attempts: before.attempts },
      after: { status: 'received' },
    });

    const after = await this.repo.findById(id);
    if (after === null) throw new AdminNotFoundError('Webhook event');
    return toDetail(after);
  }
}

// ---------------------------------------------------------------------------
// Record → contract projections (Date → ISO string).
// ---------------------------------------------------------------------------

function toListItem(r: WebhookEventRecord): WebhookListItem {
  return {
    id: r.id,
    provider: r.provider as WebhookListItem['provider'],
    providerEventId: r.providerEventId,
    status: r.status as WebhookListItem['status'],
    attempts: r.attempts,
    lastError: r.lastError,
    receivedAt: r.receivedAt.toISOString(),
    processedAt: r.processedAt ? r.processedAt.toISOString() : null,
  };
}

function toDetail(r: WebhookEventRecord): WebhookDetail {
  return {
    ...toListItem(r),
    payload: r.payload,
    headers: r.headers,
    signature: r.signature,
    lastAttemptAt: r.lastAttemptAt ? r.lastAttemptAt.toISOString() : null,
    deadAt: r.deadAt ? r.deadAt.toISOString() : null,
  };
}
