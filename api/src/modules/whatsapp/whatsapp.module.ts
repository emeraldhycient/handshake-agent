import { Module } from '@nestjs/common';

import { ConversationsModule } from '../conversations/conversations.module';
import { WhatsAppSignatureGuard } from './presentation/guards/whatsapp-signature.guard';
import { WhatsAppWebhookController } from './presentation/whatsapp-webhook.controller';
import { WhatsAppFlowModule } from './whatsapp-flow.module';

/**
 * Wires the WhatsApp surface.
 *
 * - `WhatsAppWebhookController` exposes GET + POST /whatsapp/webhook.
 * - `WhatsAppSignatureGuard` verifies Meta HMAC-SHA256 signatures; it reads
 *   `WHATSAPP_APP_SECRET` from the globally-provided ConfigService.
 * - INBOUND_HANDLER is provided by ConversationsModule (ConversationService).
 * - WHATSAPP_SENDER is consumed by ConversationService inside ConversationsModule
 *   (via WhatsAppSenderModule, which ConversationsModule imports directly).
 * - WhatsAppFlowModule provides FLOW_CRYPTO for the Flows data-exchange endpoint
 *   controller (6.2). Imported here and re-exported so the controller in 6.2
 *   can consume it without a separate import.
 *
 * Dependency graph (acyclic):
 *   WhatsAppModule → ConversationsModule → WhatsAppSenderModule
 *   WhatsAppModule → WhatsAppFlowModule
 */
@Module({
  imports: [
    // ConversationsModule exports INBOUND_HANDLER → ConversationService.
    // It also imports WhatsAppSenderModule, so WHATSAPP_SENDER is available
    // to ConversationService without a redundant import here.
    ConversationsModule,
    // Provides + exports FLOW_CRYPTO for the Flows data-exchange controller (6.2).
    WhatsAppFlowModule,
  ],
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppSignatureGuard],
  exports: [WhatsAppFlowModule],
})
export class WhatsAppModule {}
