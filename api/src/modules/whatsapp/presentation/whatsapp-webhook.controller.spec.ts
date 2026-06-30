import { ForbiddenException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { Env } from '../../../core/config/env.schema';
import type { WhatsAppInboundService } from '../application/whatsapp-inbound.service';
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

/** Build a minimal WhatsAppInboundService mock. */
function makeInboundService(): jest.Mocked<WhatsAppInboundService> {
  return {
    ingest: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<WhatsAppInboundService>;
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
        makeInboundService(),
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
        makeInboundService(),
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
        makeInboundService(),
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
        makeInboundService(),
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
    it('calls inboundService.ingest with the parsed payload and returns a 200 ack body', async () => {
      const inboundService = makeInboundService();
      const controller = new WhatsAppWebhookController(
        makeConfig(VERIFY_TOKEN),
        inboundService,
      );

      const result = await controller.receive(TEXT_PAYLOAD);

      expect(inboundService.ingest).toHaveBeenCalledTimes(1);
      expect(inboundService.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ object: 'whatsapp_business_account' }),
      );
      expect(result).toEqual({ status: 'received' });
    });

    it('calls ingest for a status-only payload (schema passes) and returns 200', async () => {
      const inboundService = makeInboundService();
      const controller = new WhatsAppWebhookController(
        makeConfig(VERIFY_TOKEN),
        inboundService,
      );

      const result = await controller.receive(STATUS_ONLY_PAYLOAD);

      // The schema-valid payload is passed to ingest; the service decides to skip it
      expect(inboundService.ingest).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: 'received' });
    });

    it('returns 200 even when ingest throws (error is caught + logged)', async () => {
      const inboundService = makeInboundService();
      inboundService.ingest.mockRejectedValue(new Error('ingest boom'));

      const controller = new WhatsAppWebhookController(
        makeConfig(VERIFY_TOKEN),
        inboundService,
      );

      const result = await controller.receive(TEXT_PAYLOAD);
      expect(result).toEqual({ status: 'received' });
    });

    it('returns 200 with ack body for a malformed payload (parse failure) without calling ingest', async () => {
      const inboundService = makeInboundService();
      const controller = new WhatsAppWebhookController(
        makeConfig(VERIFY_TOKEN),
        inboundService,
      );

      const result = await controller.receive({ totally: 'wrong' } as any);
      expect(inboundService.ingest).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'received' });
    });
  });
});
