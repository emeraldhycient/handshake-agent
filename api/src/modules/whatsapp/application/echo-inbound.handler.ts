// TODO(phase-2): replaced by ConversationService as the INBOUND_HANDLER binding.

import { Injectable, Inject } from '@nestjs/common';

import type {
  IInboundHandler,
  InboundMessage,
} from './ports/inbound-handler.port';
import {
  WHATSAPP_SENDER,
  type IWhatsAppSender,
} from './ports/whatsapp-sender.port';

/**
 * Phase-1 echo handler — satisfies the `IInboundHandler` port so the webhook
 * surface is fully wired end-to-end. Every inbound text message is echoed back
 * to the sender. Phase 2 replaces this binding with ConversationService.
 */
@Injectable()
export class EchoInboundHandler implements IInboundHandler {
  constructor(
    @Inject(WHATSAPP_SENDER) private readonly sender: IWhatsAppSender,
  ) {}

  async handleInbound(msg: InboundMessage): Promise<void> {
    await this.sender.sendText(msg.fromAddress, `You said: ${msg.text}`);
  }
}
