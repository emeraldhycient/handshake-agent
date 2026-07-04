import { Logger } from '@nestjs/common';

import type { WhatsAppInboundService } from './whatsapp-inbound.service';
import type { WebhookEventRecord } from '../../webhooks/application/ports/webhook-event.repository.port';
import { WhatsAppWebhookHandler } from './whatsapp-webhook.handler';

function validInbound(): unknown {
  return {
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
              messages: [
                {
                  from: '234',
                  id: 'wamid.0',
                  timestamp: '1',
                  type: 'text',
                  text: { body: 'hi' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function makeEvent(payload: unknown): WebhookEventRecord {
  return {
    id: 'wh-wa-1',
    provider: 'whatsapp',
    providerEventId: 'wamid.0',
    payload,
    headers: {},
    signature: null,
    status: 'processing',
    attempts: 1,
    lastError: null,
    receivedAt: new Date(),
    lastAttemptAt: new Date(),
    processedAt: null,
    deadAt: null,
  };
}

describe('WhatsAppWebhookHandler', () => {
  let inbound: jest.Mocked<Pick<WhatsAppInboundService, 'ingest'>>;
  let handler: WhatsAppWebhookHandler;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    inbound = { ingest: jest.fn().mockResolvedValue(undefined) };
    handler = new WhatsAppWebhookHandler(
      inbound as unknown as WhatsAppInboundService,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('provider is "whatsapp"', () => {
    expect(handler.provider).toBe('whatsapp');
  });

  it('parses a valid inbound payload and delegates to ingest', async () => {
    await handler.handle(makeEvent(validInbound()));
    expect(inbound.ingest).toHaveBeenCalledTimes(1);
  });

  it('acks (no throw) on a schema-invalid payload without calling ingest', async () => {
    await expect(
      handler.handle(makeEvent({ not: 'a whatsapp payload' })),
    ).resolves.toBeUndefined();
    expect(inbound.ingest).not.toHaveBeenCalled();
  });

  it('re-throws when ingest fails (BullMQ retries + dead-letters)', async () => {
    inbound.ingest.mockRejectedValue(new Error('agent timeout'));
    await expect(handler.handle(makeEvent(validInbound()))).rejects.toThrow(
      'agent timeout',
    );
  });
});
