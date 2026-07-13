/**
 * SumsubWebhookModule — wires the Sumsub `applicantReviewed` webhook controller
 * (task 3.6) that verifies + persists the inbound review and, via the async
 * handler, grants the reviewed KYC tier.
 *
 * Dependency graph (acyclic — verified by dependency-cruiser):
 *   SumsubWebhookModule
 *     → IdentityModule   (exports KYC_REPOSITORY)
 *     → WebhooksModule   (exports WebhookIngestionService)
 *   Neither imports SumsubWebhookModule back → no cycle. Mirrors
 *   BlockradarWebhookModule (wallets) / FlutterwaveWebhookModule (treasury).
 *
 * ConfigModule is global (AppModule), so ConfigService<Env, true> resolves
 * without an explicit import. EffectiveConfigModule is also global, so the
 * handler's EffectiveConfigService dependency resolves the same way.
 */
import { Module } from '@nestjs/common';

import { IdentityModule } from './identity.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { SumsubWebhookController } from './presentation/sumsub-webhook.controller';
import { SumsubWebhookHandler } from './application/sumsub-webhook.handler';

@Module({
  imports: [IdentityModule, WebhooksModule],
  controllers: [SumsubWebhookController],
  providers: [SumsubWebhookHandler],
  exports: [SumsubWebhookHandler],
})
export class SumsubWebhookModule {}
