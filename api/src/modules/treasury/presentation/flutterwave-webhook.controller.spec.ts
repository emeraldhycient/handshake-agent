/**
 * Unit tests for the (thin) FlutterwaveWebhookController.
 *
 * The controller now only: verifies the `verif-hash` secret, then persists +
 * enqueues via WebhookIngestionService, then ACKs 200. The settlement behavior
 * moved to FlutterwaveWebhookHandler (see flutterwave-webhook.handler.spec.ts).
 */
import { Logger } from '@nestjs/common';
import type { Request } from 'express';

import { sha256Hex } from '../../../core/crypto/hmac';
import type { IPaymentProvider } from '../application/ports/payment-provider.port';
import type { WebhookIngestionService } from '../../webhooks/application/webhook-ingestion.service';
import { FlutterwaveWebhookController } from './flutterwave-webhook.controller';

const VALID_HASH = 'my-webhook-secret';

function makeController(
  verifyResult = true,
  ingestBehavior: 'ok' | 'throw' = 'ok',
) {
  const paymentProvider = {
    verifyWebhookSignature: jest.fn().mockReturnValue(verifyResult),
  } as unknown as jest.Mocked<IPaymentProvider>;
  const ingestion = {
    ingest:
      ingestBehavior === 'throw'
        ? jest.fn().mockRejectedValue(new Error('db down'))
        : jest.fn().mockResolvedValue({ id: 'wh-1', duplicate: false }),
  };
  const controller = new FlutterwaveWebhookController(
    paymentProvider,
    ingestion as unknown as WebhookIngestionService,
  );
  return { controller, paymentProvider, ingestion };
}

function makeReq(hash: string | undefined): Request {
  return { headers: hash ? { 'verif-hash': hash } : {} } as unknown as Request;
}

const body = {
  event: 'charge.completed',
  data: { id: 999, tx_ref: 'ref-1', status: 'successful' },
};

describe('FlutterwaveWebhookController (thin)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('valid hash → ingests as flutterwave + ACKs 200', async () => {
    const { controller, ingestion } = makeController();
    const res = await controller.handleWebhook(body, makeReq(VALID_HASH));
    expect(res).toEqual({ status: 'ok' });
    expect(ingestion.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'flutterwave',
        parsedBody: body,
        signature: `sha256:${sha256Hex(VALID_HASH)}`,
      }),
    );
  });

  it('never passes the raw verif-hash (the static secret) as the signature', async () => {
    const { controller, ingestion } = makeController();
    await controller.handleWebhook(body, makeReq(VALID_HASH));
    expect(ingestion.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        signature: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) as string,
      }),
    );
    expect(ingestion.ingest).not.toHaveBeenCalledWith(
      expect.objectContaining({
        signature: expect.stringContaining(VALID_HASH) as string,
      }),
    );
  });

  it('invalid hash → 401, ingest NOT called', async () => {
    const { controller, ingestion } = makeController(false);
    await expect(
      controller.handleWebhook(body, makeReq('bad')),
    ).rejects.toMatchObject({ status: 401 });
    expect(ingestion.ingest).not.toHaveBeenCalled();
  });

  it('persistence failure propagates (5xx so Flutterwave redelivers)', async () => {
    const { controller } = makeController(true, 'throw');
    await expect(
      controller.handleWebhook(body, makeReq(VALID_HASH)),
    ).rejects.toThrow('db down');
  });
});
