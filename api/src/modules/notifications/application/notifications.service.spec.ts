import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  it('maps repo rows to the response shape', async () => {
    const repo = {
      findByUserId: jest.fn().mockResolvedValue([
        {
          id: '11111111-1111-1111-1111-111111111111',
          eventType: 'transaction_completed',
          eventRef: 'tx1',
          templateVars: { amount: '1' },
          createdAt: new Date('2026-06-29T12:00:00.000Z'),
        },
      ]),
    };
    const svc = new NotificationsService(repo);
    const out = await svc.list('u1');
    expect(repo.findByUserId).toHaveBeenCalledWith('u1', 50);
    expect(out.items[0]).toMatchObject({
      eventType: 'transaction_completed',
      createdAt: '2026-06-29T12:00:00.000Z',
    });
  });
});
