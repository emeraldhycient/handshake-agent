/**
 * Unit tests for BalanceService — read-only portfolio snapshot.
 *
 * TDD: written BEFORE the implementation. All dependencies are fakes; the
 * service is instantiated directly (no Nest test bed required).
 *
 * Invariants exercised:
 *   - §3.1 read-only: never provisions a wallet, never moves money.
 *   - The ledger is the authoritative balance source (getAccountBalance).
 *   - Valuation uses the realizable SELL rate (baseRate × (1 − sellSpreadBps/10000)),
 *     matching the web wallet endpoint (D2). Failures degrade gracefully.
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
  /** Override the network returned for a given asset symbol (default: 'TRON' for USDT, sym for others). */
  networkForAsset?: Record<string, string>;
}) {
  const enabledAssets = overrides?.enabledAssets ?? ['USDT'];
  const balanceByAsset = overrides?.balanceByAsset ?? { USDT: '10.5' };
  const walletByNetwork = overrides?.walletByNetwork ?? { TRON: USDT_WALLET };
  const rateByAsset = overrides?.rateByAsset ?? { USDT: 1600 };
  const networkForAsset = overrides?.networkForAsset ?? {};

  const walletRepo = {
    findByUserNetwork: jest.fn((_userId: string, network: string) =>
      Promise.resolve(
        walletByNetwork[network] === undefined
          ? null
          : walletByNetwork[network],
      ),
    ),
    findByUser: jest.fn().mockResolvedValue(Object.values(walletByNetwork)),
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
    getValuationRate: jest.fn((asset: string) =>
      overrides?.rejectRate
        ? Promise.reject(new Error('no valuation rate'))
        : Promise.resolve({ baseRate: rateByAsset[asset] }),
    ),
  };

  const assetRegistry = {
    enabledCryptoAssets: jest.fn(() => enabledAssets),
    defaultNetworkFor: jest.fn((sym: string) => {
      if (networkForAsset[sym]) return networkForAsset[sym];
      return sym === 'USDT' ? 'TRON' : sym;
    }),
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
  it('returns every enabled asset with its ledger balance valued at the sell rate', async () => {
    const { service } = makeService();

    const snapshot = await service.getBalances('user-1');

    // sellSpreadBps=100 → effectiveRate = 1600 × (1 − 100/10000) = 1584
    // 10.5 × 1584 = 16632.00 (floored to 2 d.p.)
    expect(snapshot.fiatCurrency).toBe('NGN');
    expect(snapshot.asset).toBeUndefined();
    expect(snapshot.balances).toEqual([
      {
        asset: 'USDT',
        network: 'TRON',
        amount: '10.5',
        fiatValue: '16632.00',
      },
    ]);
    expect(snapshot.totalFiatValue).toBe('16632.00');
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

    // 0 × effectiveRate = 0.00 regardless of spread
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
    // sellSpreadBps=100 → effectiveRate = 1584 for both assets
    // 10 × 1584 + 5 × 1584 = 15840 + 7920 = 23760
    expect(snapshot.totalFiatValue).toBe('23760.00');
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

  // ── Multi-asset (discovered): USDT + TRX ─────────────────────────────────

  it('lists both USDT and TRX when the registry returns them as enabled (2-asset discovered wallet)', async () => {
    // Simulates a TRON wallet with USDT (stablecoin) and TRX (native) discovered
    // by CatalogSyncService — both appear in enabledCryptoAssets().
    const { service } = makeService({
      enabledAssets: ['USDT', 'TRX'],
      balanceByAsset: { USDT: '10.5', TRX: '200' },
      // Both assets live on TRON — one wallet per network (WN-1 model).
      // networkForAsset maps TRX → 'TRON' so the wallet lookup hits the right key.
      networkForAsset: { TRX: 'TRON' },
      walletByNetwork: { TRON: USDT_WALLET },
      rateByAsset: { USDT: 1600, TRX: 240 },
    });

    const snapshot = await service.getBalances('user-1');

    expect(snapshot.balances).toHaveLength(2);

    const usdtLine = snapshot.balances.find((b) => b.asset === 'USDT');
    const trxLine = snapshot.balances.find((b) => b.asset === 'TRX');

    expect(usdtLine).toBeDefined();
    expect(usdtLine?.amount).toBe('10.5');
    // sellSpreadBps=100 → effectiveRate = 1600 × (1 − 0.01) = 1584; 10.5 × 1584 = 16632.00
    expect(usdtLine?.fiatValue).toBe('16632.00');

    expect(trxLine).toBeDefined();
    expect(trxLine?.amount).toBe('200');
    // effectiveRate = 240 × 0.99 = 237.6; 200 × 237.6 = 47520.00
    expect(trxLine?.fiatValue).toBe('47520.00');

    // Total: 16632 + 47520 = 64152
    expect(snapshot.totalFiatValue).toBe('64152.00');
  });

  it('omits fiatValue for an unpriced discovered asset without crashing the snapshot', async () => {
    // TRX has no configured rate → valuate() returns undefined for TRX.
    // USDT is priced normally. The snapshot must return both lines, with TRX
    // having no fiatValue and totalFiatValue reflecting only the priced asset.
    const { service } = makeService({
      enabledAssets: ['USDT', 'TRX'],
      balanceByAsset: { USDT: '10.5', TRX: '200' },
      networkForAsset: { TRX: 'TRON' },
      walletByNetwork: { TRON: USDT_WALLET },
      // TRX has no rate entry — rateProvider will resolve baseRate as undefined,
      // which isFinite() rejects, causing valuate() to return undefined.
      rateByAsset: { USDT: 1600 }, // TRX intentionally absent
    });

    const snapshot = await service.getBalances('user-1');

    const usdtLine = snapshot.balances.find((b) => b.asset === 'USDT');
    const trxLine = snapshot.balances.find((b) => b.asset === 'TRX');

    // USDT is priced — fiatValue present.
    expect(usdtLine?.fiatValue).toBe('16632.00');

    // TRX has no rate — fiatValue MUST be absent (not null, not '0', not a crash).
    expect(trxLine?.fiatValue).toBeUndefined();

    // totalFiatValue only reflects the priced asset.
    expect(snapshot.totalFiatValue).toBe('16632.00');
  });
});
