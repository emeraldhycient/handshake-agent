/**
 * WebhooksModule — the PRODUCER side of the durable inbound-webhook queue.
 *
 * Imported by AppModule (and by the provider webhook modules, for the thin
 * controllers' WebhookIngestionService). It registers the webhook-processing
 * queue for the dispatch adapter and provides persistence + ingestion + metrics
 * + the sweeper. It declares NO @Processor — the consumer (WebhookProcessor)
 * lives in the worker graph only (WebhookWorkerModule → worker.ts), so the API
 * process never opens a BullMQ Worker connection (e2e-without-Redis stays green).
 *
 * PrismaService, EffectiveConfigService, and AssetRegistry are global — no
 * explicit imports needed. BullModule.forRoot() is set up by JobsModule at
 * AppModule level; registerQueue here just materialises the Queue instance the
 * dispatch adapter injects.
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { WEBHOOK_EVENT_REPOSITORY } from './application/ports/webhook-event.repository.port';
import { WEBHOOK_DISPATCH } from './application/ports/webhook-dispatch.port';
import { WebhookEventPrismaRepository } from './infrastructure/webhook-event.prisma.repository';
import { BullMqWebhookDispatchAdapter } from './infrastructure/bullmq-webhook-dispatch.adapter';
import { WebhookIngestionService } from './application/webhook-ingestion.service';
import { WebhookMetricsService } from './application/webhook-metrics.service';
import { WebhookSweeperService } from './webhook-sweeper.service';
import { WEBHOOK_QUEUE_NAME } from './infrastructure/webhook-queue.constants';

@Module({
  imports: [BullModule.registerQueue({ name: WEBHOOK_QUEUE_NAME })],
  providers: [
    {
      provide: WEBHOOK_EVENT_REPOSITORY,
      useClass: WebhookEventPrismaRepository,
    },
    { provide: WEBHOOK_DISPATCH, useClass: BullMqWebhookDispatchAdapter },
    WebhookIngestionService,
    WebhookMetricsService,
    WebhookSweeperService,
  ],
  exports: [
    WebhookIngestionService,
    WebhookMetricsService,
    WEBHOOK_EVENT_REPOSITORY,
    WEBHOOK_DISPATCH,
  ],
})
export class WebhooksModule {}
