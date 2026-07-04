import { AdminSearchService } from './admin-search.service';
import type { AdminEndUserService } from './admin-end-user.service';
import type { AdminTxnOversightService } from './admin-txn-oversight.service';

describe('AdminSearchService', () => {
  let endUsers: jest.Mocked<Pick<AdminEndUserService, 'list'>>;
  let txns: jest.Mocked<Pick<AdminTxnOversightService, 'list'>>;
  let service: AdminSearchService;

  beforeEach(() => {
    endUsers = { list: jest.fn() };
    txns = { list: jest.fn() };
    service = new AdminSearchService(
      endUsers as unknown as AdminEndUserService,
      txns as unknown as AdminTxnOversightService,
    );
  });

  it('returns nothing for a query shorter than 2 chars (no repo calls)', async () => {
    const res = await service.search('a');
    expect(res.results).toEqual([]);
    expect(endUsers.list).not.toHaveBeenCalled();
    expect(txns.list).not.toHaveBeenCalled();
  });

  it('maps users + transactions into navigable results (user first)', async () => {
    endUsers.list.mockResolvedValue({
      items: [
        {
          id: 'u1',
          email: 'amara@example.com',
          displayName: 'Amara O.',
          kycTier: 'tier_2',
        },
      ],
    } as never);
    txns.list.mockResolvedValue({
      items: [
        {
          id: 'tx1',
          type: 'buy',
          amount: '10.5',
          asset: 'USDT',
          userEmail: 'amara@example.com',
        },
      ],
    } as never);

    const res = await service.search('amara');

    expect(endUsers.list).toHaveBeenCalledWith({ query: 'amara', limit: 5 });
    expect(txns.list).toHaveBeenCalledWith({ q: 'amara', limit: 5 });
    expect(res.results).toEqual([
      {
        kind: 'user',
        href: '/users/u1',
        label: 'Amara O.',
        sublabel: 'User · tier_2',
      },
      {
        kind: 'transaction',
        href: '/transactions/tx1',
        label: 'buy · 10.5 USDT',
        sublabel: 'Transaction · amara@example.com',
      },
    ]);
  });

  it('trims the query and falls back to id when a txn has no amount', async () => {
    endUsers.list.mockResolvedValue({ items: [] } as never);
    txns.list.mockResolvedValue({
      items: [
        { id: 'abcdefgh-1', type: 'send', amount: null, userEmail: null },
      ],
    } as never);

    const res = await service.search('  send ');

    expect(txns.list).toHaveBeenCalledWith({ q: 'send', limit: 5 });
    expect(res.results[0]).toEqual({
      kind: 'transaction',
      href: '/transactions/abcdefgh-1',
      label: 'send',
      sublabel: 'Transaction · abcdefgh',
    });
  });
});
