export const NOTIFICATION_TEMPLATE_REPOSITORY = Symbol(
  'NOTIFICATION_TEMPLATE_REPOSITORY',
);

/**
 * A persisted `NotificationTemplate` row as the application layer sees it. The
 * channel is the Prisma `Channel` enum widened to a string at this boundary;
 * `variables` is the JSON column surfaced as `unknown` (the application/presentation
 * layer parses it through the contract schema before it leaves the boundary).
 */
export interface NotificationTemplateRecord {
  id: string;
  templateKey: string;
  language: string;
  channel: string;
  subject: string | null;
  contentText: string;
  contentHtml: string | null;
  whatsappTemplateId: string | null;
  variables: unknown;
}

/** Upsert input keyed on the composite unique (templateKey, language, channel). */
export interface UpsertNotificationTemplateInput {
  templateKey: string;
  language: string;
  channel: string;
  subject?: string;
  contentText: string;
  contentHtml?: string;
  whatsappTemplateId?: string;
  variables: unknown;
  updatedByAdminId: string;
}

export interface INotificationTemplateRepository {
  list(): Promise<NotificationTemplateRecord[]>;
  find(
    templateKey: string,
    language: string,
    channel: string,
  ): Promise<NotificationTemplateRecord | null>;
  upsert(
    input: UpsertNotificationTemplateInput,
  ): Promise<NotificationTemplateRecord>;
}
