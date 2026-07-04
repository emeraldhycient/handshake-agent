import { AdminNotFoundError } from '../domain/admin-errors';
import { AdminTxnOversightService } from './admin-txn-oversight.service';
import type {
  ITransactionRepository,
  TransactionRecord,
} from '../../transactions/application/ports/transaction.repository.port';
import type {
  ILedgerRepository,
  LedgerEntryRecord,
} from '../../transactions/application/ports/ledger.repository.port';
import type {
  IAdminTxnReadRepository,
  AdminTxnReadRecord,
} from './ports/admin-txn-read.repository.port';

const TXN_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function makeTxn(over?: Partial<TransactionRecord>): TransactionRecord {
  const base: TransactionRecord = {
    id: TXN_ID,
    proposalId: null,
    userId: USER_ID,
    type: 'send',
    status: 'completed',
    idempotencyKey: 'idem-1',
    requestChecksum: 'chk',
    fxRateSnapshot: null,
    metadata: {},
    processorTxRef: null,
    onChainTxHash: null,
    failureReason: null,
    pinVerifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    executedAt: null,
    completedAt: null,
    failedAt: null,
  };
  return { ...base, ...over };
}

function makeReadRow(over?: Partial<AdminTxnReadRecord>): AdminTxnReadRecord {
  return {
    id: TXN_ID,
    userId: USER_ID,
    type: 'buy',
    status: 'completed',
    idempotencyKey: 'idem-1',
    processorTxRef: null,
    onChainTxHash: null,
    metadata: {
      asset: 'USDT',
      cryptoAmount: '10.5',
      fiatAmount: '16500.00',
      fiatCurrency: 'NGN',
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

function makeLeg(over?: Partial<LedgerEntryRecord>): LedgerEntryRecord {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    transactionId: TXN_ID,
    accountType: 'user_wallet',
    accountId: 'wallet-1',
    currency: 'USDT',
    amount: '-10',
    direction: 'debit',
    balanceAfter: '90',
    sequence: 4,
    postedAt: new Date('2026-01-01T00:01:00.000Z'),
    ...over,
  };
}

describe('AdminTxnOversightService', () => {
  let txnRepo: jest.Mocked<ITransactionRepository>;
  let ledgerRepo: jest.Mocked<ILedgerRepository>;
  let readRepo: jest.Mocked<IAdminTxnReadRepository>;
  let service: AdminTxnOversightService;

  beforeEach(() => {
    txnRepo = {
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      create: jest.fn(),
      createSettlingWithProposal: jest.fn(),
      updateStatus: jest.fn(),
      mergeMetadata: jest.fn(),
      listByUserInRange: jest.fn(),
      findByUserId: jest.fn(),
      listAll: jest.fn(),
      listByStatus: jest.fn(),
    };

    ledgerRepo = {
      getAccountBalance: jest.fn(),
      listLedgerEntries: jest.fn(),
      listByTransaction: jest.fn(),
      getAccountHistory: jest.fn(),
      verifyTransactionIntegrity: jest.fn(),
      listGlobal: jest.fn(),
      verifyGlobalSequenceIntegrity: jest.fn(),
    };

    readRepo = {
      list: jest.fn(),
      countViews: jest.fn(),
      emailsByUserIds: jest.fn(),
      emailByUserId: jest.fn(),
    };

    service = new AdminTxnOversightService(txnRepo, ledgerRepo, readRepo);
  });

  describe('list', () => {
    it('maps read rows to enriched items (amount/asset/fiat/email/idem) + counts + cursor', async () => {
      readRepo.list.mockResolvedValue({
        items: [makeReadRow()],
        nextCursor: 'cur-1',
      });
      readRepo.countViews.mockResolvedValue({
        all: 12,
        stuck: 2,
        failed: 1,
        refunds: 0,
      });
      readRepo.emailsByUserIds.mockResolvedValue(
        new Map([[USER_ID, 'amara@example.com']]),
      );

      const result = await service.list({ status: 'completed', limit: 20 });

      expect(readRepo.list).toHaveBeenCalledWith(
        {
          status: 'completed',
          type: undefined,
          userId: undefined,
          q: undefined,
        },
        { cursor: undefined, limit: 20 },
      );
      expect(result.items).toEqual([
        {
          id: TXN_ID,
          userId: USER_ID,
          userEmail: 'amara@example.com',
          type: 'buy',
          status: 'completed',
          asset: 'USDT',
          amount: '10.5',
          fiatAmount: '16500.00',
          fiatCurrency: 'NGN',
          idempotencyKey: 'idem-1',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
      expect(result.counts).toEqual({
        all: 12,
        stuck: 2,
        failed: 1,
        refunds: 0,
      });
      expect(result.nextCursor).toBe('cur-1');
    });

    it('passes the free-text q through to the read repo', async () => {
      readRepo.list.mockResolvedValue({ items: [], nextCursor: null });
      readRepo.countViews.mockResolvedValue({
        all: 0,
        stuck: 0,
        failed: 0,
        refunds: 0,
      });
      readRepo.emailsByUserIds.mockResolvedValue(new Map());

      await service.list({ q: '0xabc' });

      const [filter] = readRepo.list.mock.calls[0];
      expect(filter.q).toBe('0xabc');
    });

    it('parses from/to ISO strings into Dates and defaults the limit', async () => {
      readRepo.list.mockResolvedValue({ items: [], nextCursor: null });
      readRepo.countViews.mockResolvedValue({
        all: 0,
        stuck: 0,
        failed: 0,
        refunds: 0,
      });
      readRepo.emailsByUserIds.mockResolvedValue(new Map());

      await service.list({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      });

      const [filter, page] = readRepo.list.mock.calls[0];
      expect(filter.from).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(filter.to).toEqual(new Date('2026-02-01T00:00:00.000Z'));
      expect(page.limit).toBeGreaterThan(0);
    });

    it('surfaces a null email when the user has no email row', async () => {
      readRepo.list.mockResolvedValue({
        items: [makeReadRow()],
        nextCursor: null,
      });
      readRepo.countViews.mockResolvedValue({
        all: 1,
        stuck: 0,
        failed: 0,
        refunds: 0,
      });
      readRepo.emailsByUserIds.mockResolvedValue(new Map());

      const result = await service.list({});

      expect(result.items[0].userEmail).toBeNull();
    });

    it('leaves money fields null when metadata is empty', async () => {
      readRepo.list.mockResolvedValue({
        items: [makeReadRow({ metadata: {} })],
        nextCursor: null,
      });
      readRepo.countViews.mockResolvedValue({
        all: 1,
        stuck: 0,
        failed: 0,
        refunds: 0,
      });
      readRepo.emailsByUserIds.mockResolvedValue(new Map());

      const result = await service.list({});

      expect(result.items[0].asset).toBeNull();
      expect(result.items[0].amount).toBeNull();
      expect(result.items[0].fiatAmount).toBeNull();
    });
  });

  describe('getDetail', () => {
    it('throws AdminNotFoundError when the txn is missing', async () => {
      txnRepo.findById.mockResolvedValue(null);
      await expect(service.getDetail(TXN_ID)).rejects.toBeInstanceOf(
        AdminNotFoundError,
      );
    });

    it('aggregates the txn, its legs (with sequence), email, economics and provider refs', async () => {
      txnRepo.findById.mockResolvedValue(
        makeTxn({
          type: 'buy',
          processorTxRef: 'flw-ref',
          metadata: {
            asset: 'USDT',
            cryptoAmount: '10.5',
            fiatAmount: '16500.00',
            fiatCurrency: 'NGN',
            fxRate: '1571.43',
            baseRate: '1548.00',
            processingFeeAmount: '82.50',
            spreadBps: '150',
            providerRef: 'br_wd_123',
          },
        }),
      );
      ledgerRepo.listByTransaction.mockResolvedValue([makeLeg()]);
      readRepo.emailByUserId.mockResolvedValue('amara@example.com');

      const detail = await service.getDetail(TXN_ID);

      expect(detail.id).toBe(TXN_ID);
      expect(detail.userEmail).toBe('amara@example.com');
      expect(detail.processorTxRef).toBe('flw-ref');
      expect(detail.ledgerLegs).toEqual([
        {
          accountType: 'user_wallet',
          accountId: 'wallet-1',
          currency: 'USDT',
          amount: '-10',
          direction: 'debit',
          balanceAfter: '90',
          sequence: 4,
          postedAt: '2026-01-01T00:01:00.000Z',
        },
      ]);
      expect(detail.economics).toEqual({
        asset: 'USDT',
        amount: '10.5',
        fiatAmount: '16500.00',
        fiatCurrency: 'NGN',
        rate: '1571.43',
        processingFee: '82.50',
        fxSpreadBps: '150',
        // internalMargin = (fxRate - baseRate) × cryptoAmount = 23.43 × 10.5.
        internalMargin: '246.015',
        // Realized (buy): fee 82.5; mid = 10.5×1548 = 16254; spread = 16500 − 82.5
        // − 16254 = 163.5; profit = fee + spread = 246.
        realizedFee: '82.5',
        realizedSpread: '163.5',
        realizedProfit: '246',
      });
      // Provider refs: Flutterwave (processorTxRef) + Blockradar (metadata.providerRef).
      expect(detail.providerReferences).toEqual([
        { provider: 'flutterwave', reference: 'flw-ref' },
        { provider: 'blockradar', reference: 'br_wd_123' },
      ]);
    });

    it('projects a TRON provider ref from onChainTxHash', async () => {
      txnRepo.findById.mockResolvedValue(
        makeTxn({ type: 'send', onChainTxHash: '0xdeadbeef' }),
      );
      ledgerRepo.listByTransaction.mockResolvedValue([]);
      readRepo.emailByUserId.mockResolvedValue(null);

      const detail = await service.getDetail(TXN_ID);

      expect(detail.providerReferences).toEqual([
        { provider: 'tron', reference: '0xdeadbeef' },
      ]);
      expect(detail.userEmail).toBeNull();
    });

    it('leaves economics fields null when metadata omits them', async () => {
      txnRepo.findById.mockResolvedValue(makeTxn({ metadata: {} }));
      ledgerRepo.listByTransaction.mockResolvedValue([]);
      readRepo.emailByUserId.mockResolvedValue(null);

      const detail = await service.getDetail(TXN_ID);

      expect(detail.economics.asset).toBeNull();
      expect(detail.economics.internalMargin).toBeNull();
      expect(detail.providerReferences).toEqual([]);
    });

    it('derives a sorted timeline from only the non-null timestamps', async () => {
      txnRepo.findById.mockResolvedValue(
        makeTxn({
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          executedAt: new Date('2026-01-01T00:01:00.000Z'),
          completedAt: new Date('2026-01-01T00:02:00.000Z'),
          failedAt: null,
        }),
      );
      ledgerRepo.listByTransaction.mockResolvedValue([]);
      readRepo.emailByUserId.mockResolvedValue(null);

      const detail = await service.getDetail(TXN_ID);

      expect(detail.timeline).toEqual([
        { status: 'created', at: '2026-01-01T00:00:00.000Z' },
        { status: 'settling', at: '2026-01-01T00:01:00.000Z' },
        { status: 'completed', at: '2026-01-01T00:02:00.000Z' },
      ]);
    });

    it('includes a failed timeline entry when failedAt is set', async () => {
      txnRepo.findById.mockResolvedValue(
        makeTxn({
          status: 'failed',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          failedAt: new Date('2026-01-01T00:05:00.000Z'),
          failureReason: 'insufficient funds',
        }),
      );
      ledgerRepo.listByTransaction.mockResolvedValue([]);
      readRepo.emailByUserId.mockResolvedValue(null);

      const detail = await service.getDetail(TXN_ID);

      expect(detail.failureReason).toBe('insufficient funds');
      expect(detail.timeline).toEqual([
        { status: 'created', at: '2026-01-01T00:00:00.000Z' },
        { status: 'failed', at: '2026-01-01T00:05:00.000Z' },
      ]);
    });
  });
});
