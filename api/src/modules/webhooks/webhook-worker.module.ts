/**
 * WebhookWorkerModule — the CONSUMER side of the durable inbound-webhook queue.
 *
 * Loaded ONLY by worker.ts (via worker.module.ts). It declares the
 * WebhookProcessor (@Processor) — which opens a real ioredis Worker connection —
 * so it must NEVER be imported by AppModule or anything reachable from it
 * (dependency-cruiser guards the direction). It reuses WebhookProcessingModule
 * for the lifecycle service + handler registry.
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { WebhookProcessingModule } from './webhook-processing.module';
import { WebhookProcessor } from './infrastructure/webhook.processor';
import { WEBHOOK_QUEUE_NAME } from './infrastructure/webhook-queue.constants';

@Module({
  imports: [
    WebhookProcessingModule,
    BullModule.registerQueue({ name: WEBHOOK_QUEUE_NAME }),
  ],
  providers: [WebhookProcessor],
})
export class WebhookWorkerModule {}
