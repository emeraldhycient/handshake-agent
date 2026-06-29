import { buildStatementModel } from './statement-model';
import type { TransactionHistoryItem } from '@handshake-agent/contracts';

const items: TransactionHistoryItem[] = [
  {
    id: 't1',
    type: 'buy',
    status: 'completed',
    direction: 'in',
    asset: 'USDT',
    cryptoAmount: '29.97 USDT',
    fiatAmount: '₦50,000.00',
    fiatCurrency: 'NGN',
    createdAt: '2026-06-10T10:00:00.000Z',
    receiptNumber: 'HS-2026-000001',
  },
  {
    id: 't2',
    type: 'send',
    status: 'settling',
    direction: 'out',
    asset: 'USDT',
    cryptoAmount: '10 USDT',
    createdAt: '2026-06-12T09:00:00.000Z',
  },
];

describe('buildStatementModel', () => {
  it('maps items to rows with signed amounts and a header', () => {
    const model = buildStatementModel({
      items,
      totalCount: 2,
      truncated: false,
      windowLabel: 'This month',
      accountLabel: 'u***@test.com',
      generatedAt: '2026-06-29T10:00:00.000Z',
      filename: 'handshake-statement.pdf',
    });
    expect(model.title).toBe('Transaction Statement');
    expect(model.rows).toHaveLength(2);
    expect(model.rows[0]).toMatchObject({
      type: 'buy',
      status: 'completed',
      amount: '+29.97 USDT',
      reference: 'HS-2026-000001',
    });
    expect(model.rows[1]).toMatchObject({
      type: 'send',
      amount: '-10 USDT',
      reference: 't2',
    });
    expect(model.truncated).toBe(false);
    expect(model.totalCount).toBe(2);
  });

  it('uses fiat amount when crypto is absent', () => {
    const sell: TransactionHistoryItem = {
      id: 't3',
      type: 'sell',
      status: 'completed',
      direction: 'out',
      fiatAmount: '₦40,000.00',
      fiatCurrency: 'NGN',
      createdAt: '2026-06-13T09:00:00.000Z',
    };
    const model = buildStatementModel({
      items: [sell],
      totalCount: 1,
      truncated: false,
      windowLabel: 'X',
      accountLabel: 'a',
      generatedAt: '2026-06-29T10:00:00.000Z',
      filename: 'f.pdf',
    });
    expect(model.rows[0].amount).toBe('-₦40,000.00');
  });
});
