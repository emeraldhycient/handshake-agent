/**
 * Unit tests for WalletsModule WALLET_PROVIDER binding selection.
 *
 * The factory logic in WalletsModule is: when WALLET_MOCK_MODE === 'false',
 * return the real BlockradarProvider; otherwise (default 'true', or any other
 * value) return MockWalletProvider.
 *
 * Mirrors the TreasuryModule / ComplianceModule binding tests: exercise the
 * exported `selectWalletProvider` helper the module uses directly — fast and
 * hermetic, no full DI boot.
 */
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import type { AssetRegistry } from '../../core/catalog/asset-registry';
import { selectWalletProvider } from './wallets.module';
import { MockWalletProvider } from './infrastructure/mock-wallet.provider';
import { BlockradarProvider } from './infrastructure/blockradar.provider';

function makeConfigService(walletMockMode: string): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'WALLET_MOCK_MODE') return walletMockMode;
      if (key === 'BLOCKRADAR_BASE_URL') return 'https://api.blockradar.co/v1';
      if (key === 'BLOCKRADAR_API_KEY') return 'test-key';
      return undefined;
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

function resolve(walletMockMode: string) {
  const config = makeConfigService(walletMockMode);
  const mock = new MockWalletProvider();
  const real = new BlockradarProvider(
    makeHttpService(),
    config,
    makeAssetRegistry(),
  );
  return selectWalletProvider(mock, real, config);
}

describe('WalletsModule — WALLET_PROVIDER factory binding', () => {
  it('selects MockWalletProvider when WALLET_MOCK_MODE=true (default)', () => {
    expect(resolve('true')).toBeInstanceOf(MockWalletProvider);
  });

  it('selects MockWalletProvider for any non-"false" value (default safe)', () => {
    expect(resolve('')).toBeInstanceOf(MockWalletProvider);
  });

  it('selects the real BlockradarProvider when WALLET_MOCK_MODE=false', () => {
    expect(resolve('false')).toBeInstanceOf(BlockradarProvider);
  });

  it('the selected provider satisfies the port (has provisionAddress + withdraw)', () => {
    const real = resolve('false');
    expect(typeof real.provisionAddress).toBe('function');
    expect(typeof real.withdraw).toBe('function');
  });
});
