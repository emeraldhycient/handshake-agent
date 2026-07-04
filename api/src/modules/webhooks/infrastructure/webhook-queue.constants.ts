/**
 * BullMQ queue + job names for the durable inbound-webhook queue.
 *
 * Registered on the producer side in WebhooksModule and on the consumer side in
 * WebhookWorkerModule (the @Processor). BullMQ dispatches by job name.
 */
export const WEBHOOK_QUEUE_NAME = 'webhook-processing';
export const WEBHOOK_PROCESS_JOB = 'process-webhook';

/** Job payload for a `process-webhook` job. */
export interface ProcessWebhookPayload {
  webhookEventId: string;
}
