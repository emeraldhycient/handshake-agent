/**
 * FlutterwaveWebhookModule — wires the Flutterwave collection webhook controller
 * that closes the buy loop (Task 6.4).
 *
 * Dependency graph (acyclic — verified by dependency-cruiser):
 *   FlutterwaveWebhookModule
 *     → TreasuryModule         (exports PAYMENT_PROVIDER)
 *     → TransactionsModule     (exports ExecutionService)
 *     → WhatsAppSenderModule   (exports WHATSAPP_SENDER)
 *     → IdentityModule         (exports IdentityService)
 *   None of those modules import FlutterwaveWebhookModule → no cycle.
 *
 * ConfigModule and PrismaModule are global (registered in AppModule) so they
 * are available here without explicit imports.
 */

import { Module } from '@nestjs/common';

import { TreasuryModule } from './treasury.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { WhatsAppSenderModule } from '../whatsapp/whatsapp-sender.module';
import { IdentityModule } from '../identity/identity.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { FlutterwaveWebhookController } from './presentation/flutterwave-webhook.controller';
import { FlutterwaveWebhookHandler } from './application/flutterwave-webhook.handler';

@Module({
  imports: [
    TreasuryModule,
    TransactionsModule,
    WhatsAppSenderModule,
    IdentityModule,
    // WebhooksModule: the thin controller persists+enqueues via WebhookIngestionService.
    WebhooksModule,
  ],
  controllers: [FlutterwaveWebhookController],
  providers: [FlutterwaveWebhookHandler],
  exports: [FlutterwaveWebhookHandler],
})
export class FlutterwaveWebhookModule {}
