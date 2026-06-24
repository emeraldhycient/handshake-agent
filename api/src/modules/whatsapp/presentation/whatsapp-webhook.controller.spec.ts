import { ForbiddenException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { Env } from '../../../core/config/env.schema';
import type { IInboundHandler } from '../application/ports/inbound-handler.port';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VERIFY_TOKEN = 'test-verify-token';
const CHALLENGE = 'challenge-abc123';

/** Build a minimal typed ConfigService stub. */
function makeConfig(verifyToken: string): ConfigService<Env, true> {
  return {
    get: jest.fn((key: keyof Env) => {
      if (key === 'WHATSAPP_VERIFY_TOKEN') return verifyToken;
      return undefined;
    }),
  } as unknown as ConfigService<Env, true>;
}

/** Build a minimal IInboundHandler mock. */
function makeHandler(): jest.Mocked<IInboundHandler> {
  return { handleInbound: jest.fn().mockResolvedValue(undefined) };
}

// ---------------------------------------------------------------------------
// Sample payloads
// ---------------------------------------------------------------------------

const TEXT_PAYLOAD = {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WhatsAppWebhookController', () => {
  describe('GET /whatsapp/webhook (verify)', () => {
    it('returns the challenge when mode=subscribe and token matches', () => {
      const controller = new WhatsAppWebhookController(
        makeConfig(VERIFY_TOKEN),
        makeHandler(),
      );

      const result = controller.verify({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': CHALLENGE,
      });

      expect(result).toBe(CHALLENGE);
    });

    it('throws ForbiddenException when the token does not match', () => {
      const controller = new WhatsAppWebhookController(
        makeConfig(VERIFY_TOKEN),
        makeHandler(),
      );

      expect(() =>
        controller.verify({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong-token',
          'hub.challenge': CHALLENGE,
        }),
      ).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when mode is not "subscribe"', () => {
      const controller = new WhatsAppWebhookController(
        makeConfig(VERIFY_TOKEN),
        makeHandler(),
      );

      expect(() =>
        controller.verify({
          'hub.mode': 'unsubscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': CHALLENGE,
        }),
      ).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException + logs a warning when WHATSAPP_VERIFY_TOKEN is empty', () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const controller = new WhatsAppWebhookController(
        makeConfig(''),
        makeHandler(),
      );

      expect(() =>
        controller.verify({
          'hub.mode': 'subscribe',
          'hub.verify_token': '',
          'hub.challenge': CHALLENGE,
        }),
      ).toThrow(ForbiddenException);

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('POST /whatsapp/webhook (receive)', () => {
    it('calls handleInbound once with the mapped DTO and returns a 200 ack body', async () => {
      const handler = makeHandler();
      const controller = new WhatsAppWebhookController(
        makeConfig(VERIFY_TOKEN),
        handler,
      );

      const result = await controller.receive(TEXT_PAYLOAD);

      expect(handler.handleInbound).toHaveBeenCalledTimes(1);
      expect(handler.handleInbound).toHaveBeenCalledWith(
        expect.objectContaining({
          externalMessageId: 'wamid.HBgL2347088639675VBIhAkZZA==',
          fromAddress: '2347088639675',
          phoneNumberId: '1248377751698132',
          waName: 'Test User',
          text: 'buy 5000 naira of usdt',
          timestamp: '1720000000',
          channel: 'whatsapp',
        }),
      );
      expect(result).toEqual({ status: 'received' });
    });

    it('calls handler zero times and returns 200 for a status-only payload', async () => {
      const handler = makeHandler();
      const controller = new WhatsAppWebhookController(
        makeConfig(VERIFY_TOKEN),
        handler,
      );

      const result = await controller.receive(STATUS_ONLY_PAYLOAD);

      expect(handler.handleInbound).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'received' });
    });

    it('returns 200 even when the handler throws (error is caught + logged)', async () => {
      const handler = makeHandler();
      handler.handleInbound.mockRejectedValue(new Error('handler boom'));

      const controller = new WhatsAppWebhookController(
        makeConfig(VERIFY_TOKEN),
        handler,
      );

      const result = await controller.receive(TEXT_PAYLOAD);
      expect(result).toEqual({ status: 'received' });
    });

    it('returns 200 with ack body for a malformed payload (parse failure)', async () => {
      const controller = new WhatsAppWebhookController(
        makeConfig(VERIFY_TOKEN),
        makeHandler(),
      );

      // Not a valid WhatsAppInbound payload

      const result = await controller.receive({ totally: 'wrong' } as any);
      expect(result).toEqual({ status: 'received' });
    });
  });
});
