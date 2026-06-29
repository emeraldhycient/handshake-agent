/**
 * Unit tests for BalanceService — read-only portfolio snapshot.
 *
 * TDD: written BEFORE the implementation. All dependencies are fakes; the
 * service is instantiated directly (no Nest test bed required).
 *
 * Invariants exercised:
 *   - §3.1 read-only: never provisions a wallet, never moves money.
 *   - The ledger is the authoritative balance source (getAccountBalance).
 *   - Valuation uses the mid-market base rate; failures degrade gracefully.
 */

import { BalanceService } from './balance.service';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const USDT_WALLET = {
  id: 'wallet-usdt',
  userId: 'user-1',
  network: 'TRON',
  address: 'TXxxx',
  providerReference: 'ref-1',
  status: 'active',
};

function makeService(overrides?: {
  enabledAssets?: string[];
  balanceByAsset?: Record<string, string>;
  walletByNetwork?: Record<string, typeof USDT_WALLET | null>;
  rateByAsset?: Record<string, number>;
  rejectRate?: boolean;
}) {
  const enabledAssets = overrides?.enabledAssets ?? ['USDT'];
  const balanceByAsset = overrides?.balanceByAsset ?? { USDT: '10.5' };
  const walletByNetwork = overrides?.walletByNetwork ?? { TRON: USDT_WALLET };
  const rateByAsset = overrides?.rateByAsset ?? { USDT: 1600 };

  const walletRepo = {
    findByUserNetwork: jest.fn((_userId: string, network: string) =>
      Promise.resolve(
        walletByNetwork[network] === undefined
          ? null
          : walletByNetwork[network],
      ),
    ),
    findByAddress: jest.fn(),
    create: jest.fn(),
  };

  const ledgerRepo = {
    getAccountBalance: jest.fn(
      (_type: string, _accountId: string, currency: string) =>
        Promise.resolve(balanceByAsset[currency] ?? '0'),
    ),
  };

  const rateProvider = {
    getRate: jest.fn((asset: string) =>
      overrides?.rejectRate
        ? Promise.reject(new Error('no rate'))
        : Promise.resolve({
            baseRate: rateByAsset[asset],
            buySpreadBps: 100,
            sellSpreadBps: 100,
            processingFeeBps: 50,
            expiresInSec: 30,
            cryptoDecimals: 6,
          }),
    ),
  };

  const assetRegistry = {
    enabledCryptoAssets: jest.fn(() => enabledAssets),
    defaultNetworkFor: jest.fn((sym: string) =>
      sym === 'USDT' ? 'TRON' : sym,
    ),
    defaultFiat: jest.fn(() => 'NGN'),
    fiat: jest.fn(() => ({ decimals: 2 })),
  } as unknown as AssetRegistry;

  // Plain object fakes structurally satisfy the repository/provider ports.
  const service = new BalanceService(
    walletRepo,
    ledgerRepo,
    rateProvider,
    assetRegistry,
  );

  return { service, walletRepo, ledgerRepo, rateProvider, assetRegistry };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BalanceService', () => {
  it('returns every enabled asset with its ledger balance and mid-market value', async () => {
    const { service } = makeService();

    const snapshot = await service.getBalances('user-1');

    expect(snapshot.fiatCurrency).toBe('NGN');
    expect(snapshot.asset).toBeUndefined();
    expect(snapshot.balances).toEqual([
      {
        asset: 'USDT',
        network: 'TRON',
        amount: '10.5',
        fiatValue: '16800.00',
      },
    ]);
    expect(snapshot.totalFiatValue).toBe('16800.00');
  });

  it('scopes to a single asset and echoes it when asset is given', async () => {
    const { service, assetRegistry } = makeService();

    const snapshot = await service.getBalances('user-1', 'USDT');

    expect(snapshot.asset).toBe('USDT');
    expect(snapshot.balances).toHaveLength(1);
    expect(snapshot.balances[0].asset).toBe('USDT');
    // It enumerates the catalog, then filters — does not hardcode the asset.
    expect(assetRegistry.enabledCryptoAssets).toHaveBeenCalled();
  });

  it('returns an empty balances list when the requested asset is not enabled', async () => {
    const { service } = makeService();

    const snapshot = await service.getBalances('user-1', 'BTC');

    expect(snapshot.asset).toBe('BTC');
    expect(snapshot.balances).toEqual([]);
    expect(snapshot.totalFiatValue).toBeUndefined();
  });

  it('reports zero (never provisions) when the user has no wallet for the network', async () => {
    const { service, walletRepo } = makeService({ walletByNetwork: {} });

    const snapshot = await service.getBalances('user-1');

    expect(snapshot.balances[0].amount).toBe('0');
    expect(snapshot.balances[0].fiatValue).toBe('0.00');
    // Read-only: the wallet repo only has read methods; create is never called.
    expect(walletRepo.create).not.toHaveBeenCalled();
  });

  it('omits fiatValue (and total) when valuation fails', async () => {
    const { service } = makeService({ rejectRate: true });

    const snapshot = await service.getBalances('user-1');

    expect(snapshot.balances[0].fiatValue).toBeUndefined();
    expect(snapshot.totalFiatValue).toBeUndefined();
  });

  it('sums fiat values across multiple assets for the total', async () => {
    const { service } = makeService({
      enabledAssets: ['USDT', 'USDC'],
      balanceByAsset: { USDT: '10', USDC: '5' },
      walletByNetwork: {
        TRON: USDT_WALLET,
        USDC: { ...USDT_WALLET, id: 'wallet-usdc', network: 'USDC' },
      },
      rateByAsset: { USDT: 1600, USDC: 1600 },
    });

    const snapshot = await service.getBalances('user-1');

    expect(snapshot.balances).toHaveLength(2);
    // 10 * 1600 + 5 * 1600 = 24000
    expect(snapshot.totalFiatValue).toBe('24000.00');
  });

  it('reads the authoritative ledger balance for the user_wallet account', async () => {
    const { service, ledgerRepo } = makeService();

    await service.getBalances('user-1');

    expect(ledgerRepo.getAccountBalance).toHaveBeenCalledWith(
      'user_wallet',
      'wallet-usdt',
      'USDT',
    );
  });
});
