import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  NotificationTemplate,
  NotificationTemplateListResponse,
  NotificationTemplatePreviewRequest,
  NotificationTemplatePreviewResponse,
  NotificationTemplateUpsertRequest,
  TemplateVariable,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import {
  NOTIFICATION_TEMPLATE_REPOSITORY,
  type INotificationTemplateRepository,
  type NotificationTemplateRecord,
} from '../../notifications/application/ports/notification-template.repository.port';
import { renderTemplate } from '../../notifications/application/notification-template-renderer';
import { AdminNotFoundError } from '../domain/admin-errors';

/**
 * Phase 4 (wave 1) — the admin Comms NOTIFICATION-TEMPLATE service: list, read,
 * upsert (create-or-edit on the composite unique), and a pure render preview.
 *
 * It NEVER moves money (§3.1) and holds no Prisma import — it reaches data only
 * through the injected NOTIFICATION_TEMPLATE_REPOSITORY port (§3.2). An upsert is
 * audited as a `config_change` (subject `NotificationTemplate:<key>:<lang>:<channel>`,
 * before = the prior row / null, after = the new input). The preview is a pure
 * function of its arguments — no persistence, no model involvement.
 */
@Injectable()
export class AdminNotificationTemplateService {
  constructor(
    @Inject(NOTIFICATION_TEMPLATE_REPOSITORY)
    private readonly templates: INotificationTemplateRepository,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<NotificationTemplateListResponse> {
    const rows = await this.templates.list();
    return { items: rows.map(toTemplate) };
  }

  /** Read one template by its composite key; 404 when absent. */
  async get(
    templateKey: string,
    language: string,
    channel: string,
  ): Promise<NotificationTemplate> {
    const row = await this.templates.find(templateKey, language, channel);
    if (row === null) throw new AdminNotFoundError('NotificationTemplate');
    return toTemplate(row);
  }

  /** Create-or-edit a template and audit the change as a config_change. */
  async upsert(
    input: NotificationTemplateUpsertRequest,
    adminId: string,
  ): Promise<NotificationTemplate> {
    const before = await this.templates.find(
      input.templateKey,
      input.language,
      input.channel,
    );

    const row = await this.templates.upsert({
      ...input,
      updatedByAdminId: adminId,
    });

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `NotificationTemplate:${input.templateKey}:${input.language}:${input.channel}`,
      action: 'config_change',
      before: before !== null ? toTemplate(before) : null,
      after: input,
    });

    return toTemplate(row);
  }

  /** Pure render preview — substitutes {{name}} placeholders, no persistence. */
  preview(
    input: NotificationTemplatePreviewRequest,
  ): NotificationTemplatePreviewResponse {
    return {
      renderedText: renderTemplate(input.contentText, input.variables),
      renderedSubject:
        input.subject !== undefined
          ? renderTemplate(input.subject, input.variables)
          : null,
    };
  }
}

// ── mapper (record → contract shape) ────────────────────────────────────────────

function toTemplate(row: NotificationTemplateRecord): NotificationTemplate {
  return {
    id: row.id,
    templateKey: row.templateKey,
    language: row.language,
    channel: row.channel as NotificationTemplate['channel'],
    subject: row.subject,
    contentText: row.contentText,
    contentHtml: row.contentHtml,
    whatsappTemplateId: row.whatsappTemplateId,
    variables: toVariables(row.variables),
  };
}

/** The `variables` JSON column is `unknown`; coerce a non-array to []. */
function toVariables(value: unknown): TemplateVariable[] {
  return Array.isArray(value) ? (value as TemplateVariable[]) : [];
}
