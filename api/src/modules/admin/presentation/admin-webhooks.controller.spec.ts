import type { AdminWebhooksService } from '../application/admin-webhooks.service';
import type { WebhookMetricsService } from '../../webhooks/application/webhook-metrics.service';
import type { AdminContext } from './current-admin.decorator';
import { AdminWebhooksController } from './admin-webhooks.controller';

const DETAIL = {
  id: 'wh-1',
  provider: 'blockradar' as const,
  providerEventId: 'evt-1',
  status: 'dead' as const,
  attempts: 5,
  lastError: 'boom',
  receivedAt: '2026-07-04T06:00:00.000Z',
  processedAt: null,
  payload: { event: 'deposit.success' },
  headers: { 'x-sig': 'a' },
  signature: 'a',
  lastAttemptAt: '2026-07-04T06:05:00.000Z',
  deadAt: '2026-07-04T06:06:00.000Z',
};

describe('AdminWebhooksController', () => {
  let webhooks: jest.Mocked<
    Pick<AdminWebhooksService, 'list' | 'detail' | 'retry'>
  >;
  let metrics: jest.Mocked<Pick<WebhookMetricsService, 'snapshot'>>;
  let controller: AdminWebhooksController;

  beforeEach(() => {
    webhooks = {
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      detail: jest.fn().mockResolvedValue(DETAIL),
      retry: jest.fn().mockResolvedValue(DETAIL),
    };
    metrics = {
      snapshot: jest.fn().mockResolvedValue({
        byStatus: {
          received: 1,
          processing: 0,
          succeeded: 3,
          failed: 1,
          dead: 1,
        },
        depth: 1,
        failed: 1,
        dead: 1,
      }),
    };
    controller = new AdminWebhooksController(
      webhooks as unknown as AdminWebhooksService,
      metrics as unknown as WebhookMetricsService,
    );
  });

  it('list delegates to the service', async () => {
    const res = await controller.list({ limit: 25 });
    expect(webhooks.list).toHaveBeenCalled();
    expect(res).toEqual({ items: [], nextCursor: null });
  });

  it('getMetrics returns the metrics snapshot', async () => {
    const res = await controller.getMetrics();
    expect(res.depth).toBe(1);
    expect(res.dead).toBe(1);
  });

  it('detail delegates to the service', async () => {
    const res = await controller.detail('wh-1');
    expect(webhooks.detail).toHaveBeenCalledWith('wh-1');
    expect(res.id).toBe('wh-1');
  });

  it('retry passes the admin id + reason and returns the refreshed detail', async () => {
    const admin: AdminContext = { adminId: 'admin-7' } as AdminContext;
    const res = await controller.retry('wh-1', { reason: 'redeliver' }, admin);
    expect(webhooks.retry).toHaveBeenCalledWith('wh-1', 'admin-7', 'redeliver');
    expect(res.id).toBe('wh-1');
  });
});
