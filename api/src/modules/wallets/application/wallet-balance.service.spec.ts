/**
 * WalletBalanceService spec — TDD-first.
 *
 * The service MUST source per-asset amounts from the LEDGER (ILedgerRepository)
 * rather than from the on-chain provider (WalletService.getBalance). This is
 * the custodial source of truth and ensures the wallet page reflects credited
 * deposits even before an on-chain sync happens.
 *
 * Regression guard: WalletService.getBalance must NOT be called during getBalances().
 */
import { WalletBalanceService } from './wallet-balance.service';
import type { WalletService } from './wallet.service';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { IRateProvider } from '../../quotes/application/ports/rate-provider.port';
import type { IWalletRepository } from './ports/wallet.repository.port';
import type { ILedgerRepository } from '../../transactions/application/ports/ledger.repository.port';

const makeRegistry = () =>
  ({
    enabledCryptoAssets: () => ['USDT'],
    defaultCryptoAsset: () => 'USDT',
    defaultFiat: () => 'NGN',
    asset: (s: string) => ({
      symbol: s,
      displayName: 'Tether USD',
      decimals: 6,
      networks: ['TRON'],
    }),
    defaultNetworkFor: () => 'TRON',
    network: (id: string) => ({ id, displayName: 'TRON (TRC-20)' }),
    fiat: () => ({ symbol: '₦', decimals: 2 }),
    logoUrl: () => null,
  }) as unknown as AssetRegistry;

// Two enabled assets on distinct networks — exercises the total summation.
const makeMultiRegistry = () =>
  ({
    enabledCryptoAssets: () => ['USDT', 'TRX'],
    defaultCryptoAsset: () => 'USDT',
    defaultFiat: () => 'NGN',
    asset: (s: string) => ({
      symbol: s,
      displayName: s === 'USDT' ? 'Tether USD' : 'TRON',
      decimals: 6,
      networks: ['TRON'],
    }),
    defaultNetworkFor: () => 'TRON',
    network: (id: string) => ({ id, displayName: id }),
    fiat: () => ({ symbol: '₦', decimals: 2 }),
    logoUrl: () => null,
  }) as unknown as AssetRegistry;

const wallet = {
  id: 'w1',
  userId: 'u1',
  network: 'TRON',
  address: 'TADDR',
  providerReference: 'pr',
  status: 'active',
};

/** Minimal WalletService stub — getBalance must NOT be called in the new code. */
const makeWallets = (overrides: Partial<WalletService> = {}) =>
  ({
    getOrProvisionNetworkWallet: jest.fn().mockResolvedValue(wallet),
    getBalance: jest
      .fn()
      .mockRejectedValue(
        new Error(
          'WalletService.getBalance must not be called — balance must come from the ledger',
        ),
      ),
    ...overrides,
  }) as unknown as WalletService;

const makeWalletRepo = (found: typeof wallet | null = wallet) =>
  ({
    findByUserNetwork: jest.fn().mockResolvedValue(found),
  }) as unknown as IWalletRepository;

describe('WalletBalanceService', () => {
  it('reads amounts from the LEDGER — not from provider.getBalance', async () => {
    const walletRepo = makeWalletRepo(wallet);
    const ledgerRepo: ILedgerRepository = {
      getAccountBalance: jest.fn().mockResolvedValue('29.97'),
    };
    const rates: IRateProvider = {
      getRate: jest.fn().mockResolvedValue({
        baseRate: 1650,
        sellSpreadBps: 200,
        buySpreadBps: 150,
        processingFeeBps: 0,
        expiresInSec: 30,
        cryptoDecimals: 6,
      }),
      getValuationRate: jest.fn().mockResolvedValue({ baseRate: 1650 }),
    };
    const wallets = makeWallets(); // getBalance must NOT be called
    const svc = new WalletBalanceService(
      wallets,
      makeRegistry(),
      rates,
      walletRepo,
      ledgerRepo,
    );

    const out = await svc.getBalances('u1');

    // Must read from ledger
    expect(ledgerRepo.getAccountBalance).toHaveBeenCalledWith(
      'user_wallet',
      'w1',
      'USDT',
    );
    // Must NOT call provider getBalance
    expect(wallets.getBalance).not.toHaveBeenCalled();

    expect(out.fiatCurrency).toBe('NGN');
    expect(out.fiatSymbol).toBe('₦');
    expect(out.assets).toHaveLength(1);
    expect(out.assets[0]).toMatchObject({
      symbol: 'USDT',
      network: 'TRON',
      amount: '29.97',
      fiatValue: '48461.49',
    });
    expect(out.totalFiatValue).toBe('48461.49');
  });

  it('includes the asset logoUrl from the registry when present, omits it when null', async () => {
    const walletRepo = makeWalletRepo(wallet);
    const ledgerRepo: ILedgerRepository = {
      getAccountBalance: jest.fn().mockResolvedValue('29.97'),
    };
    const rates: IRateProvider = {
      getRate: jest.fn().mockResolvedValue({
        baseRate: 1650,
        sellSpreadBps: 200,
        buySpreadBps: 150,
        processingFeeBps: 0,
        expiresInSec: 30,
        cryptoDecimals: 6,
      }),
      getValuationRate: jest.fn().mockResolvedValue({ baseRate: 1650 }),
    };
    const wallets = makeWallets();
    const registry = {
      ...makeRegistry(),
      logoUrl: (sym: string) =>
        sym === 'USDT' ? 'https://cdn.example/usdt.png' : null,
    } as unknown as AssetRegistry;
    const svc = new WalletBalanceService(
      wallets,
      registry,
      rates,
      walletRepo,
      ledgerRepo,
    );

    const out = await svc.getBalances('u1');
    expect(out.assets[0].logoUrl).toBe('https://cdn.example/usdt.png');

    // And when the registry returns null, logoUrl is omitted entirely.
    const registryNoLogo = {
      ...makeRegistry(),
      logoUrl: () => null,
    } as unknown as AssetRegistry;
    const svcNoLogo = new WalletBalanceService(
      wallets,
      registryNoLogo,
      rates,
      walletRepo,
      ledgerRepo,
    );
    const outNoLogo = await svcNoLogo.getBalances('u1');
    expect(outNoLogo.assets[0].logoUrl).toBeUndefined();
  });

  it('returns zero amount when no wallet exists for the user/network yet', async () => {
    const walletRepo = makeWalletRepo(null); // no wallet provisioned
    const ledgerRepo: ILedgerRepository = {
      getAccountBalance: jest.fn(),
    };
    const rates: IRateProvider = {
      getRate: jest.fn().mockResolvedValue({
        baseRate: 1600,
        sellSpreadBps: 150,
        buySpreadBps: 150,
        processingFeeBps: 0,
        expiresInSec: 30,
        cryptoDecimals: 6,
      }),
      getValuationRate: jest.fn().mockResolvedValue({ baseRate: 1600 }),
    };
    const wallets = makeWallets();
    const svc = new WalletBalanceService(
      wallets,
      makeRegistry(),
      rates,
      walletRepo,
      ledgerRepo,
    );

    const out = await svc.getBalances('u1');
    // No wallet → ledger not queried, amount = '0'
    expect(ledgerRepo.getAccountBalance).not.toHaveBeenCalled();
    expect(out.assets[0].amount).toBe('0');
    expect(out.assets[0].fiatValue).toBe('0.00');
    expect(out.totalFiatValue).toBe('0.00');
  });

  it('tolerates a truly unpriced asset — both getRate and getValuationRate throw — no fiatValue', async () => {
    // Simulates an asset with no pricing at all (neither tradeable nor valuation-only).
    const walletRepo = makeWalletRepo(wallet);
    const ledgerRepo: ILedgerRepository = {
      getAccountBalance: jest.fn().mockResolvedValue('200'),
    };
    const rates: IRateProvider = {
      getRate: jest
        .fn()
        .mockRejectedValue(new Error('No pricing configured for XYZ in NGN')),
      getValuationRate: jest
        .fn()
        .mockRejectedValue(
          new Error('No valuation rate configured for XYZ in NGN'),
        ),
    };
    const wallets = makeWallets();
    const svc = new WalletBalanceService(
      wallets,
      makeRegistry(),
      rates,
      walletRepo,
      ledgerRepo,
    );

    const out = await svc.getBalances('u1');
    expect(out.assets).toHaveLength(1);
    expect(out.assets[0].amount).toBe('200');
    expect(out.assets[0].fiatValue).toBeUndefined();
    expect(out.totalFiatValue).toBe('0.00');
  });

  it('values TRX via getValuationRate (swap-only: getRate throws) and includes in total', async () => {
    // TRX: getRate throws (fiatTradeable=false in real config), getValuationRate returns 520.
    // This mirrors the production config: TRX has fiatTradeable:false so getRate rejects,
    // but getValuationRate returns the baseRate for wallet display.
    const walletRepo: IWalletRepository = {
      findByUserNetwork: jest.fn().mockResolvedValue(wallet),
    } as unknown as IWalletRepository;
    const ledgerRepo: ILedgerRepository = {
      getAccountBalance: jest
        .fn()
        .mockImplementation((_type: string, _id: string, currency: string) =>
          Promise.resolve(currency === 'USDT' ? '10' : '200'),
        ),
    };
    const rates: IRateProvider = {
      getRate: jest.fn().mockImplementation((asset: string) =>
        asset === 'USDT'
          ? Promise.resolve({
              baseRate: 1600,
              sellSpreadBps: 150,
              buySpreadBps: 150,
              processingFeeBps: 0,
              expiresInSec: 30,
              cryptoDecimals: 6,
            })
          : Promise.reject(
              new Error('Asset TRX is not fiat-tradeable (swap-only)'),
            ),
      ),
      getValuationRate: jest
        .fn()
        .mockImplementation((asset: string) =>
          asset === 'TRX'
            ? Promise.resolve({ baseRate: 520 })
            : Promise.reject(new Error('no valuation rate')),
        ),
    };
    const wallets = makeWallets();
    const svc = new WalletBalanceService(
      wallets,
      makeMultiRegistry(), // includes TRX
      rates,
      walletRepo,
      ledgerRepo,
    );

    const out = await svc.getBalances('u1');
    const usdtAsset = out.assets.find((a) => a.symbol === 'USDT');
    const trxAsset = out.assets.find((a) => a.symbol === 'TRX');

    // USDT: 10 × (1600 × (1 − 150/10000)) = 10 × 1576 = 15760.00
    expect(usdtAsset?.fiatValue).toBe('15760.00');
    // TRX: 200 × 520 (mid-market, no spread) = 104000.00
    expect(trxAsset?.fiatValue).toBe('104000.00');
    // Total = 15760 + 104000
    expect(out.totalFiatValue).toBe('119760.00');
  });

  it('sums multiple assets exactly (floored per-asset values, no rounding drift)', async () => {
    const walletRepo: IWalletRepository = {
      findByUserNetwork: jest.fn().mockResolvedValue(wallet),
    } as unknown as IWalletRepository;
    const ledgerRepo: ILedgerRepository = {
      getAccountBalance: jest
        .fn()
        .mockImplementation((_type: string, _id: string, currency: string) =>
          Promise.resolve(currency === 'USDT' ? '29.97' : '0.5'),
        ),
    };
    // Both assets fiat-tradeable in this test — getRate returns for both
    const rates: IRateProvider = {
      getRate: jest.fn().mockImplementation((asset: string) =>
        Promise.resolve(
          asset === 'USDT'
            ? {
                baseRate: 1650,
                sellSpreadBps: 200,
                buySpreadBps: 150,
                processingFeeBps: 0,
                expiresInSec: 30,
                cryptoDecimals: 6,
              }
            : {
                baseRate: 100000,
                sellSpreadBps: 200,
                buySpreadBps: 150,
                processingFeeBps: 0,
                expiresInSec: 30,
                cryptoDecimals: 8,
              },
        ),
      ),
      getValuationRate: jest.fn(), // not called when getRate succeeds
    };
    const wallets = makeWallets();
    const svc = new WalletBalanceService(
      wallets,
      makeMultiRegistry(),
      rates,
      walletRepo,
      ledgerRepo,
    );

    const out = await svc.getBalances('u1');
    // USDT: 29.97 × (1650 × 0.98) = 48461.49; TRX/BTC: 0.5 × (100000 × 0.98) = 49000.00
    expect(out.assets.map((a) => a.fiatValue)).toEqual([
      '48461.49',
      '49000.00',
    ]);
    expect(out.totalFiatValue).toBe('97461.49');
  });

  it('returns the deposit address for the default network when no asset is specified', async () => {
    const walletRepo = makeWalletRepo(wallet);
    const ledgerRepo: ILedgerRepository = {
      getAccountBalance: jest.fn(),
    };
    const rates: IRateProvider = {
      getRate: jest.fn(),
      getValuationRate: jest.fn(),
    };
    const wallets = makeWallets();
    const svc = new WalletBalanceService(
      wallets,
      makeRegistry(),
      rates,
      walletRepo,
      ledgerRepo,
    );
    const out = await svc.getDepositAddress('u1');
    expect(out).toMatchObject({
      asset: 'USDT',
      network: 'TRON',
      networkLabel: 'TRON (TRC-20)',
      address: 'TADDR',
    });
  });

  it('returns deposit address labelled USDT when asset=USDT is requested', async () => {
    const walletRepo = makeWalletRepo(wallet);
    const ledgerRepo: ILedgerRepository = {
      getAccountBalance: jest.fn(),
    };
    const rates: IRateProvider = {
      getRate: jest.fn(),
      getValuationRate: jest.fn(),
    };
    const wallets = makeWallets();
    const svc = new WalletBalanceService(
      wallets,
      makeRegistry(),
      rates,
      walletRepo,
      ledgerRepo,
    );
    const out = await svc.getDepositAddress('u1', undefined, 'USDT');
    expect(out).toMatchObject({
      asset: 'USDT',
      network: 'TRON',
      networkLabel: 'TRON (TRC-20)',
      address: 'TADDR',
    });
  });

  it('returns deposit address labelled TRX when asset=TRX is requested (same TRON address)', async () => {
    // On TRON, USDT and TRX share one address — the label must reflect the requested asset.
    const walletRepo: IWalletRepository = {
      findByUserNetwork: jest.fn().mockResolvedValue(wallet),
    } as unknown as IWalletRepository;
    const ledgerRepo: ILedgerRepository = {
      getAccountBalance: jest.fn(),
    };
    const rates: IRateProvider = {
      getRate: jest.fn(),
      getValuationRate: jest.fn(),
    };
    // A registry that knows TRX lives on TRON too
    const registryWithTrx = {
      ...makeRegistry(),
      defaultCryptoAsset: () => 'USDT',
      defaultNetworkFor: () => 'TRON',
      asset: (s: string) => ({
        symbol: s,
        displayName: s === 'TRX' ? 'TRON' : 'Tether USD',
        decimals: 6,
        networks: ['TRON'],
      }),
      network: (id: string) => ({ id, displayName: 'TRON (TRC-20)' }),
    } as unknown as import('../../../core/catalog/asset-registry').AssetRegistry;
    const wallets = makeWallets();
    const svc = new WalletBalanceService(
      wallets,
      registryWithTrx,
      rates,
      walletRepo,
      ledgerRepo,
    );
    const out = await svc.getDepositAddress('u1', undefined, 'TRX');
    // The address is the same TRON address but the asset label must be TRX
    expect(out.asset).toBe('TRX');
    expect(out.address).toBe('TADDR');
    expect(out.network).toBe('TRON');
  });
});
