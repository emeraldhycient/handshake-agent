import { Logger } from '@nestjs/common';

import type { EffectiveConfigService } from '../../core/config/application/effective-config.service';
import type { WebhooksConfig } from '../../core/config/configuration';
import type {
  IWebhookEventRepository,
  WebhookEventRecord,
} from './application/ports/webhook-event.repository.port';
import type { IWebhookDispatch } from './application/ports/webhook-dispatch.port';
import { WebhookSweeperService } from './webhook-sweeper.service';

const CFG: WebhooksConfig = {
  maxAttempts: 5,
  backoffMs: 2_000,
  sweepGracePeriodSec: 60,
  sweepBatchSize: 50,
};

function makeRecord(id: string): WebhookEventRecord {
  return {
    id,
    provider: 'blockradar',
    providerEventId: `evt-${id}`,
    payload: {},
    headers: {},
    signature: null,
    status: 'received',
    attempts: 0,
    lastError: null,
    receivedAt: new Date(Date.now() - 300_000),
    lastAttemptAt: null,
    processedAt: null,
    deadAt: null,
  };
}

describe('WebhookSweeperService', () => {
  let repo: jest.Mocked<Pick<IWebhookEventRepository, 'findStuckReceived'>>;
  let dispatch: jest.Mocked<IWebhookDispatch>;
  let config: EffectiveConfigService;
  let service: WebhookSweeperService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    repo = { findStuckReceived: jest.fn().mockResolvedValue([]) };
    dispatch = { enqueue: jest.fn().mockResolvedValue(undefined) };
    config = {
      get: jest.fn().mockReturnValue(CFG),
    } as unknown as EffectiveConfigService;
    service = new WebhookSweeperService(
      repo as unknown as IWebhookEventRepository,
      dispatch,
      config,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('re-enqueues every stuck received row', async () => {
    repo.findStuckReceived.mockResolvedValue([
      makeRecord('a'),
      makeRecord('b'),
    ]);

    await service.tick();

    expect(repo.findStuckReceived).toHaveBeenCalledWith(60, 50);
    expect(dispatch.enqueue).toHaveBeenCalledWith('a');
    expect(dispatch.enqueue).toHaveBeenCalledWith('b');
  });

  it('one enqueue failure does not abort the batch', async () => {
    repo.findStuckReceived.mockResolvedValue([
      makeRecord('a'),
      makeRecord('b'),
    ]);
    dispatch.enqueue.mockRejectedValueOnce(new Error('redis down'));

    await service.tick();

    expect(dispatch.enqueue).toHaveBeenCalledTimes(2);
  });

  it('skips a re-entrant tick while one is running', async () => {
    let release: () => void = () => undefined;
    repo.findStuckReceived.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );

    const first = service.tick();
    const second = service.tick(); // should short-circuit
    release();
    await Promise.all([first, second]);

    expect(repo.findStuckReceived).toHaveBeenCalledTimes(1);
  });
});
