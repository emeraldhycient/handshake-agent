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
});
