import { AdminLedgerService } from './admin-ledger.service';
import type {
  ILedgerRepository,
  LedgerEntryRecord,
  LedgerIntegrityResult,
} from '../../transactions/application/ports/ledger.repository.port';

function makeEntry(over?: Partial<LedgerEntryRecord>): LedgerEntryRecord {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    transactionId: 'txn-1',
    accountType: 'user_wallet',
    accountId: 'wallet-1',
    currency: 'USDT',
    amount: '10',
    direction: 'credit',
    balanceAfter: '100',
    sequence: 1,
    postedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

describe('AdminLedgerService', () => {
  let ledgerRepo: jest.Mocked<ILedgerRepository>;
  let service: AdminLedgerService;

  beforeEach(() => {
    ledgerRepo = {
      getAccountBalance: jest.fn(),
      listLedgerEntries: jest.fn(),
      listByTransaction: jest.fn(),
      getAccountHistory: jest.fn(),
      verifyTransactionIntegrity: jest.fn(),
      listGlobal: jest.fn(),
      verifyGlobalSequenceIntegrity: jest.fn(),
    };

    service = new AdminLedgerService(ledgerRepo);
  });

  describe('getAccountHistory', () => {
    it('maps repository entries to the ledger-entry DTO shape', async () => {
      ledgerRepo.getAccountHistory.mockResolvedValue([makeEntry()]);

      const entries = await service.getAccountHistory(
        'user_wallet',
        'wallet-1',
        'USDT',
        50,
      );

      expect(ledgerRepo.getAccountHistory).toHaveBeenCalledWith(
        'user_wallet',
        'wallet-1',
        'USDT',
        50,
      );
      expect(entries).toEqual([
        {
          id: '11111111-1111-1111-1111-111111111111',
          transactionId: 'txn-1',
          accountType: 'user_wallet',
          accountId: 'wallet-1',
          currency: 'USDT',
          amount: '10',
          direction: 'credit',
          balanceAfter: '100',
          sequence: 1,
          postedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
    });

    it('applies a default limit when none is supplied', async () => {
      ledgerRepo.getAccountHistory.mockResolvedValue([]);
      await service.getAccountHistory('user_wallet', 'wallet-1', 'USDT');
      const limitArg = ledgerRepo.getAccountHistory.mock.calls[0][3];
      expect(limitArg).toBeGreaterThan(0);
    });
  });

  describe('verifyTransactionIntegrity', () => {
    it('returns the repository result with the transactionId echoed', async () => {
      const repoResult: LedgerIntegrityResult = {
        balanced: false,
        legCount: 3,
        brokenAt: 'NGN',
      };
      ledgerRepo.verifyTransactionIntegrity.mockResolvedValue(repoResult);

      const result = await service.verifyTransactionIntegrity('txn-9');

      expect(ledgerRepo.verifyTransactionIntegrity).toHaveBeenCalledWith(
        'txn-9',
      );
      expect(result).toEqual({
        transactionId: 'txn-9',
        balanced: false,
        legCount: 3,
        brokenAt: 'NGN',
      });
    });

    it('echoes a balanced result', async () => {
      ledgerRepo.verifyTransactionIntegrity.mockResolvedValue({
        balanced: true,
        legCount: 2,
        brokenAt: null,
      });

      const result = await service.verifyTransactionIntegrity('txn-ok');
      expect(result).toEqual({
        transactionId: 'txn-ok',
        balanced: true,
        legCount: 2,
        brokenAt: null,
      });
    });
  });

  describe('listGlobal', () => {
    it('maps a global keyset page onto the response shape', async () => {
      ledgerRepo.listGlobal.mockResolvedValue({
        items: [
          makeEntry(),
          makeEntry({ id: '22222222-2222-2222-2222-222222222222' }),
        ],
        nextCursor: '22222222-2222-2222-2222-222222222222',
      });

      const res = await service.listGlobal({
        accountType: 'treasury_reserve',
        currency: 'USDT',
        cursor: 'abc',
        limit: 25,
      });

      expect(ledgerRepo.listGlobal).toHaveBeenCalledWith(
        { accountType: 'treasury_reserve', currency: 'USDT' },
        { cursor: 'abc', limit: 25 },
      );
      expect(res.entries).toHaveLength(2);
      expect(res.entries[0].postedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(res.nextCursor).toBe('22222222-2222-2222-2222-222222222222');
    });

    it('applies a default limit and passes undefined filters through', async () => {
      ledgerRepo.listGlobal.mockResolvedValue({ items: [], nextCursor: null });

      await service.listGlobal({});

      const [filterArg, pageArg] = ledgerRepo.listGlobal.mock.calls[0];
      expect(filterArg).toEqual({
        accountType: undefined,
        currency: undefined,
      });
      expect(pageArg.cursor).toBeUndefined();
      expect(pageArg.limit).toBeGreaterThan(0);
    });

    it('passes a null nextCursor through on the last page', async () => {
      ledgerRepo.listGlobal.mockResolvedValue({
        items: [makeEntry()],
        nextCursor: null,
      });
      const res = await service.listGlobal({ limit: 10 });
      expect(res.nextCursor).toBeNull();
    });
  });

  describe('exportRows', () => {
    it('drains every keyset page with NO caller cursor and returns all matching legs', async () => {
      ledgerRepo.listGlobal
        .mockResolvedValueOnce({
          items: [makeEntry({ id: 'a' })],
          nextCursor: 'a',
        })
        .mockResolvedValueOnce({
          items: [makeEntry({ id: 'b' })],
          nextCursor: null,
        });

      const rows = await service.exportRows({
        accountType: 'user_wallet',
        currency: 'USDT',
      });

      // Same filters forwarded on the first page; that call carries no cursor.
      const [filters0, page0] = ledgerRepo.listGlobal.mock.calls[0];
      expect(filters0).toEqual({
        accountType: 'user_wallet',
        currency: 'USDT',
      });
      expect(page0.cursor).toBeUndefined();
      // The second page is driven by the first page's nextCursor.
      expect(ledgerRepo.listGlobal.mock.calls[1][1].cursor).toBe('a');
      // Both pages' legs are returned, projected to the entry shape.
      expect(rows).toHaveLength(2);
      expect(rows[0].id).toBe('a');
      expect(rows[1].id).toBe('b');
      expect(rows[0].postedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('passes undefined filters through and returns [] for an empty ledger', async () => {
      ledgerRepo.listGlobal.mockResolvedValue({ items: [], nextCursor: null });

      const rows = await service.exportRows({});

      const [filters0] = ledgerRepo.listGlobal.mock.calls[0];
      expect(filters0).toEqual({ accountType: undefined, currency: undefined });
      expect(rows).toEqual([]);
    });
  });

  describe('verifyGlobalSequenceIntegrity', () => {
    it('surfaces an all-clear summary', async () => {
      ledgerRepo.verifyGlobalSequenceIntegrity.mockResolvedValue({
        ok: true,
        accountsChecked: 7,
        brokenAccount: null,
      });

      const res = await service.verifyGlobalSequenceIntegrity();
      expect(res).toEqual({
        ok: true,
        accountsChecked: 7,
        brokenAccount: null,
      });
    });

    it('surfaces a broken summary naming the offending sub-ledger', async () => {
      ledgerRepo.verifyGlobalSequenceIntegrity.mockResolvedValue({
        ok: false,
        accountsChecked: 7,
        brokenAccount: 'user_wallet:wallet-1:NGN',
      });

      const res = await service.verifyGlobalSequenceIntegrity();
      expect(res).toEqual({
        ok: false,
        accountsChecked: 7,
        brokenAccount: 'user_wallet:wallet-1:NGN',
      });
    });
  });
});
