/**
 * Unit tests for WalletsModule provider binding selection.
 *
 * Tests both WALLET_PROVIDER (WALLET_MOCK_MODE) and SWAP_PROVIDER (SWAP_MOCK_MODE)
 * factory helpers.
 *
 * Mirrors the TreasuryModule / ComplianceModule binding tests: exercise the
 * exported `selectWalletProvider` / `selectSwapProvider` helpers the module
 * uses directly — fast and hermetic, no full DI boot.
 */
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import type { AssetRegistry } from '../../core/catalog/asset-registry';
import { selectWalletProvider, selectSwapProvider } from './wallets.module';
import { MockWalletProvider } from './infrastructure/mock-wallet.provider';
import { BlockradarProvider } from './infrastructure/blockradar.provider';
import { MockSwapProvider } from './infrastructure/mock-swap.provider';
import { BlockradarSwapProvider } from './infrastructure/blockradar-swap.provider';

function makeConfigService(
  overrides: Record<string, string> = {},
): ConfigService {
  return {
    get: (key: string) => {
      const values: Record<string, string> = {
        BLOCKRADAR_BASE_URL: 'https://api.blockradar.co/v1',
        BLOCKRADAR_API_KEY: 'test-key',
        WALLET_MOCK_MODE: 'true',
        SWAP_MOCK_MODE: 'true',
        ...overrides,
      };
      return values[key];
    },
  } as unknown as ConfigService;
}

function makeHttpService(): HttpService {
  return { get: jest.fn(), post: jest.fn() } as unknown as HttpService;
}

function makeAssetRegistry(): AssetRegistry {
  return {
    networkMasterWalletId: jest.fn().mockReturnValue('master-wallet-id'),
  } as unknown as AssetRegistry;
}

function resolveWallet(walletMockMode: string) {
  const config = makeConfigService({ WALLET_MOCK_MODE: walletMockMode });
  const mock = new MockWalletProvider();
  const real = new BlockradarProvider(
    makeHttpService(),
    config,
    makeAssetRegistry(),
  );
  return selectWalletProvider(mock, real, config);
}

function resolveSwap(swapMockMode: string) {
  const config = makeConfigService({ SWAP_MOCK_MODE: swapMockMode });
  const mock = new MockSwapProvider(config);
  const real = new BlockradarSwapProvider(
    makeHttpService(),
    config,
    makeAssetRegistry(),
  );
  return selectSwapProvider(mock, real, config);
}

describe('WalletsModule — WALLET_PROVIDER factory binding', () => {
  it('selects MockWalletProvider when WALLET_MOCK_MODE=true (default)', () => {
    expect(resolveWallet('true')).toBeInstanceOf(MockWalletProvider);
  });

  it('selects MockWalletProvider for any non-"false" value (default safe)', () => {
    expect(resolveWallet('')).toBeInstanceOf(MockWalletProvider);
  });

  it('selects the real BlockradarProvider when WALLET_MOCK_MODE=false', () => {
    expect(resolveWallet('false')).toBeInstanceOf(BlockradarProvider);
  });

  it('the selected provider satisfies the port (has provisionAddress + withdraw)', () => {
    const real = resolveWallet('false');
    expect(typeof real.provisionAddress).toBe('function');
    expect(typeof real.withdraw).toBe('function');
  });
});

describe('WalletsModule — SWAP_PROVIDER factory binding', () => {
  it('selects MockSwapProvider when SWAP_MOCK_MODE=true (default)', () => {
    expect(resolveSwap('true')).toBeInstanceOf(MockSwapProvider);
  });

  it('selects MockSwapProvider for any non-"false" value (default safe)', () => {
    expect(resolveSwap('')).toBeInstanceOf(MockSwapProvider);
  });

  it('selects the real BlockradarSwapProvider when SWAP_MOCK_MODE=false', () => {
    expect(resolveSwap('false')).toBeInstanceOf(BlockradarSwapProvider);
  });

  it('the selected provider satisfies the port (has getQuote + execute)', () => {
    const real = resolveSwap('false');
    expect(typeof real.getQuote).toBe('function');
    expect(typeof real.execute).toBe('function');
  });
});
