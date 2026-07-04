/**
 * DI token + port for enqueuing webhook-processing jobs.
 *
 * Application code depends only on this interface — it never imports BullMQ /
 * ioredis. The infrastructure adapter (BullMqWebhookDispatchAdapter) wires the
 * real queue; unit tests swap a fake.
 */
export const WEBHOOK_DISPATCH = Symbol('WEBHOOK_DISPATCH');

export interface IWebhookDispatch {
  /**
   * Enqueue processing for a persisted WebhookEvent. The BullMQ jobId is the
   * webhookEventId so a double-enqueue (e.g. sweeper + ingest) dedups to one
   * in-flight job. Retry/backoff is configured on the queue add.
   */
  enqueue(webhookEventId: string): Promise<void>;
}
