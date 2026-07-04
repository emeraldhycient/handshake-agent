/**
 * Unit tests for the (thin) BlockradarWebhookController.
 *
 * The controller now only: verifies the HMAC-SHA512 signature, then persists +
 * enqueues via WebhookIngestionService, then ACKs 200. The settlement behavior
 * moved to BlockradarWebhookHandler (see blockradar-webhook.handler.spec.ts).
 */

import { Logger } from '@nestjs/common';

import type { WebhookIngestionService } from '../../webhooks/application/webhook-ingestion.service';
import { BlockradarWebhookController } from './blockradar-webhook.controller';
import { hmacHex } from '../../../core/crypto/hmac';

const API_KEY = 'blockradar-test-api-key';

function makeRawBody(obj: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(obj), 'utf8');
}
function makeValidSig(body: Buffer): string {
  return hmacHex('sha512', API_KEY, body);
}

function makeController(ingestBehavior: 'ok' | 'throw' = 'ok') {
  const ingestion = {
    ingest:
      ingestBehavior === 'throw'
        ? jest.fn().mockRejectedValue(new Error('db down'))
        : jest.fn().mockResolvedValue({ id: 'wh-1', duplicate: false }),
  };
  const config = {
    get: jest
      .fn()
      .mockImplementation((k: string) =>
        k === 'BLOCKRADAR_API_KEY' ? API_KEY : undefined,
      ),
  };
  const controller = new BlockradarWebhookController(
    config as never,
    ingestion as unknown as WebhookIngestionService,
  );
  return { controller, ingestion };
}

describe('BlockradarWebhookController (thin)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const body = {
    event: 'deposit.success',
    data: { id: 'br-evt-1', hash: '0xabc' },
  };

  it('valid sig → ingests with provider/rawBody/signature and ACKs 200', async () => {
    const { controller, ingestion } = makeController();
    const raw = makeRawBody(body);
    const sig = makeValidSig(raw);

    const res = await controller.handleWebhook(body, raw, sig);

    expect(res).toEqual({ status: 'ok' });
    expect(ingestion.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'blockradar',
        parsedBody: body,
        rawBody: raw,
        signature: sig,
      }),
    );
  });

  it('invalid sig → 401, ingest NOT called', async () => {
    const { controller, ingestion } = makeController();
    const raw = makeRawBody(body);
    const badSig = 'deadbeef'.repeat(16);

    await expect(
      controller.handleWebhook(body, raw, badSig),
    ).rejects.toMatchObject({ status: 401 });
    expect(ingestion.ingest).not.toHaveBeenCalled();
  });

  it('missing signature → 401', async () => {
    const { controller, ingestion } = makeController();
    const raw = makeRawBody(body);
    await expect(
      controller.handleWebhook(body, raw, undefined),
    ).rejects.toMatchObject({ status: 401 });
    expect(ingestion.ingest).not.toHaveBeenCalled();
  });

  it('persistence failure propagates (5xx so Blockradar redelivers)', async () => {
    const { controller } = makeController('throw');
    const raw = makeRawBody(body);
    const sig = makeValidSig(raw);
    await expect(controller.handleWebhook(body, raw, sig)).rejects.toThrow(
      'db down',
    );
  });
});
