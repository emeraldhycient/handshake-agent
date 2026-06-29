import {
  WhatsAppInboundSchema,
  extractInboundEvents,
  extractTextMessages,
} from './inbound'

const envelope = (message: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'E1',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '15550',
              phone_number_id: 'PNID1',
            },
            contacts: [{ profile: { name: 'Ada' }, wa_id: '23480' }],
            messages: [
              { from: '23480', id: 'wamid.X', timestamp: '1700', ...message },
            ],
          },
        },
      ],
    },
  ],
})

describe('extractInboundEvents', () => {
  it('maps a text message to a text event', () => {
    const p = WhatsAppInboundSchema.parse(
      envelope({ type: 'text', text: { body: 'hi' } }),
    )
    expect(extractInboundEvents(p)).toEqual([
      expect.objectContaining({
        kind: 'text',
        text: 'hi',
        from: '23480',
        externalMessageId: 'wamid.X',
        waName: 'Ada',
      }),
    ])
  })

  it('maps an audio/voice message to an audio event', () => {
    const p = WhatsAppInboundSchema.parse(
      envelope({
        type: 'audio',
        audio: { id: 'MID1', mime_type: 'audio/ogg', voice: true },
      }),
    )
    expect(extractInboundEvents(p)).toEqual([
      expect.objectContaining({
        kind: 'audio',
        mediaId: 'MID1',
        mimeType: 'audio/ogg',
        voice: true,
      }),
    ])
  })

  it('maps image and document messages', () => {
    const img = WhatsAppInboundSchema.parse(
      envelope({
        type: 'image',
        image: { id: 'IMG1', mime_type: 'image/jpeg' },
      }),
    )
    expect(extractInboundEvents(img)[0]).toMatchObject({
      kind: 'image',
      mediaId: 'IMG1',
      mimeType: 'image/jpeg',
    })
    const doc = WhatsAppInboundSchema.parse(
      envelope({
        type: 'document',
        document: {
          id: 'DOC1',
          mime_type: 'application/pdf',
          filename: 'statement.pdf',
        },
      }),
    )
    expect(extractInboundEvents(doc)[0]).toMatchObject({
      kind: 'document',
      mediaId: 'DOC1',
      mimeType: 'application/pdf',
      filename: 'statement.pdf',
    })
  })

  it('skips unknown types and status-only payloads', () => {
    const p = WhatsAppInboundSchema.parse(
      envelope({ type: 'reaction', reaction: { emoji: '👍' } }),
    )
    expect(extractInboundEvents(p)).toEqual([])
  })

  it('extractTextMessages still returns only text (parity)', () => {
    const p = WhatsAppInboundSchema.parse(
      envelope({ type: 'audio', audio: { id: 'M', mime_type: 'audio/ogg' } }),
    )
    expect(extractTextMessages(p)).toEqual([])
  })
})
