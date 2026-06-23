import { Module } from '@nestjs/common';

import { ConversationsModule } from '../conversations/conversations.module';
import { WhatsAppSenderModule } from './whatsapp-sender.module';
import { WhatsAppSignatureGuard } from './presentation/guards/whatsapp-signature.guard';
import { WhatsAppWebhookController } from './presentation/whatsapp-webhook.controller';

/**
 * Wires the WhatsApp surface.
 *
 * - `WhatsAppWebhookController` exposes GET + POST /whatsapp/webhook.
 * - `WhatsAppSignatureGuard` verifies Meta HMAC-SHA256 signatures; it reads
 *   `WHATSAPP_APP_SECRET` from the globally-provided ConfigService.
 * - INBOUND_HANDLER is provided by ConversationsModule (ConversationService).
 * - WHATSAPP_SENDER is provided by WhatsAppSenderModule (CloudApiSender).
 *
 * Dependency graph (acyclic):
 *   WhatsAppModule → ConversationsModule → WhatsAppSenderModule
 */
@Module({
  imports: [
    // ConversationsModule exports INBOUND_HANDLER → ConversationService.
    ConversationsModule,
    // WhatsAppSenderModule exports WHATSAPP_SENDER for any direct use in this module.
    WhatsAppSenderModule,
  ],
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppSignatureGuard],
})
export class WhatsAppModule {}
