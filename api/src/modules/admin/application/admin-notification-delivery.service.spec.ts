import { AdminNotificationDeliveryService } from './admin-notification-delivery.service';
import type {
  DeliveryLogRowRecord,
  DeliveryStatsRecord,
  INotificationDeliveryReadRepository,
} from './ports/notification-delivery-read.repository.port';

function makeRows(): DeliveryLogRowRecord[] {
  return [
    {
      id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      channel: 'whatsapp',
      templateKey: 'kyc.approved',
      eventType: 'kyc_approved',
      createdAt: new Date('2026-07-01T09:00:00.000Z'),
      status: 'delivered',
    },
    {
      id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
      channel: 'email',
      templateKey: null,
      eventType: 'transaction_completed',
      createdAt: new Date('2026-07-01T08:00:00.000Z'),
      status: 'bounced',
    },
  ];
}

function makeStats(): DeliveryStatsRecord {
  return { bouncedCount: 2, complaintCount: 1, totalDispatches: 500 };
}

describe('AdminNotificationDeliveryService', () => {
  let repo: jest.Mocked<INotificationDeliveryReadRepository>;
  let service: AdminNotificationDeliveryService;

  beforeEach(() => {
    repo = {
      recentDeliveries: jest.fn().mockResolvedValue(makeRows()),
      deliveryStats: jest.fn().mockResolvedValue(makeStats()),
    };
    service = new AdminNotificationDeliveryService(repo);
  });

  it('maps rows to the contract, serializing createdAt to ISO', async () => {
    const result = await service.deliveryLog();

    expect(result.items).toEqual([
      {
        id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        channel: 'whatsapp',
        templateKey: 'kyc.approved',
        eventType: 'kyc_approved',
        createdAt: '2026-07-01T09:00:00.000Z',
        status: 'delivered',
      },
      {
        id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
        channel: 'email',
        templateKey: null,
        eventType: 'transaction_completed',
        createdAt: '2026-07-01T08:00:00.000Z',
        status: 'bounced',
      },
    ]);
  });

  it('computes bounce/complaint RATES as fractions of the dispatch sample', async () => {
    const result = await service.deliveryLog();

    expect(result.stats.bounceRate).toBeCloseTo(2 / 500);
    expect(result.stats.complaintRate).toBeCloseTo(1 / 500);
    expect(result.stats.sampleSize).toBe(500);
  });

  it('reports zero rates (never NaN) when there are no dispatches', async () => {
    repo.deliveryStats.mockResolvedValue({
      bouncedCount: 0,
      complaintCount: 0,
      totalDispatches: 0,
    });

    const result = await service.deliveryLog();

    expect(result.stats.bounceRate).toBe(0);
    expect(result.stats.complaintRate).toBe(0);
    expect(result.stats.sampleSize).toBe(0);
  });

  it('requests a bounded delivery window and dispatch sample', async () => {
    await service.deliveryLog();

    const [rowLimit] = repo.recentDeliveries.mock.calls[0];
    const [sampleWindow] = repo.deliveryStats.mock.calls[0];
    expect(rowLimit).toBeGreaterThan(0);
    expect(rowLimit).toBeLessThanOrEqual(200);
    expect(sampleWindow).toBeGreaterThan(0);
  });

  it('drops a channel the contract does not model (e.g. web)', async () => {
    repo.recentDeliveries.mockResolvedValue([
      {
        id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d',
        channel: 'web',
        templateKey: null,
        eventType: 'balance_update',
        createdAt: new Date('2026-07-01T07:00:00.000Z'),
        status: 'sent',
      },
      ...makeRows(),
    ]);

    const result = await service.deliveryLog();

    // `web` is an agent surface, not a notification delivery channel — excluded.
    expect(result.items.map((r) => r.channel)).not.toContain('web');
    expect(result.items).toHaveLength(2);
  });
});
