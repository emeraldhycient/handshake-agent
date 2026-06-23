import { Module } from '@nestjs/common';

import { ConversationsModule } from '../conversations/conversations.module';
import { WhatsAppSignatureGuard } from './presentation/guards/whatsapp-signature.guard';
import { WhatsAppWebhookController } from './presentation/whatsapp-webhook.controller';

/**
 * Wires the WhatsApp surface.
 *
 * - `WhatsAppWebhookController` exposes GET + POST /whatsapp/webhook.
 * - `WhatsAppSignatureGuard` verifies Meta HMAC-SHA256 signatures; it reads
 *   `WHATSAPP_APP_SECRET` from the globally-provided ConfigService.
 * - INBOUND_HANDLER is provided by ConversationsModule (ConversationService).
 * - WHATSAPP_SENDER is consumed by ConversationService inside ConversationsModule
 *   (via WhatsAppSenderModule, which ConversationsModule imports directly).
 *
 * Dependency graph (acyclic):
 *   WhatsAppModule → ConversationsModule → WhatsAppSenderModule
 */
@Module({
  imports: [
    // ConversationsModule exports INBOUND_HANDLER → ConversationService.
    // It also imports WhatsAppSenderModule, so WHATSAPP_SENDER is available
    // to ConversationService without a redundant import here.
    ConversationsModule,
  ],
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppSignatureGuard],
})
export class WhatsAppModule {}
