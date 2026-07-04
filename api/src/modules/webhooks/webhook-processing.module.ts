/**
 * WebhookProcessingModule — aggregates the per-provider handlers into the
 * registry and provides the lifecycle orchestrator (WebhookProcessingService).
 *
 * Loaded by AppModule (NOT worker-only): it declares NO @Processor, so it opens
 * no Redis connection. Keeping it in the API graph lets e2e tests drive
 * processing synchronously (app.get(WebhookProcessingService).process(id)) after
 * POSTing a webhook — preserving the settlement-path e2e coverage even though
 * production processing happens in the worker via WebhookProcessor.
 *
 * Acyclic: it imports the three provider webhook modules (which export their
 * handlers) + WebhooksModule (for WEBHOOK_EVENT_REPOSITORY). None of those import
 * this module back.
 */
import { Module } from '@nestjs/common';

import { WebhooksModule } from './webhooks.module';
import { BlockradarWebhookModule } from '../wallets/blockradar-webhook.module';
import { FlutterwaveWebhookModule } from '../treasury/flutterwave-webhook.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { BlockradarWebhookHandler } from '../wallets/application/blockradar-webhook.handler';
import { FlutterwaveWebhookHandler } from '../treasury/application/flutterwave-webhook.handler';
import { WhatsAppWebhookHandler } from '../whatsapp/application/whatsapp-webhook.handler';
import {
  WEBHOOK_HANDLER_REGISTRY,
  type WebhookHandler,
  type WebhookHandlerRegistry,
} from './application/ports/webhook-handler.port';
import { WebhookProcessingService } from './application/webhook-processing.service';

@Module({
  imports: [
    WebhooksModule,
    BlockradarWebhookModule,
    FlutterwaveWebhookModule,
    WhatsAppModule,
  ],
  providers: [
    {
      provide: WEBHOOK_HANDLER_REGISTRY,
      useFactory: (
        blockradar: BlockradarWebhookHandler,
        flutterwave: FlutterwaveWebhookHandler,
        whatsapp: WhatsAppWebhookHandler,
      ): WebhookHandlerRegistry =>
        new Map<string, WebhookHandler>([
          [blockradar.provider, blockradar],
          [flutterwave.provider, flutterwave],
          [whatsapp.provider, whatsapp],
        ]),
      inject: [
        BlockradarWebhookHandler,
        FlutterwaveWebhookHandler,
        WhatsAppWebhookHandler,
      ],
    },
    WebhookProcessingService,
  ],
  exports: [WebhookProcessingService, WEBHOOK_HANDLER_REGISTRY],
})
export class WebhookProcessingModule {}
