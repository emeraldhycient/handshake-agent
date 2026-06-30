import { ConfigService } from '@nestjs/config';
import { TransactionHistoryService } from './transaction-history.service';
import { AssetRegistry } from '../../../core/catalog/asset-registry';

const STATEMENT_CFG = {
  linkTtlSeconds: 900,
  maxWindowDays: 400,
  defaultPageSize: 2,
  maxPageSize: 100,
  statementMaxRows: 5000,
  timezoneOffsetMinutes: 60,
};

// Minimal real AssetRegistry over a tiny catalog (no Nest test bed needed).
function makeRegistry(): AssetRegistry {
  const catalog = {
    assets: {
      USDT: {
        symbol: 'USDT',
        displayName: 'USDT',
        kind: 'crypto',
        decimals: 6,
        networks: ['TRON'],
        providers: {},
        enabled: true,
      },
    },
    fiats: {
      NGN: {
        code: 'NGN',
        displayName: 'Naira',
        symbol: '₦',
        decimals: 2,
        enabled: true,
      },
    },
    networks: {
      TRON: {
        id: 'TRON',
        displayName: 'TRON',
        addressPattern: '^T.+$',
        enabled: true,
        networkFeeCrypto: {},
      },
    },
    capabilities: {},
    sendQuoteExpiresInSec: 30,
  };
  const config = {
    get: (k: string) => (k === 'catalog' ? catalog : undefined),
  } as unknown as ConfigService;
  return new AssetRegistry(config);
}

function makeService(
  rows: unknown[],
  total: number,
  extra?: {
    hasMore?: boolean;
    nextCursor?: string | null;
    cfg?: Partial<typeof STATEMENT_CFG>;
  },
) {
  const txRepo = {
    listByUserInRange: jest.fn().mockResolvedValue({
      rows,
      total,
      hasMore: extra?.hasMore ?? total > rows.length,
      nextCursor: extra?.nextCursor ?? null,
    }),
  };
  const settlementRepo = {
    findReceiptNumber: jest.fn().mockResolvedValue('HS-2026-000001'),
  };
  const statementCfg = { ...STATEMENT_CFG, ...extra?.cfg };
  const config = {
    get: (k: string) => (k === 'statement' ? statementCfg : undefined),
  } as unknown as ConfigService;
  const clock = { now: () => new Date('2026-06-29T10:00:00.000Z') };
  const token = {
    sign: jest.fn().mockReturnValue('tok'),
    buildDownloadUrl: jest
      .fn()
      .mockReturnValue(
        'https://api.example.com/transactions/statement/download?token=tok',
      ),
  };
  const svc = new TransactionHistoryService(
    txRepo as never,
    settlementRepo as never,
    makeRegistry(),
    clock,
    config,
    token as never,
  );
  return { svc, txRepo, settlementRepo, token };
}

const buyRow = {
  id: 't1',
  userId: 'u1',
  type: 'buy',
  status: 'completed',
  metadata: {
    asset: 'USDT',
    cryptoAmount: '29.97',
    fiatAmount: '50000',
    fiatCurrency: 'NGN',
  },
  createdAt: new Date('2026-06-10T10:00:00.000Z'),
};
const sendRow = {
  id: 't2',
  userId: 'u1',
  type: 'send',
  status: 'settling',
  metadata: { asset: 'USDT', cryptoAmount: '10' },
  createdAt: new Date('2026-06-12T09:00:00.000Z'),
};
const depositRow = {
  id: 't3',
  userId: 'u1',
  type: 'deposit',
  status: 'completed',
  // Deposits store the amount under `amount`, NOT `cryptoAmount`.
  metadata: { asset: 'USDT', amount: '50' },
  createdAt: new Date('2026-06-11T08:00:00.000Z'),
};

describe('TransactionHistoryService.query', () => {
  it('maps rows: direction, formatted amounts, receiptNumber for completed', async () => {
    const { svc, settlementRepo } = makeService([buyRow, sendRow], 2);
    const res = await svc.query('u1', { period: 'this_month' });
    expect(res.items[0]).toMatchObject({
      id: 't1',
      direction: 'in',
      cryptoAmount: '29.97 USDT',
      fiatAmount: '₦50,000.00',
      receiptNumber: 'HS-2026-000001',
    });
    expect(res.items[1]).toMatchObject({
      id: 't2',
      direction: 'out',
      cryptoAmount: '10 USDT',
    });
    expect(res.items[1].receiptNumber).toBeUndefined(); // settling → no receipt lookup
    expect(settlementRepo.findReceiptNumber).toHaveBeenCalledTimes(1);
    expect(res.totalCount).toBe(2);
    expect(res.truncated).toBe(false);
    expect(res.downloadUrl).toContain('token=tok');
  });

  it('maps a deposit amount from metadata.amount (deposits use `amount`, not `cryptoAmount`)', async () => {
    const { svc } = makeService([depositRow], 1);
    const res = await svc.query('u1', { period: 'this_month' });
    expect(res.items[0].type).toBe('deposit');
    expect(res.items[0].direction).toBe('in');
    // Before the fix this was undefined (mapper only read cryptoAmount).
    expect(res.items[0].cryptoAmount).toBeDefined();
    expect(res.items[0].cryptoAmount).toContain('50');
    expect(res.items[0].cryptoAmount).toContain('USDT');
  });

  it('falls back to raw amount for an unregistered/disabled asset (no throw)', async () => {
    const btcRow = {
      id: 't9',
      userId: 'u1',
      type: 'buy',
      status: 'completed',
      // BTC is NOT in the tiny test catalog (unregistered/disabled) — must not throw.
      metadata: {
        asset: 'BTC',
        cryptoAmount: '0.5',
        fiatAmount: '40000',
        fiatCurrency: 'XAF',
      },
      createdAt: new Date('2026-06-11T10:00:00.000Z'),
    };
    const { svc } = makeService([btcRow], 1);
    const res = await svc.query('u1', { period: 'all' });
    expect(res.items[0]).toMatchObject({
      id: 't9',
      cryptoAmount: '0.5 BTC', // raw fallback, not formatted
      fiatAmount: 'XAF 40000', // raw fallback for unregistered fiat
    });
  });

  it('sets truncated when total exceeds the returned page', async () => {
    const { svc } = makeService([buyRow, sendRow], 5); // page size 2, total 5
    const res = await svc.query('u1', { period: 'all' });
    expect(res.truncated).toBe(true);
    expect(res.totalCount).toBe(5);
  });

  it('maps txType=receive to the deposit engine type', async () => {
    const { svc, txRepo } = makeService([], 0);
    await svc.query('u1', { txType: 'receive' });
    expect(txRepo.listByUserInRange).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['deposit'] }),
    );
  });

  it('passes all money-moving types when txType is omitted', async () => {
    const { svc, txRepo } = makeService([], 0);
    await svc.query('u1', {});
    expect(txRepo.listByUserInRange).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['buy', 'sell', 'send', 'deposit'] }),
    );
  });

  it('requests the default page size and no cursor on the first page', async () => {
    const { svc, txRepo } = makeService([], 0);
    await svc.query('u1', {});
    expect(txRepo.listByUserInRange).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 2, cursor: undefined }),
    );
  });

  it('surfaces hasMore + nextCursor + txType from the page', async () => {
    const { svc } = makeService([buyRow], 3, {
      hasMore: true,
      nextCursor: 'NEXT',
    });
    const res = await svc.query('u1', { txType: 'send' });
    expect(res.hasMore).toBe(true);
    expect(res.nextCursor).toBe('NEXT');
    expect(res.txType).toBe('send');
  });

  it('clamps an over-large client limit to maxPageSize', async () => {
    const { svc, txRepo } = makeService([], 0);
    await svc.query('u1', { limit: 500 });
    expect(txRepo.listByUserInRange).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
    );
  });

  it('honours a client limit within bounds', async () => {
    const { svc, txRepo } = makeService([], 0);
    await svc.query('u1', { limit: 5 });
    expect(txRepo.listByUserInRange).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
    );
  });
});

describe('TransactionHistoryService.queryPage (frozen absolute window)', () => {
  const FROM = new Date('2026-06-01T00:00:00.000Z');
  const TO = new Date('2026-06-29T10:00:00.000Z');

  it('uses the given from/to verbatim (no resolveWindow) and forwards the cursor', async () => {
    const { svc, txRepo } = makeService([buyRow], 5, {
      hasMore: true,
      nextCursor: 'NEXT2',
    });
    const res = await svc.queryPage({
      userId: 'u1',
      from: FROM,
      to: TO,
      txType: 'all',
      cursor: 'PREV',
      limit: 2,
    });
    // Passed through unchanged — a relative window would have been re-resolved.
    expect(txRepo.listByUserInRange).toHaveBeenCalledWith(
      expect.objectContaining({
        from: FROM,
        to: TO,
        cursor: 'PREV',
        limit: 2,
      }),
    );
    expect(res.hasMore).toBe(true);
    expect(res.nextCursor).toBe('NEXT2');
    expect(res.items[0].id).toBe('t1');
  });
});

describe('TransactionHistoryService.queryAllInRange (full-range PDF)', () => {
  const FROM = new Date('2026-06-01T00:00:00.000Z');
  const TO = new Date('2026-06-29T10:00:00.000Z');

  function r(id: string) {
    return {
      id,
      userId: 'u1',
      type: 'buy',
      status: 'completed',
      metadata: {
        asset: 'USDT',
        cryptoAmount: '1',
        fiatAmount: '1',
        fiatCurrency: 'NGN',
      },
      createdAt: new Date('2026-06-10T10:00:00.000Z'),
    };
  }

  it('follows the cursor across pages and concatenates every row', async () => {
    const { svc, txRepo } = makeService([], 5);
    txRepo.listByUserInRange
      .mockReset()
      .mockResolvedValueOnce({
        rows: [r('a'), r('b')],
        total: 5,
        hasMore: true,
        nextCursor: 'c1',
      })
      .mockResolvedValueOnce({
        rows: [r('c'), r('d')],
        total: 5,
        hasMore: true,
        nextCursor: 'c2',
      })
      .mockResolvedValueOnce({
        rows: [r('e')],
        total: 5,
        hasMore: false,
        nextCursor: null,
      });

    const res = await svc.queryAllInRange({
      userId: 'u1',
      from: FROM,
      to: TO,
      txType: 'all',
    });

    expect(res.items).toHaveLength(5);
    expect(res.totalCount).toBe(5);
    expect(res.truncated).toBe(false);
    expect(txRepo.listByUserInRange).toHaveBeenCalledTimes(3);
    // Full pages requested (maxPageSize) and the cursor is threaded each call.
    const calls = txRepo.listByUserInRange.mock.calls as Array<
      [{ limit?: number; cursor?: string }]
    >;
    expect(calls[0][0]).toMatchObject({ limit: 100, cursor: undefined });
    expect(calls[1][0]).toMatchObject({ cursor: 'c1' });
    expect(calls[2][0]).toMatchObject({ cursor: 'c2' });
  });

  it('stops at statementMaxRows and marks the statement truncated', async () => {
    const { svc, txRepo } = makeService([], 5, {
      cfg: { statementMaxRows: 2 },
    });
    txRepo.listByUserInRange.mockReset().mockResolvedValueOnce({
      rows: [r('a'), r('b')],
      total: 5,
      hasMore: true,
      nextCursor: 'c1',
    });

    const res = await svc.queryAllInRange({
      userId: 'u1',
      from: FROM,
      to: TO,
      txType: 'all',
    });

    expect(res.items).toHaveLength(2);
    expect(res.totalCount).toBe(5);
    expect(res.truncated).toBe(true);
    expect(txRepo.listByUserInRange).toHaveBeenCalledTimes(1);
  });
});
