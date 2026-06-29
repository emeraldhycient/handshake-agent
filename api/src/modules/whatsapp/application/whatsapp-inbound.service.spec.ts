import type {
  IInboundHandler,
  InboundMessage,
} from './ports/inbound-handler.port';
import type { IWhatsAppMediaClient } from './ports/whatsapp-media.port';
import type { IWhatsAppSender } from './ports/whatsapp-sender.port';
import type { ITranscriptionPort } from '../../media/application/ports/transcription.port';
import type { IDocumentExtractionPort } from '../../media/application/ports/document-extraction.port';
import { WhatsAppInboundService } from './whatsapp-inbound.service';

const handler: jest.Mocked<IInboundHandler> = {
  handleInbound: jest
    .fn<Promise<void>, [InboundMessage]>()
    .mockResolvedValue(undefined),
};
const media: jest.Mocked<IWhatsAppMediaClient> = {
  download: jest
    .fn()
    .mockResolvedValue({ bytes: Buffer.from('a'), mimeType: 'audio/ogg' }),
};
const transcription: jest.Mocked<ITranscriptionPort> = {
  transcribe: jest.fn().mockResolvedValue({ text: 'buy usdt' }),
};
const extraction: jest.Mocked<IDocumentExtractionPort> = {
  extract: jest.fn().mockResolvedValue({ kind: 'none' }),
};
const sender = {
  sendText: jest
    .fn<Promise<{ externalMessageId: string }>, [string, string]>()
    .mockResolvedValue({
      externalMessageId: 'x',
    }),
} as unknown as jest.Mocked<IWhatsAppSender>;

function makeSvc(): WhatsAppInboundService {
  return new WhatsAppInboundService(
    handler,
    media,
    transcription,
    extraction,
    sender,
  );
}

const payload = (msgs: Record<string, unknown>[]) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'E',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '1', phone_number_id: 'P' },
            contacts: [{ profile: { name: 'Ada' }, wa_id: '234' }],
            messages: msgs.map((m, i) => ({
              from: '234',
              id: `wamid.${i}`,
              timestamp: '1',
              ...m,
            })),
          },
        },
      ],
    },
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  handler.handleInbound.mockResolvedValue(undefined);
  media.download.mockResolvedValue({
    bytes: Buffer.from('a'),
    mimeType: 'audio/ogg',
  });
  transcription.transcribe.mockResolvedValue({ text: 'buy usdt' });
  extraction.extract.mockResolvedValue({ kind: 'none' });
  sender.sendText.mockResolvedValue({ externalMessageId: 'x' });
});

it('routes text directly and audio via transcription', async () => {
  const svc = makeSvc();
  await svc.ingest(
    payload([
      { type: 'text', text: { body: 'hi' } },
      {
        type: 'audio',
        audio: { id: 'MID', mime_type: 'audio/ogg', voice: true },
      },
    ]) as never,
  );

  expect(handler.handleInbound).toHaveBeenCalledTimes(2);
  const calls = handler.handleInbound.mock.calls as Array<
    [{ inputModality?: string; text: string }]
  >;
  const audioCall = calls.find((c) => c[0].inputModality === 'voice');
  expect(audioCall?.[0].text).toBe('buy usdt');
  expect(media.download).toHaveBeenCalledWith('MID');
});

it('continues the batch and sends a fallback when transcription fails', async () => {
  transcription.transcribe.mockRejectedValueOnce(new Error('stt down'));
  const svc = makeSvc();
  await svc.ingest(
    payload([
      { type: 'audio', audio: { id: 'M', mime_type: 'audio/ogg' } },
    ]) as never,
  );
  expect(sender.sendText).toHaveBeenCalled(); // safe fallback
});

it('routes image via extraction and calls handleInbound with extraction set', async () => {
  const extractionResult = { kind: 'none' as const };
  extraction.extract.mockResolvedValue(extractionResult);
  media.download.mockResolvedValueOnce({
    bytes: Buffer.from('img'),
    mimeType: 'image/jpeg',
  });

  const svc = makeSvc();
  await svc.ingest(
    payload([
      { type: 'image', image: { id: 'IMG1', mime_type: 'image/jpeg' } },
    ]) as never,
  );

  expect(extraction.extract).toHaveBeenCalledWith({
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    bytes: expect.any(Buffer),
    mimeType: 'image/jpeg',
  });
  expect(handler.handleInbound).toHaveBeenCalledTimes(1);
  expect(handler.handleInbound).toHaveBeenCalledWith(
    expect.objectContaining({
      text: '[image]',
      extraction: extractionResult,
    }),
  );
});
