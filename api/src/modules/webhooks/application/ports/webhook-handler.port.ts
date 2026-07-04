/**
 * WebhookHandler port + registry token.
 *
 * A handler runs the *existing* idempotent settlement/ingest logic for one
 * provider (§3.1 — the handler calls the engine; it never moves money itself).
 * The concrete handlers live in the provider modules (wallets/treasury/whatsapp)
 * where their settlement dependencies already are; they are aggregated into the
 * registry at the worker composition root (WebhookWorkerModule) so WebhooksModule
 * stays free of provider imports (acyclic).
 */
import type { WebhookEventRecord } from './webhook-event.repository.port';

export interface WebhookHandler {
  /** "blockradar" | "flutterwave" | "whatsapp". */
  readonly provider: string;
  /**
   * Process a verified, persisted webhook. THROW to signal a retryable failure
   * (BullMQ retries with backoff; exhaustion → dead-letter). Return normally for
   * a genuine no-op ack (unhandled event, duplicate at the settlement layer,
   * unsupported asset).
   */
  handle(event: WebhookEventRecord): Promise<void>;
}

/** Injected map keyed by `handler.provider`. Built in WebhookWorkerModule. */
export const WEBHOOK_HANDLER_REGISTRY = Symbol('WEBHOOK_HANDLER_REGISTRY');
export type WebhookHandlerRegistry = Map<string, WebhookHandler>;
