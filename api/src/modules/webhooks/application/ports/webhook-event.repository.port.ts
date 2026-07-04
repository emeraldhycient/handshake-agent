/**
 * DI token and port contract for the WebhookEvent repository.
 *
 * Infrastructure provides the concrete Prisma adapter. Application depends only
 * on this interface (clean-arch §4.1, CLAUDE.md §3.2 — no `@prisma/client` here).
 */

export const WEBHOOK_EVENT_REPOSITORY = Symbol('WEBHOOK_EVENT_REPOSITORY');

export interface CreateWebhookEventData {
  provider: string;
  providerEventId: string;
  /** Verbatim body (parsed JSON object, or `{ raw: string }` for non-JSON). */
  payload: unknown;
  headers: Record<string, unknown>;
  signature?: string | null;
}

export interface WebhookEventRecord {
  id: string;
  provider: string;
  providerEventId: string;
  payload: unknown;
  headers: Record<string, unknown>;
  signature: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  receivedAt: Date;
  lastAttemptAt: Date | null;
  processedAt: Date | null;
  deadAt: Date | null;
}

export interface WebhookListFilter {
  provider?: string;
  status?: string;
  from?: Date;
  to?: Date;
  /** Opaque keyset cursor from a prior page's `nextCursor`. */
  cursor?: string;
  limit: number;
}

export interface WebhookListPage {
  items: WebhookEventRecord[];
  nextCursor: string | null;
}

export interface IWebhookEventRepository {
  /**
   * Inserts a new row. On a `(provider, providerEventId)` unique conflict the
   * existing row is returned with `duplicate: true` (never throws on dup) — this
   * is the ingestion-layer dedup guard (§3.1: never re-process/double-credit).
   */
  createIfNew(
    data: CreateWebhookEventData,
  ): Promise<{ record: WebhookEventRecord; duplicate: boolean }>;

  findById(id: string): Promise<WebhookEventRecord | null>;

  /** Keyset-paginated list (receivedAt desc, id desc), with optional filters. */
  list(filter: WebhookListFilter): Promise<WebhookListPage>;

  /** status→processing, attempts++, lastAttemptAt=now (claim before running). */
  markProcessing(id: string): Promise<void>;

  /** status→succeeded, processedAt=now, lastError=null (terminal). */
  markSucceeded(id: string): Promise<void>;

  /** status→failed, lastError (non-terminal — BullMQ will retry). */
  markFailed(id: string, error: string): Promise<void>;

  /** status→dead, deadAt=now, lastError (terminal dead-letter). */
  markDead(id: string, error: string): Promise<void>;

  /**
   * Admin/sweeper re-arm: status→received, clears deadAt/processedAt so the
   * worker re-drives it. Keeps attempts + lastError for history (audit trail).
   */
  resetToReceived(id: string): Promise<void>;

  /** Rows stuck in `received` older than the grace window (sweeper fallback). */
  findStuckReceived(
    olderThanSec: number,
    limit: number,
  ): Promise<WebhookEventRecord[]>;

  /** Count of rows per status — powers the metrics reads (requirement 5). */
  countByStatus(): Promise<Record<string, number>>;
}
