import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { ConversationsModule } from '../conversations/conversations.module';
import { MediaModule } from '../media/media.module';
import { WhatsAppSignatureGuard } from './presentation/guards/whatsapp-signature.guard';
import { WhatsAppWebhookController } from './presentation/whatsapp-webhook.controller';
import { WhatsAppFlowModule } from './whatsapp-flow.module';
import { WhatsAppSenderModule } from './whatsapp-sender.module';
import { WhatsAppInboundService } from './application/whatsapp-inbound.service';
import { WHATSAPP_MEDIA_CLIENT } from './application/ports/whatsapp-media.port';
import { CloudApiMediaClient } from './infrastructure/cloud-api.media-client';

/**
 * Wires the WhatsApp surface.
 *
 * - `WhatsAppWebhookController` exposes GET + POST /whatsapp/webhook.
 * - `WhatsAppSignatureGuard` verifies Meta HMAC-SHA256 signatures; it reads
 *   `WHATSAPP_APP_SECRET` from the globally-provided ConfigService.
 * - INBOUND_HANDLER is provided by ConversationsModule (ConversationService).
 * - WHATSAPP_SENDER is exported by WhatsAppSenderModule; imported here so
 *   WhatsAppInboundService (which uses it for fallback replies) can resolve it.
 * - WhatsAppFlowModule provides FLOW_CRYPTO for the Flows data-exchange endpoint
 *   controller (6.2). Imported here and re-exported so the controller in 6.2
 *   can consume it without a separate import.
 * - MediaModule provides TRANSCRIPTION_PORT + DOCUMENT_EXTRACTION_PORT (exported)
 *   consumed by WhatsAppInboundService.
 * - WHATSAPP_MEDIA_CLIENT → CloudApiMediaClient (two-step Graph media download).
 *
 * Dependency graph (acyclic):
 *   WhatsAppModule → ConversationsModule → WhatsAppSenderModule
 *   WhatsAppModule → WhatsAppSenderModule (direct, for WhatsAppInboundService)
 *   WhatsAppModule → WhatsAppFlowModule
 *   WhatsAppModule → MediaModule
 */
@Module({
  imports: [
    HttpModule,
    // ConversationsModule exports INBOUND_HANDLER → ConversationService.
    ConversationsModule,
    // WhatsAppSenderModule exports WHATSAPP_SENDER for WhatsAppInboundService.
    WhatsAppSenderModule,
    // Provides + exports FLOW_CRYPTO for the Flows data-exchange controller (6.2).
    WhatsAppFlowModule,
    // Provides + exports TRANSCRIPTION_PORT + DOCUMENT_EXTRACTION_PORT.
    MediaModule,
  ],
  controllers: [WhatsAppWebhookController],
  providers: [
    WhatsAppSignatureGuard,
    { provide: WHATSAPP_MEDIA_CLIENT, useClass: CloudApiMediaClient },
    WhatsAppInboundService,
  ],
  exports: [WhatsAppFlowModule],
})
export class WhatsAppModule {}
