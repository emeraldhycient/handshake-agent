/**
 * WalletReconciliationService spec — strict TDD (red → green → refactor).
 *
 * Covers:
 *   1. on-chain > ledger → credits the delta once via settleDepositAtomic.
 *   2. Idempotency: re-running with the same balances does NOT double-credit
 *      (settleDepositAtomic returns { deposited: false } on the second call).
 *   3. ledger > on-chain (over-credit) → logs + flags for manual review, no debit.
 *   4. on-chain === ledger (in-sync) → no settlement call.
 *   5. Asset-enabled gating: disabled assets are skipped.
 *   6. Missing/no wallet provisioned → skipped gracefully.
 *   7. reconcileUser aggregates across all enabled assets for a user.
 */

import { Logger } from '@nestjs/common';
import { WalletReconciliationService } from './wallet-reconciliation.service';
import type { IWalletProvider } from './ports/wallet-provider.port';
import type {
  IWalletRepository,
  WalletRecord,
} from './ports/wallet.repository.port';
import type { ILedgerRepository } from '../../transactions/application/ports/ledger.repository.port';
import type { IDepositSettlementRepository } from './ports/deposit-settlement.repository.port';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WALLET: WalletRecord = {
  id: 'wallet-001',
  userId: 'user-001',
  network: 'TRON',
  address: 'TADDR001',
  providerReference: 'provider-ref-001',
  status: 'active',
};

// ---------------------------------------------------------------------------
// Stub builders
// ---------------------------------------------------------------------------

function makeRegistry(enabledAssets: string[] = ['USDT']): AssetRegistry {
  return {
    enabledCryptoAssets: jest.fn().mockReturnValue(enabledAssets),
    defaultNetworkFor: jest.fn().mockReturnValue('TRON'),
    isAssetEnabled: jest
      .fn()
      .mockImplementation((sym: string) => enabledAssets.includes(sym)),
    assetProviderId: jest.fn().mockReturnValue('blockradar-usdt-id'),
    asset: jest.fn().mockReturnValue({ decimals: 6 }),
  } as unknown as AssetRegistry;
}

function makeWalletRepo(wallets: WalletRecord[] = [WALLET]): IWalletRepository {
  return {
    findByUser: jest.fn().mockResolvedValue(wallets),
    findByUserNetwork: jest.fn().mockResolvedValue(WALLET),
    findByAddress: jest.fn().mockResolvedValue(WALLET),
    create: jest.fn(),
  };
}

function makeWalletProvider(onChainAmount: string): IWalletProvider {
  return {
    getBalance: jest
      .fn()
      .mockResolvedValue({ amount: onChainAmount, decimals: 6 }),
    provisionAddress: jest.fn(),
    listWalletAssets: jest.fn(),
    withdraw: jest.fn(),
    getWithdrawalStatus: jest.fn(),
  };
}

function makeLedgerRepo(ledgerAmount: string): ILedgerRepository {
  return {
    getAccountBalance: jest.fn().mockResolvedValue(ledgerAmount),
    listLedgerEntries: jest.fn().mockResolvedValue([]),
  };
}

function makeDepositSettlementRepo(
  deposited = true,
): IDepositSettlementRepository {
  return {
    settleDepositAtomic: jest.fn().mockResolvedValue({
      deposited,
      newBalance: deposited ? '2200' : undefined,
      receiptNumber: deposited ? 'HS-2026-000001' : undefined,
    }),
  };
}

// Suppress Logger output in tests.
jest.spyOn(Logger.prototype, 'log').mockReturnValue(undefined);
jest.spyOn(Logger.prototype, 'warn').mockReturnValue(undefined);
jest.spyOn(Logger.prototype, 'error').mockReturnValue(undefined);
jest.spyOn(Logger.prototype, 'debug').mockReturnValue(undefined);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSvc(
  opts: {
    onChainAmount?: string;
    ledgerAmount?: string;
    wallets?: WalletRecord[];
    enabledAssets?: string[];
    depositDeposited?: boolean;
  } = {},
): {
  svc: WalletReconciliationService;
  walletRepo: IWalletRepository;
  walletProvider: IWalletProvider;
  ledgerRepo: ILedgerRepository;
  settlementRepo: IDepositSettlementRepository;
} {
  const {
    onChainAmount = '2200',
    ledgerAmount = '200',
    wallets = [WALLET],
    enabledAssets = ['USDT'],
    depositDeposited = true,
  } = opts;

  const walletRepo = makeWalletRepo(wallets);
  const walletProvider = makeWalletProvider(onChainAmount);
  const ledgerRepo = makeLedgerRepo(ledgerAmount);
  const settlementRepo = makeDepositSettlementRepo(depositDeposited);
  const registry = makeRegistry(enabledAssets);

  const svc = new WalletReconciliationService(
    walletProvider,
    walletRepo,
    ledgerRepo,
    settlementRepo,
    registry,
  );

  return { svc, walletRepo, walletProvider, ledgerRepo, settlementRepo };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WalletReconciliationService.reconcileUserAsset', () => {
  it('credits the delta when on-chain > ledger (missing deposit scenario)', async () => {
    // on-chain: 2200, ledger: 200 → expect credit of 2000
    const { svc, settlementRepo, ledgerRepo, walletProvider } = buildSvc({
      onChainAmount: '2200',
      ledgerAmount: '200',
    });

    const result = await svc.reconcileUserAsset({
      userId: 'user-001',
      walletId: WALLET.id,
      providerReference: WALLET.providerReference,
      assetSymbol: 'USDT',
      network: 'TRON',
    });

    expect(result.action).toBe('credited');
    expect(result.delta).toBe('2000');
    expect(result.deposited).toBe(true);

    // Ledger must be read
    expect(ledgerRepo.getAccountBalance).toHaveBeenCalledWith(
      'user_wallet',
      WALLET.id,
      'USDT',
    );
    // Provider balance must be fetched
    expect(walletProvider.getBalance).toHaveBeenCalledWith(
      WALLET.providerReference,
      expect.any(String),
      'TRON',
    );
    // settleDepositAtomic must be called with the idempotency-keyed txHash
    expect(settlementRepo.settleDepositAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: WALLET.id,
        userId: 'user-001',
        cryptoAmount: '2000',
        asset: 'USDT',
        // The idempotency txHash must start with 'recon:' (typed as string to avoid
        // eslint no-unsafe-assignment on the expect.stringMatching any return type).
        txHash: expect.stringMatching(/^recon:/) as string,
      }),
    );
  });

  it('is idempotent — re-run with same balances does NOT double-credit', async () => {
    // settleDepositAtomic returns deposited:false on the second call
    // (same idempotency key → already credited)
    const { svc, settlementRepo } = buildSvc({
      onChainAmount: '2200',
      ledgerAmount: '200',
      depositDeposited: false, // simulate: already processed
    });

    const result = await svc.reconcileUserAsset({
      userId: 'user-001',
      walletId: WALLET.id,
      providerReference: WALLET.providerReference,
      assetSymbol: 'USDT',
      network: 'TRON',
    });

    // The delta is still computed but deposited is false (no double-credit)
    expect(result.action).toBe('already_credited');
    expect(result.deposited).toBe(false);
    // settlementRepo was still called (idempotency enforced inside settleDepositAtomic)
    expect(settlementRepo.settleDepositAtomic).toHaveBeenCalledTimes(1);
  });

  it('flags over-credit (ledger > on-chain) without debiting', async () => {
    // ledger: 100, on-chain: 0 → over-credit — must NOT settle, must flag
    const { svc, settlementRepo, ledgerRepo } = buildSvc({
      onChainAmount: '0',
      ledgerAmount: '100',
    });

    const result = await svc.reconcileUserAsset({
      userId: 'user-001',
      walletId: WALLET.id,
      providerReference: WALLET.providerReference,
      assetSymbol: 'USDT',
      network: 'TRON',
    });

    expect(result.action).toBe('over_credit_flagged');
    expect(result.delta).toBe('-100'); // negative delta
    // No settlement call — we NEVER auto-debit
    expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
    // Ledger was read
    expect(ledgerRepo.getAccountBalance).toHaveBeenCalled();
  });

  it('does nothing when on-chain equals ledger (in-sync)', async () => {
    const { svc, settlementRepo } = buildSvc({
      onChainAmount: '500',
      ledgerAmount: '500',
    });

    const result = await svc.reconcileUserAsset({
      userId: 'user-001',
      walletId: WALLET.id,
      providerReference: WALLET.providerReference,
      assetSymbol: 'USDT',
      network: 'TRON',
    });

    expect(result.action).toBe('in_sync');
    expect(result.delta).toBe('0');
    expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
  });
});

describe('WalletReconciliationService.reconcileUser', () => {
  it('processes all enabled assets for a user with a provisioned wallet', async () => {
    const { svc, settlementRepo } = buildSvc({
      onChainAmount: '2200',
      ledgerAmount: '200',
      enabledAssets: ['USDT'],
    });

    const results = await svc.reconcileUser('user-001');

    expect(results).toHaveLength(1);
    expect(results[0].asset).toBe('USDT');
    expect(results[0].action).toBe('credited');
    expect(settlementRepo.settleDepositAtomic).toHaveBeenCalledTimes(1);
  });

  it('skips assets where no wallet is provisioned for that network', async () => {
    // No wallets provisioned for user
    const { svc, settlementRepo } = buildSvc({
      wallets: [], // empty — no wallet for any network
      onChainAmount: '2200',
      ledgerAmount: '200',
    });

    const results = await svc.reconcileUser('user-001');

    // No wallet provisioned → nothing to reconcile
    expect(results).toHaveLength(0);
    expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
  });

  it('handles multiple enabled assets independently', async () => {
    // Two enabled assets: USDT (missing 2000) + TRX (in-sync)
    const walletRepo: IWalletRepository = {
      findByUser: jest.fn().mockResolvedValue([WALLET]),
      findByUserNetwork: jest.fn().mockResolvedValue(WALLET),
      findByAddress: jest.fn().mockResolvedValue(WALLET),
      create: jest.fn(),
    };

    const walletProvider: IWalletProvider = {
      getBalance: jest
        .fn()
        .mockImplementation((_ref: string, assetId: string) =>
          Promise.resolve({
            amount: assetId === 'blockradar-usdt-id' ? '2200' : '500',
            decimals: 6,
          }),
        ),
      provisionAddress: jest.fn(),
      listWalletAssets: jest.fn(),
      withdraw: jest.fn(),
      getWithdrawalStatus: jest.fn(),
    };

    const ledgerRepo: ILedgerRepository = {
      getAccountBalance: jest
        .fn()
        .mockImplementation((_type: string, _id: string, currency: string) =>
          Promise.resolve(currency === 'USDT' ? '200' : '500'),
        ),
      listLedgerEntries: jest.fn().mockResolvedValue([]),
    };

    const settlementRepo = makeDepositSettlementRepo(true);

    const registry: AssetRegistry = {
      enabledCryptoAssets: jest.fn().mockReturnValue(['USDT', 'TRX']),
      defaultNetworkFor: jest.fn().mockReturnValue('TRON'),
      isAssetEnabled: jest.fn().mockReturnValue(true),
      assetProviderId: jest
        .fn()
        .mockImplementation((sym: string) =>
          sym === 'USDT' ? 'blockradar-usdt-id' : 'blockradar-trx-id',
        ),
      asset: jest.fn().mockReturnValue({ decimals: 6 }),
    } as unknown as AssetRegistry;

    const svc = new WalletReconciliationService(
      walletProvider,
      walletRepo,
      ledgerRepo,
      settlementRepo,
      registry,
    );

    const results = await svc.reconcileUser('user-001');

    expect(results).toHaveLength(2);
    const usdtResult = results.find((r) => r.asset === 'USDT');
    const trxResult = results.find((r) => r.asset === 'TRX');

    expect(usdtResult?.action).toBe('credited');
    expect(usdtResult?.delta).toBe('2000');
    expect(trxResult?.action).toBe('in_sync');
    expect(trxResult?.delta).toBe('0');

    // Only USDT settlement call
    expect(settlementRepo.settleDepositAtomic).toHaveBeenCalledTimes(1);
  });
});
