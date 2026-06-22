import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { INBOUND_HANDLER } from './application/ports/inbound-handler.port';
import { WHATSAPP_SENDER } from './application/ports/whatsapp-sender.port';
import { EchoInboundHandler } from './application/echo-inbound.handler';
import { CloudApiSender } from './infrastructure/cloud-api.sender';
import { WhatsAppSignatureGuard } from './presentation/guards/whatsapp-signature.guard';
import { WhatsAppWebhookController } from './presentation/whatsapp-webhook.controller';

/**
 * Wires the WhatsApp surface for Phase 1.
 *
 * - `WhatsAppWebhookController` exposes GET + POST /whatsapp/webhook.
 * - `WhatsAppSignatureGuard` verifies Meta HMAC-SHA256 signatures; it reads
 *   `WHATSAPP_APP_SECRET` from the globally-provided ConfigService.
 * - `CloudApiSender` implements `IWhatsAppSender`; it requires `HttpModule`
 *   (for `HttpService`) and `ConfigService` (global).
 * - `EchoInboundHandler` implements `IInboundHandler` for Phase 1.
 *   See TODO(phase-2) in echo-inbound.handler.ts for the replacement binding.
 */
@Module({
  imports: [
    // HttpService is used by CloudApiSender for outbound Cloud API calls.
    HttpModule,
  ],
  controllers: [WhatsAppWebhookController],
  providers: [
    WhatsAppSignatureGuard,
    { provide: WHATSAPP_SENDER, useClass: CloudApiSender },
    { provide: INBOUND_HANDLER, useClass: EchoInboundHandler },
  ],
})
export class WhatsAppModule {}
