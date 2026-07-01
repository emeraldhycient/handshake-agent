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
    sequence: 1,
    postedAt: new Date('2026-01-01T00:01:00.000Z'),
    ...over,
  };
}

describe('AdminTxnOversightService', () => {
  let txnRepo: jest.Mocked<ITransactionRepository>;
  let ledgerRepo: jest.Mocked<ILedgerRepository>;
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
    };

    service = new AdminTxnOversightService(txnRepo, ledgerRepo);
  });

  describe('list', () => {
    it('maps listAll rows to list items + cursor', async () => {
      txnRepo.listAll.mockResolvedValue({
        items: [makeTxn()],
        nextCursor: 'cur-1',
      });

      const result = await service.list({ status: 'completed', limit: 20 });

      expect(txnRepo.listAll).toHaveBeenCalledWith(
        { status: 'completed', type: undefined, userId: undefined },
        { cursor: undefined, limit: 20 },
      );
      expect(result.items).toEqual([
        {
          id: TXN_ID,
          userId: USER_ID,
          type: 'send',
          status: 'completed',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
      expect(result.nextCursor).toBe('cur-1');
    });

    it('parses from/to ISO strings into Dates and defaults the limit', async () => {
      txnRepo.listAll.mockResolvedValue({ items: [], nextCursor: null });

      await service.list({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      });

      const [filter, page] = txnRepo.listAll.mock.calls[0];
      expect(filter.from).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(filter.to).toEqual(new Date('2026-02-01T00:00:00.000Z'));
      expect(page.limit).toBeGreaterThan(0);
    });
  });

  describe('getDetail', () => {
    it('throws AdminNotFoundError when the txn is missing', async () => {
      txnRepo.findById.mockResolvedValue(null);
      await expect(service.getDetail(TXN_ID)).rejects.toBeInstanceOf(
        AdminNotFoundError,
      );
    });

    it('aggregates the txn, its legs, and a derived timeline', async () => {
      txnRepo.findById.mockResolvedValue(
        makeTxn({
          processorTxRef: 'flw-ref',
        }),
      );
      ledgerRepo.listByTransaction.mockResolvedValue([makeLeg()]);

      const detail = await service.getDetail(TXN_ID);

      expect(detail.id).toBe(TXN_ID);
      expect(detail.userId).toBe(USER_ID);
      expect(detail.processorTxRef).toBe('flw-ref');
      expect(detail.onChainTxHash).toBeNull();
      expect(detail.ledgerLegs).toEqual([
        {
          accountType: 'user_wallet',
          accountId: 'wallet-1',
          currency: 'USDT',
          amount: '-10',
          direction: 'debit',
          balanceAfter: '90',
          postedAt: '2026-01-01T00:01:00.000Z',
        },
      ]);
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

      const detail = await service.getDetail(TXN_ID);

      expect(detail.failureReason).toBe('insufficient funds');
      expect(detail.timeline).toEqual([
        { status: 'created', at: '2026-01-01T00:00:00.000Z' },
        { status: 'failed', at: '2026-01-01T00:05:00.000Z' },
      ]);
    });
  });
});
