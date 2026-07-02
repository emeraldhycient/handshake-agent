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

/**
 * A platform-default seed row (NTF-07). Distinct from the admin upsert input:
 * it carries no `updatedByAdminId` (the platform authored it, so the column is
 * written null) and is inserted ONLY when the composite key is absent — an
 * admin's later edit is never overwritten.
 */
export interface SeedNotificationTemplateInput {
  templateKey: string;
  language: string;
  channel: string;
  subject?: string;
  contentText: string;
  variables: unknown;
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
  /**
   * Idempotently insert platform-default rows, skipping any whose composite key
   * (templateKey, language, channel) already exists. Returns the number of rows
   * newly inserted (0 on a re-run). Rows are platform-authored: updatedByAdminId
   * is written null, and existing (possibly admin-edited) rows are never touched.
   */
  seedDefaults(rows: SeedNotificationTemplateInput[]): Promise<number>;
}
