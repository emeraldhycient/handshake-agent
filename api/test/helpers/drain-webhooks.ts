/**
 * Test helper: synchronously drain the durable inbound-webhook queue.
 *
 * In e2e the BullMQ worker is not running, so a webhook POST persists a
 * WebhookEvent (status=received) but nothing processes it. This helper mirrors
 * what the WebhookProcessor would do — it loads every pending row and runs the
 * WebhookProcessingService, so settlement-path e2e can POST a webhook and then
 * assert the downstream effect. Handler failures are swallowed (as the worker's
 * lifecycle records them on the row) so a genuinely-failing settlement surfaces
 * as a missing DB effect (a clearer assertion) rather than a thrown drain.
 */
import type { INestApplication } from '@nestjs/common';

import { WebhookProcessingService } from '../../src/modules/webhooks/application/webhook-processing.service';
import {
  WEBHOOK_EVENT_REPOSITORY,
  type IWebhookEventRepository,
} from '../../src/modules/webhooks/application/ports/webhook-event.repository.port';

export async function drainWebhooks(app: INestApplication): Promise<void> {
  const processing = app.get(WebhookProcessingService);
  const repo = app.get<IWebhookEventRepository>(WEBHOOK_EVENT_REPOSITORY);

  // Process all rows still awaiting work (olderThanSec=0 → everything).
  const pending = await repo.findStuckReceived(0, 500);
  for (const row of pending) {
    try {
      await processing.process(row.id);
    } catch {
      // Mirror the worker: the failure is recorded on the row (markFailed); the
      // e2e assertion on the downstream effect is the real signal.
    }
  }
}
