// Tests for the WhatsApp inbound webhook payload contract.
// The schema lives in @handshake-agent/contracts; this spec runs under the api
// Jest config which resolves that package via moduleNameMapper.

import {
  WhatsAppInboundSchema,
  extractTextMessages,
} from '@handshake-agent/contracts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEXT_MESSAGE_PAYLOAD = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '321931754638022',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '+234700000000',
              phone_number_id: '1248377751698132',
            },
            contacts: [
              {
                profile: { name: 'Test User' },
                wa_id: '2347088639675',
              },
            ],
            messages: [
              {
                from: '2347088639675',
                id: 'wamid.HBgL2347088639675VBIhAkZZA==',
                timestamp: '1720000000',
                type: 'text',
                text: { body: 'buy 5000 naira of usdt' },
              },
            ],
          },
        },
      ],
    },
  ],
};

const STATUS_ONLY_PAYLOAD = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '321931754638022',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '+234700000000',
              phone_number_id: '1248377751698132',
            },
            statuses: [
              {
                id: 'wamid.HBgL2347088639675VBIhAkZZA==',
                status: 'delivered',
                timestamp: '1720000001',
                recipient_id: '2347088639675',
              },
            ],
          },
        },
      ],
    },
  ],
};

const IMAGE_MESSAGE_PAYLOAD = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '321931754638022',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '+234700000000',
              phone_number_id: '1248377751698132',
            },
            contacts: [
              {
                profile: { name: 'Test User' },
                wa_id: '2347088639675',
              },
            ],
            messages: [
              {
                from: '2347088639675',
                id: 'wamid.HBgL2347088639675VBIhAkZZA==',
                timestamp: '1720000000',
                type: 'image',
                // no `text` field
              },
            ],
          },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Test A: text-message payload parses and extractTextMessages returns one item
// ---------------------------------------------------------------------------

describe('WhatsAppInboundSchema — text message payload (Test A)', () => {
  it('parses without throwing', () => {
    expect(() =>
      WhatsAppInboundSchema.parse(TEXT_MESSAGE_PAYLOAD),
    ).not.toThrow();
  });

  it('extractTextMessages returns one item with correct fields', () => {
    const parsed = WhatsAppInboundSchema.parse(TEXT_MESSAGE_PAYLOAD);
    const messages = extractTextMessages(parsed);

    expect(messages).toHaveLength(1);

    const [msg] = messages;
    expect(msg.externalMessageId).toBe('wamid.HBgL2347088639675VBIhAkZZA==');
    expect(msg.from).toBe('2347088639675');
    expect(msg.phoneNumberId).toBe('1248377751698132');
    expect(msg.waName).toBe('Test User');
    expect(msg.text).toBe('buy 5000 naira of usdt');
    expect(msg.timestamp).toBe('1720000000');
  });
});

// ---------------------------------------------------------------------------
// Test B: status-only payload parses and extractTextMessages returns []
// ---------------------------------------------------------------------------

describe('WhatsAppInboundSchema — status-only payload (Test B)', () => {
  it('parses without throwing', () => {
    expect(() =>
      WhatsAppInboundSchema.parse(STATUS_ONLY_PAYLOAD),
    ).not.toThrow();
  });

  it('extractTextMessages returns empty array', () => {
    const parsed = WhatsAppInboundSchema.parse(STATUS_ONLY_PAYLOAD);
    expect(extractTextMessages(parsed)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test C: image-type message parses and is skipped by extractTextMessages
// ---------------------------------------------------------------------------

describe('WhatsAppInboundSchema — image message payload (Test C)', () => {
  it('parses without throwing', () => {
    expect(() =>
      WhatsAppInboundSchema.parse(IMAGE_MESSAGE_PAYLOAD),
    ).not.toThrow();
  });

  it('extractTextMessages skips non-text messages and returns empty array', () => {
    const parsed = WhatsAppInboundSchema.parse(IMAGE_MESSAGE_PAYLOAD);
    expect(extractTextMessages(parsed)).toHaveLength(0);
  });
});
