import { ConfigService } from '@nestjs/config';
import { TransactionHistoryService } from './transaction-history.service';
import { AssetRegistry } from '../../../core/catalog/asset-registry';

const STATEMENT_CFG = {
  linkTtlSeconds: 900,
  maxWindowDays: 365,
  rowCap: 2,
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

function makeService(rows: unknown[], total: number) {
  const txRepo = {
    listByUserInRange: jest.fn().mockResolvedValue({ rows, total }),
  };
  const settlementRepo = {
    findReceiptNumber: jest.fn().mockResolvedValue('HS-2026-000001'),
  };
  const config = {
    get: (k: string) => (k === 'statement' ? STATEMENT_CFG : undefined),
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
    const { svc } = makeService([buyRow, sendRow], 5); // rowCap=2, total=5
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
});
