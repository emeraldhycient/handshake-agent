import { WalletBalanceService } from './wallet-balance.service';
import type { WalletService } from './wallet.service';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { IRateProvider } from '../../quotes/application/ports/rate-provider.port';

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
  }) as unknown as AssetRegistry;

// Two enabled assets on distinct networks — exercises the total summation.
const makeMultiRegistry = () =>
  ({
    enabledCryptoAssets: () => ['USDT', 'BTC'],
    defaultCryptoAsset: () => 'USDT',
    defaultFiat: () => 'NGN',
    asset: (s: string) => ({
      symbol: s,
      displayName: s === 'USDT' ? 'Tether USD' : 'Bitcoin',
      decimals: s === 'USDT' ? 6 : 8,
      networks: [s === 'USDT' ? 'TRON' : 'BTC'],
    }),
    defaultNetworkFor: (s: string) => (s === 'USDT' ? 'TRON' : 'BTC'),
    network: (id: string) => ({ id, displayName: id }),
    fiat: () => ({ symbol: '₦', decimals: 2 }),
  }) as unknown as AssetRegistry;

const wallet = {
  id: 'w1',
  userId: 'u1',
  network: 'TRON',
  address: 'TADDR',
  providerReference: 'pr',
  status: 'active',
};

describe('WalletBalanceService', () => {
  it('values each asset at the sell rate and sums the total', async () => {
    const wallets = {
      getOrProvisionNetworkWallet: jest.fn().mockResolvedValue(wallet),
      getBalance: jest.fn().mockResolvedValue({ amount: '29.97', decimals: 6 }),
    } as unknown as WalletService;
    const rates = {
      getRate: jest.fn().mockResolvedValue({
        baseRate: 1650,
        sellSpreadBps: 200,
        buySpreadBps: 150,
        processingFeeBps: 0,
        expiresInSec: 30,
        cryptoDecimals: 6,
      }),
    } as unknown as IRateProvider;
    const svc = new WalletBalanceService(wallets, makeRegistry(), rates);

    const out = await svc.getBalances('u1');
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

  it('tolerates a per-asset getBalance failure (Blockradar 404) as zero — never 500s the page', async () => {
    const wallets = {
      getOrProvisionNetworkWallet: jest.fn().mockResolvedValue(wallet),
      getBalance: jest
        .fn()
        .mockRejectedValue(
          new Error(
            'Blockradar getBalance error (HTTP 404): Asset not found or not active',
          ),
        ),
    } as unknown as WalletService;
    const rates = {
      getRate: jest.fn().mockResolvedValue({
        baseRate: 1650,
        sellSpreadBps: 200,
        buySpreadBps: 150,
        processingFeeBps: 0,
        expiresInSec: 30,
        cryptoDecimals: 6,
      }),
    } as unknown as IRateProvider;
    const svc = new WalletBalanceService(wallets, makeRegistry(), rates);

    const out = await svc.getBalances('u1');
    expect(out.assets).toHaveLength(1);
    expect(out.assets[0]).toMatchObject({
      symbol: 'USDT',
      amount: '0',
      fiatValue: '0.00',
    });
    expect(out.totalFiatValue).toBe('0.00');
  });

  it('sums multiple assets exactly (floored per-asset values, no rounding drift)', async () => {
    const wallets = {
      getOrProvisionNetworkWallet: jest.fn().mockResolvedValue(wallet),
      getBalance: jest.fn().mockImplementation((_w: unknown, asset: string) =>
        Promise.resolve({
          amount: asset === 'USDT' ? '29.97' : '0.5',
          decimals: asset === 'USDT' ? 6 : 8,
        }),
      ),
    } as unknown as WalletService;
    const rates = {
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
    } as unknown as IRateProvider;
    const svc = new WalletBalanceService(wallets, makeMultiRegistry(), rates);

    const out = await svc.getBalances('u1');
    // USDT: 29.97 × (1650 × 0.98) = 48461.49 ; BTC: 0.5 × (100000 × 0.98) = 49000.00
    expect(out.assets.map((a) => a.fiatValue)).toEqual([
      '48461.49',
      '49000.00',
    ]);
    expect(out.totalFiatValue).toBe('97461.49');
  });

  it('returns the deposit address for the default network', async () => {
    const wallets = {
      getOrProvisionNetworkWallet: jest.fn().mockResolvedValue(wallet),
      getBalance: jest.fn(),
    } as unknown as WalletService;
    const rates = { getRate: jest.fn() } as unknown as IRateProvider;
    const svc = new WalletBalanceService(wallets, makeRegistry(), rates);
    const out = await svc.getDepositAddress('u1');
    expect(out).toMatchObject({
      asset: 'USDT',
      network: 'TRON',
      networkLabel: 'TRON (TRC-20)',
      address: 'TADDR',
    });
  });
});
