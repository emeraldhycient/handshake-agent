import type { IWebhookEventRepository } from './ports/webhook-event.repository.port';
import { WebhookMetricsService } from './webhook-metrics.service';

describe('WebhookMetricsService', () => {
  let repo: jest.Mocked<Pick<IWebhookEventRepository, 'countByStatus'>>;
  let service: WebhookMetricsService;

  beforeEach(() => {
    repo = { countByStatus: jest.fn() };
    service = new WebhookMetricsService(
      repo as unknown as IWebhookEventRepository,
    );
  });

  it('maps status counts to depth / failed / dead', async () => {
    repo.countByStatus.mockResolvedValue({
      received: 3,
      processing: 2,
      succeeded: 10,
      failed: 4,
      dead: 1,
    });

    const snap = await service.snapshot();

    expect(snap.depth).toBe(5); // received + processing
    expect(snap.failed).toBe(4);
    expect(snap.dead).toBe(1);
    expect(snap.byStatus).toEqual({
      received: 3,
      processing: 2,
      succeeded: 10,
      failed: 4,
      dead: 1,
    });
  });

  it('defaults missing statuses to zero', async () => {
    repo.countByStatus.mockResolvedValue({ succeeded: 2 });

    const snap = await service.snapshot();

    expect(snap.depth).toBe(0);
    expect(snap.failed).toBe(0);
    expect(snap.dead).toBe(0);
    expect(snap.byStatus).toEqual({
      received: 0,
      processing: 0,
      succeeded: 2,
      failed: 0,
      dead: 0,
    });
  });
});
