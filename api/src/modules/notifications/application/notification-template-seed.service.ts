import { Inject, Injectable } from '@nestjs/common';

import { DEFAULT_NOTIFICATION_TEMPLATES } from './default-notification-templates';
import {
  NOTIFICATION_TEMPLATE_REPOSITORY,
  type INotificationTemplateRepository,
  type SeedNotificationTemplateInput,
} from './ports/notification-template.repository.port';

/**
 * Seeds the platform's REAL default notification templates (NTF-07) so the admin
 * Comms console shows the canonical copy instead of an empty screen. The bodies
 * are the actual send-site messages (see `default-notification-templates.ts`),
 * not fabricated samples (root CLAUDE.md §3.6).
 *
 * `seedDefaults()` is idempotent and boot-safe: it inserts only the rows whose
 * composite key is absent (the repo skips duplicates) and never overwrites an
 * admin's later edit. It moves no money (§3.1) and holds no Prisma import — it
 * reaches data only through the injected port (§3.2). It mirrors the RBAC
 * catalog/role seed pattern invoked from `AdminModule.onModuleInit`.
 */
@Injectable()
export class NotificationTemplateSeedService {
  constructor(
    @Inject(NOTIFICATION_TEMPLATE_REPOSITORY)
    private readonly templates: INotificationTemplateRepository,
  ) {}

  /** Idempotently insert the committed platform defaults; returns rows inserted. */
  seedDefaults(): Promise<number> {
    const rows: SeedNotificationTemplateInput[] =
      DEFAULT_NOTIFICATION_TEMPLATES.map((t) => ({
        templateKey: t.templateKey,
        language: t.language,
        channel: t.channel,
        ...(t.subject !== undefined ? { subject: t.subject } : {}),
        contentText: t.contentText,
        variables: t.variables,
      }));
    return this.templates.seedDefaults(rows);
  }
}
