import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  extractInboundEvents,
  type InboundEvent,
} from '@handshake-agent/contracts';
import type { WhatsAppInbound } from '@handshake-agent/contracts';

import {
  INBOUND_HANDLER,
  type IInboundHandler,
  type InboundMessage,
} from './ports/inbound-handler.port';
import {
  WHATSAPP_MEDIA_CLIENT,
  type IWhatsAppMediaClient,
} from './ports/whatsapp-media.port';
import {
  WHATSAPP_SENDER,
  type IWhatsAppSender,
} from './ports/whatsapp-sender.port';
import {
  TRANSCRIPTION_PORT,
  type ITranscriptionPort,
} from '../../media/application/ports/transcription.port';
import {
  DOCUMENT_EXTRACTION_PORT,
  type IDocumentExtractionPort,
} from '../../media/application/ports/document-extraction.port';

const SAFE_FALLBACK = 'Sorry, I had trouble reading that — please try again.';

@Injectable()
export class WhatsAppInboundService {
  private readonly logger = new Logger(WhatsAppInboundService.name);

  constructor(
    @Inject(INBOUND_HANDLER) private readonly handler: IInboundHandler,
    @Inject(WHATSAPP_MEDIA_CLIENT) private readonly media: IWhatsAppMediaClient,
    @Inject(TRANSCRIPTION_PORT)
    private readonly transcription: ITranscriptionPort,
    @Inject(DOCUMENT_EXTRACTION_PORT)
    private readonly extractionPort: IDocumentExtractionPort,
    @Inject(WHATSAPP_SENDER) private readonly sender: IWhatsAppSender,
  ) {}

  async ingest(payload: WhatsAppInbound): Promise<void> {
    for (const event of extractInboundEvents(payload)) {
      try {
        const msg = await this.toInboundMessage(event);
        if (msg) await this.handler.handleInbound(msg);
      } catch (err) {
        this.logger.error(
          {
            err: err instanceof Error ? err.message : String(err),
            externalMessageId: event.externalMessageId,
            kind: event.kind,
          },
          'inbound media ingest failed — sending safe fallback',
        );
        await this.sender
          .sendText(event.from, SAFE_FALLBACK)
          .catch(() => undefined);
      }
    }
  }

  private base(event: InboundEvent): Omit<InboundMessage, 'text'> {
    return {
      externalMessageId: event.externalMessageId,
      fromAddress: event.from,
      phoneNumberId: event.phoneNumberId,
      waName: event.waName,
      timestamp: event.timestamp,
      channel: 'whatsapp',
    };
  }

  private async toInboundMessage(
    event: InboundEvent,
  ): Promise<InboundMessage | null> {
    if (event.kind === 'text') {
      return { ...this.base(event), text: event.text };
    }
    if (event.kind === 'audio') {
      const { bytes, mimeType } = await this.media.download(event.mediaId);
      const { text } = await this.transcription.transcribe({ bytes, mimeType });
      return { ...this.base(event), text, inputModality: 'voice' };
    }
    // image | document → extract a candidate (routing lives in ConversationService, Task 18)
    const { bytes, mimeType } = await this.media.download(event.mediaId);
    const extraction = await this.extractionPort.extract({ bytes, mimeType });
    return { ...this.base(event), text: `[${event.kind}]`, extraction };
  }
}
