import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../../generated/prisma/client';
import type {
  Channel,
  NotificationTemplate,
} from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  INotificationTemplateRepository,
  NotificationTemplateRecord,
  UpsertNotificationTemplateInput,
} from '../application/ports/notification-template.repository.port';

/**
 * Prisma adapter for the admin notification-template console (NTF-07). Realizes
 * the pure `INotificationTemplateRepository` port; the generated client lives
 * only here, never leaking Prisma types up to application/domain (§3.2). The
 * composite key `(templateKey, language, channel)` is unique with no nullable
 * columns, so the native compound-unique `upsert` addresses it directly.
 */
@Injectable()
export class NotificationTemplatePrismaRepository implements INotificationTemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<NotificationTemplateRecord[]> {
    const rows = await this.prisma.notificationTemplate.findMany({
      orderBy: [
        { templateKey: 'asc' },
        { language: 'asc' },
        { channel: 'asc' },
      ],
    });
    return rows.map(toRecord);
  }

  async find(
    templateKey: string,
    language: string,
    channel: string,
  ): Promise<NotificationTemplateRecord | null> {
    const row = await this.prisma.notificationTemplate.findUnique({
      where: {
        templateKey_language_channel: {
          templateKey,
          language,
          channel: channel as Channel,
        },
      },
    });
    return row ? toRecord(row) : null;
  }

  async upsert(
    input: UpsertNotificationTemplateInput,
  ): Promise<NotificationTemplateRecord> {
    // `variables` is a JSON column; serialize the unknown array through Prisma's
    // InputJsonValue. The mutable fields are written on both create and update.
    const variables = input.variables as Prisma.InputJsonValue;
    const channel = input.channel as Channel;
    const row = await this.prisma.notificationTemplate.upsert({
      where: {
        templateKey_language_channel: {
          templateKey: input.templateKey,
          language: input.language,
          channel,
        },
      },
      create: {
        templateKey: input.templateKey,
        language: input.language,
        channel,
        subject: input.subject ?? null,
        contentText: input.contentText,
        contentHtml: input.contentHtml ?? null,
        whatsappTemplateId: input.whatsappTemplateId ?? null,
        variables,
        updatedByAdminId: input.updatedByAdminId,
      },
      update: {
        subject: input.subject ?? null,
        contentText: input.contentText,
        contentHtml: input.contentHtml ?? null,
        whatsappTemplateId: input.whatsappTemplateId ?? null,
        variables,
        updatedByAdminId: input.updatedByAdminId,
      },
    });
    return toRecord(row);
  }
}

function toRecord(row: NotificationTemplate): NotificationTemplateRecord {
  return {
    id: row.id,
    templateKey: row.templateKey,
    language: row.language,
    channel: String(row.channel),
    subject: row.subject,
    contentText: row.contentText,
    contentHtml: row.contentHtml,
    whatsappTemplateId: row.whatsappTemplateId,
    variables: row.variables,
  };
}
