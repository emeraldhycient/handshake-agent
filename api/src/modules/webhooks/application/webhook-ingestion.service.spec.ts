import { Logger } from '@nestjs/common';

import type {
  IWebhookEventRepository,
  WebhookEventRecord,
} from './ports/webhook-event.repository.port';
import type { IWebhookDispatch } from './ports/webhook-dispatch.port';
import { WebhookIngestionService } from './webhook-ingestion.service';

function makeRecord(
  over: Partial<WebhookEventRecord> = {},
): WebhookEventRecord {
  return {
    id: 'wh-1',
    provider: 'blockradar',
    providerEventId: 'evt_1',
    payload: {},
    headers: {},
    signature: null,
    status: 'received',
    attempts: 0,
    lastError: null,
    receivedAt: new Date(),
    lastAttemptAt: null,
    processedAt: null,
    deadAt: null,
    ...over,
  };
}

describe('WebhookIngestionService', () => {
  let repo: jest.Mocked<IWebhookEventRepository>;
  let dispatch: jest.Mocked<IWebhookDispatch>;
  let service: WebhookIngestionService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    repo = {
      createIfNew: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      markProcessing: jest.fn(),
      markSucceeded: jest.fn(),
      markFailed: jest.fn(),
      markDead: jest.fn(),
      resetToReceived: jest.fn(),
      findStuckReceived: jest.fn(),
      countByStatus: jest.fn(),
    };

    dispatch = { enqueue: jest.fn().mockResolvedValue(undefined) };
    service = new WebhookIngestionService(repo, dispatch);
  });

  afterEach(() => jest.restoreAllMocks());

  it('persists a new event with the derived id, then enqueues it', async () => {
    repo.createIfNew.mockResolvedValue({
      record: makeRecord({ id: 'wh-9' }),
      duplicate: false,
    });

    const res = await service.ingest({
      provider: 'blockradar',
      parsedBody: { data: { id: 'BR-EVENT-1' } },
      rawBody: '{"data":{"id":"BR-EVENT-1"}}',
      headers: { 'x-blockradar-signature': 'sig' },
      signature: 'sig',
    });

    expect(res).toEqual({ id: 'wh-9', duplicate: false });
    const arg = repo.createIfNew.mock.calls[0][0];
    expect(arg.provider).toBe('blockradar');
    expect(arg.providerEventId).toBe('BR-EVENT-1');
    expect(arg.signature).toBe('sig');
    expect(arg.headers).toEqual({ 'x-blockradar-signature': 'sig' });
    expect(dispatch.enqueue).toHaveBeenCalledWith('wh-9');
  });

  it('does NOT enqueue a duplicate delivery', async () => {
    repo.createIfNew.mockResolvedValue({
      record: makeRecord({ id: 'wh-dup' }),
      duplicate: true,
    });

    const res = await service.ingest({
      provider: 'flutterwave',
      parsedBody: { data: { id: 7 } },
      rawBody: '{"data":{"id":7}}',
      headers: {},
    });

    expect(res).toEqual({ id: 'wh-dup', duplicate: true });
    expect(dispatch.enqueue).not.toHaveBeenCalled();
  });

  it('still resolves when enqueue throws (Redis down) — persistence is durable', async () => {
    repo.createIfNew.mockResolvedValue({
      record: makeRecord({ id: 'wh-2' }),
      duplicate: false,
    });
    dispatch.enqueue.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await service.ingest({
      provider: 'whatsapp',
      parsedBody: {},
      rawBody: '{}',
      headers: {},
    });

    expect(res).toEqual({ id: 'wh-2', duplicate: false });
  });

  it('propagates a persistence failure (caller returns 5xx — nothing durable yet)', async () => {
    repo.createIfNew.mockRejectedValue(new Error('db down'));

    await expect(
      service.ingest({
        provider: 'blockradar',
        parsedBody: {},
        rawBody: '{}',
        headers: {},
      }),
    ).rejects.toThrow('db down');
    expect(dispatch.enqueue).not.toHaveBeenCalled();
  });

  it('stores non-JSON bodies as { raw }', async () => {
    repo.createIfNew.mockResolvedValue({
      record: makeRecord(),
      duplicate: false,
    });

    await service.ingest({
      provider: 'whatsapp',
      parsedBody: undefined,
      rawBody: 'not-json',
      headers: {},
    });

    const arg = repo.createIfNew.mock.calls[0][0];
    expect(arg.payload).toEqual({ raw: 'not-json' });
  });
});
