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
    expect(out.assets).toHaveLength(1);
    expect(out.assets[0]).toMatchObject({
      symbol: 'USDT',
      network: 'TRON',
      amount: '29.97',
      fiatValue: '48461.49',
    });
    expect(out.totalFiatValue).toBe('48461.49');
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
