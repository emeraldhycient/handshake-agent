/**
 * Unit tests for the (thin) SumsubWebhookController.
 *
 * Mirrors blockradar-webhook.controller.spec.ts: the controller only verifies
 * the HMAC-SHA256 `x-payload-digest` signature, then persists + enqueues via
 * WebhookIngestionService, then ACKs 200. Tier-grant behavior moved to
 * SumsubWebhookHandler (see sumsub-webhook.handler.spec.ts).
 */

import { Logger } from '@nestjs/common';

import type { WebhookIngestionService } from '../../webhooks/application/webhook-ingestion.service';
import { SumsubWebhookController } from './sumsub-webhook.controller';
import { hmacHex } from '../../../core/crypto/hmac';

const SECRET = 'sumsub-test-webhook-secret';

function makeRawBody(obj: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(obj), 'utf8');
}
function makeValidSig(body: Buffer): string {
  return hmacHex('sha256', SECRET, body);
}

function makeController(
  ingestBehavior: 'ok' | 'throw' = 'ok',
  secret: string | undefined = SECRET,
) {
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
        k === 'SUMSUB_WEBHOOK_SECRET' ? secret : undefined,
      ),
  };
  const controller = new SumsubWebhookController(
    config as never,
    ingestion as unknown as WebhookIngestionService,
  );
  return { controller, ingestion };
}

describe('SumsubWebhookController (thin)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const body = {
    type: 'applicantReviewed',
    externalUserId: 'user-1',
    applicantId: 'app-1',
    levelName: 'id-and-liveness',
    reviewResult: { reviewAnswer: 'GREEN' },
  };

  it('valid sig → ingests with provider/rawBody/signature and ACKs 200', async () => {
    const { controller, ingestion } = makeController();
    const raw = makeRawBody(body);
    const sig = makeValidSig(raw);

    const res = await controller.handleWebhook(body, raw, sig);

    expect(res).toEqual({ status: 'ok' });
    expect(ingestion.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'sumsub',
        parsedBody: body,
        rawBody: raw,
        signature: sig,
      }),
    );
  });

  it('invalid sig → 401, ingest NOT called', async () => {
    const { controller, ingestion } = makeController();
    const raw = makeRawBody(body);
    const badSig = 'deadbeef'.repeat(8); // 64 hex chars — same length as a real sha256 hex digest

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

  it('unconfigured secret → 401 fail-closed, even against a signature forged with an empty key', async () => {
    const { controller, ingestion } = makeController('ok', '');
    const raw = makeRawBody(body);
    // An attacker who knows the secret is unconfigured could compute this —
    // the endpoint must still reject it rather than accept an empty-key HMAC.
    const forgedSig = hmacHex('sha256', '', raw);

    await expect(
      controller.handleWebhook(body, raw, forgedSig),
    ).rejects.toMatchObject({ status: 401 });
    expect(ingestion.ingest).not.toHaveBeenCalled();
  });

  it('honors x-payload-digest-alg=HMAC_SHA512_HEX (verifies a SHA-512 digest)', async () => {
    const { controller, ingestion } = makeController();
    const raw = makeRawBody(body);
    const sig = hmacHex('sha512', SECRET, raw);

    const res = await controller.handleWebhook(
      body,
      raw,
      sig,
      'HMAC_SHA512_HEX',
    );

    expect(res).toEqual({ status: 'ok' });
    expect(ingestion.ingest).toHaveBeenCalled();
  });

  it('honors x-payload-digest-alg=HMAC_SHA1_HEX (verifies a SHA-1 digest)', async () => {
    const { controller, ingestion } = makeController();
    const raw = makeRawBody(body);
    const sig = hmacHex('sha1', SECRET, raw);

    const res = await controller.handleWebhook(body, raw, sig, 'HMAC_SHA1_HEX');

    expect(res).toEqual({ status: 'ok' });
    expect(ingestion.ingest).toHaveBeenCalled();
  });

  it('a SHA-512 digest is rejected when the alg header still claims SHA-256 (mismatch → 401)', async () => {
    const { controller, ingestion } = makeController();
    const raw = makeRawBody(body);
    const sha512Sig = hmacHex('sha512', SECRET, raw);

    await expect(
      controller.handleWebhook(body, raw, sha512Sig, 'HMAC_SHA256_HEX'),
    ).rejects.toMatchObject({ status: 401 });
    expect(ingestion.ingest).not.toHaveBeenCalled();
  });

  it('an unrecognized x-payload-digest-alg → 401 fail-closed', async () => {
    const { controller, ingestion } = makeController();
    const raw = makeRawBody(body);
    const sig = makeValidSig(raw);

    await expect(
      controller.handleWebhook(body, raw, sig, 'HMAC_MD5_HEX'),
    ).rejects.toMatchObject({ status: 401 });
    expect(ingestion.ingest).not.toHaveBeenCalled();
  });

  it('defaults to SHA-256 when the alg header is absent (back-compat)', async () => {
    const { controller, ingestion } = makeController();
    const raw = makeRawBody(body);
    const sig = makeValidSig(raw);

    const res = await controller.handleWebhook(body, raw, sig);

    expect(res).toEqual({ status: 'ok' });
    expect(ingestion.ingest).toHaveBeenCalled();
  });

  it('persistence failure propagates (5xx so Sumsub redelivers)', async () => {
    const { controller } = makeController('throw');
    const raw = makeRawBody(body);
    const sig = makeValidSig(raw);
    await expect(controller.handleWebhook(body, raw, sig)).rejects.toThrow(
      'db down',
    );
  });
});
