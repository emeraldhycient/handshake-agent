import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { WHATSAPP_SENDER } from './application/ports/whatsapp-sender.port';
import { CloudApiSender } from './infrastructure/cloud-api.sender';

/**
 * Thin module that owns only the outbound sender.
 *
 * Imported by ConversationsModule (needs the sender to dispatch replies) and
 * optionally by WhatsAppModule (which delegates other concerns to sub-modules).
 * Extracting it here breaks the potential cycle:
 *
 *   WhatsAppModule → ConversationsModule → WhatsAppSenderModule (acyclic)
 *
 * ConfigModule is global (registered in AppModule) so CloudApiSender's
 * ConfigService injection works without an explicit import here.
 */
@Module({
  imports: [HttpModule],
  providers: [{ provide: WHATSAPP_SENDER, useClass: CloudApiSender }],
  exports: [WHATSAPP_SENDER],
})
export class WhatsAppSenderModule {}
