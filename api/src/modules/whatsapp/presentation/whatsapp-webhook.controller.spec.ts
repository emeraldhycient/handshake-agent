import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { Env } from '../../../core/config/env.schema';
import type { WebhookIngestionService } from '../../webhooks/application/webhook-ingestion.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

const VERIFY_TOKEN = 'test-verify-token';
const CHALLENGE = 'challenge-abc123';

function makeConfig(verifyToken: string): ConfigService<Env, true> {
  return {
    get: jest.fn((key: keyof Env) =>
      key === 'WHATSAPP_VERIFY_TOKEN' ? verifyToken : undefined,
    ),
  } as unknown as ConfigService<Env, true>;
}

function makeIngestion(behavior: 'ok' | 'throw' = 'ok') {
  return {
    ingest:
      behavior === 'throw'
        ? jest.fn().mockRejectedValue(new Error('db down'))
        : jest.fn().mockResolvedValue({ id: 'wh-1', duplicate: false }),
  };
}

function makeController(
  verifyToken = VERIFY_TOKEN,
  ingestBehavior: 'ok' | 'throw' = 'ok',
) {
  const ingestion = makeIngestion(ingestBehavior);
  const controller = new WhatsAppWebhookController(
    makeConfig(verifyToken),
    ingestion as unknown as WebhookIngestionService,
  );
  return { controller, ingestion };
}

function makeReq(sig = 'sha256=abc'): Request {
  return {
    headers: { 'x-hub-signature-256': sig },
    rawBody: Buffer.from('{"object":"whatsapp_business_account"}', 'utf8'),
  } as unknown as Request;
}

const TEXT_PAYLOAD = {
  object: 'whatsapp_business_account',
  entry: [{ id: 'E', changes: [] }],
};

describe('WhatsAppWebhookController (thin)', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('GET /whatsapp/webhook (verify)', () => {
    it('returns the challenge when mode=subscribe and token matches', () => {
      const { controller } = makeController();
      expect(
        controller.verify({
          'hub.mode': 'subscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': CHALLENGE,
        }),
      ).toBe(CHALLENGE);
    });

    it('throws when the token does not match', () => {
      const { controller } = makeController();
      expect(() =>
        controller.verify({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong',
          'hub.challenge': CHALLENGE,
        }),
      ).toThrow(ForbiddenException);
    });

    it('throws when mode is not subscribe', () => {
      const { controller } = makeController();
      expect(() =>
        controller.verify({
          'hub.mode': 'unsubscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': CHALLENGE,
        }),
      ).toThrow(ForbiddenException);
    });

    it('throws when WHATSAPP_VERIFY_TOKEN is empty (no silent path)', () => {
      const { controller } = makeController('');
      expect(() =>
        controller.verify({
          'hub.mode': 'subscribe',
          'hub.verify_token': '',
          'hub.challenge': CHALLENGE,
        }),
      ).toThrow(ForbiddenException);
    });
  });

  describe('POST /whatsapp/webhook (receive)', () => {
    it('persists+enqueues the raw payload as whatsapp and ACKs 200', async () => {
      const { controller, ingestion } = makeController();
      const res = await controller.receive(TEXT_PAYLOAD, makeReq());

      expect(res).toEqual({ status: 'received' });
      expect(ingestion.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'whatsapp',
          parsedBody: TEXT_PAYLOAD,
          signature: 'sha256=abc',
        }),
      );
    });

    it('ingests even a malformed payload (the worker validates the schema)', async () => {
      const { controller, ingestion } = makeController();
      const res = await controller.receive({ totally: 'wrong' }, makeReq());
      expect(ingestion.ingest).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ status: 'received' });
    });

    it('persistence failure propagates (5xx so Meta redelivers)', async () => {
      const { controller } = makeController(VERIFY_TOKEN, 'throw');
      await expect(controller.receive(TEXT_PAYLOAD, makeReq())).rejects.toThrow(
        'db down',
      );
    });
  });
});
