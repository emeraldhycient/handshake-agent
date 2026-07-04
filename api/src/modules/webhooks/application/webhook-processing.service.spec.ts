import { Logger } from '@nestjs/common';

import type {
  IWebhookEventRepository,
  WebhookEventRecord,
} from './ports/webhook-event.repository.port';
import type {
  WebhookHandler,
  WebhookHandlerRegistry,
} from './ports/webhook-handler.port';
import { WebhookProcessingService } from './webhook-processing.service';

function makeRecord(
  over: Partial<WebhookEventRecord> = {},
): WebhookEventRecord {
  return {
    id: 'wh-1',
    provider: 'blockradar',
    providerEventId: 'evt_1',
    payload: { event: 'deposit.success' },
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

describe('WebhookProcessingService', () => {
  let repo: jest.Mocked<IWebhookEventRepository>;
  let handler: jest.Mocked<WebhookHandler>;
  let registry: WebhookHandlerRegistry;
  let service: WebhookProcessingService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    repo = {
      createIfNew: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      markProcessing: jest.fn().mockResolvedValue(undefined),
      markSucceeded: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      markDead: jest.fn().mockResolvedValue(undefined),
      resetToReceived: jest.fn(),
      findStuckReceived: jest.fn(),
      countByStatus: jest.fn(),
    };

    handler = { provider: 'blockradar', handle: jest.fn() };
    registry = new Map([['blockradar', handler]]);
    service = new WebhookProcessingService(repo, registry);
  });

  afterEach(() => jest.restoreAllMocks());

  it('marks processing, runs the handler, marks succeeded', async () => {
    repo.findById.mockResolvedValue(makeRecord());
    handler.handle.mockResolvedValue(undefined);

    await service.process('wh-1');

    expect(repo.markProcessing).toHaveBeenCalledWith('wh-1');
    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(repo.markSucceeded).toHaveBeenCalledWith('wh-1');
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('is a no-op when the row is already succeeded (dedup on re-delivery)', async () => {
    repo.findById.mockResolvedValue(makeRecord({ status: 'succeeded' }));

    await service.process('wh-1');

    expect(repo.markProcessing).not.toHaveBeenCalled();
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('is a no-op when the row is dead', async () => {
    repo.findById.mockResolvedValue(makeRecord({ status: 'dead' }));
    await service.process('wh-1');
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('throws (and does nothing) when the row is missing', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.process('missing')).rejects.toThrow();
    expect(repo.markProcessing).not.toHaveBeenCalled();
  });

  it('marks failed AND re-throws when the handler throws (BullMQ retries)', async () => {
    repo.findById.mockResolvedValue(makeRecord());
    handler.handle.mockRejectedValue(new Error('settlement boom'));

    await expect(service.process('wh-1')).rejects.toThrow('settlement boom');

    expect(repo.markProcessing).toHaveBeenCalledWith('wh-1');
    expect(repo.markFailed).toHaveBeenCalledWith('wh-1', 'settlement boom');
    expect(repo.markSucceeded).not.toHaveBeenCalled();
  });

  it('marks failed + throws when no handler is registered for the provider', async () => {
    repo.findById.mockResolvedValue(makeRecord({ provider: 'flutterwave' }));

    await expect(service.process('wh-1')).rejects.toThrow(/no handler/i);
    expect(repo.markFailed).toHaveBeenCalledWith(
      'wh-1',
      expect.stringMatching(/no handler/i),
    );
  });

  it('handleExhausted marks the row dead', async () => {
    await service.handleExhausted('wh-1', new Error('gave up'));
    expect(repo.markDead).toHaveBeenCalledWith('wh-1', 'gave up');
  });
});
