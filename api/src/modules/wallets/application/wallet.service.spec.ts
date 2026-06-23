/**
 * Unit tests for WalletService (task 5.1, updated for task X3).
 *
 * All external dependencies are mocked:
 *   - WALLET_PROVIDER → mock IWalletProvider
 *   - WALLET_REPOSITORY → mock IWalletRepository
 *   - CLOCK → stub returning a fixed Date
 *   - AssetRegistry → stub returning USDT/TRON metadata
 *
 * TDD: tests written first (red), then WalletService is implemented.
 */

import type { Clock } from '../../../core/common/clock';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import {
  UnsupportedAssetError,
  UnsupportedNetworkForAssetError,
} from '../../../core/catalog/catalog-errors';
import type { IWalletProvider } from './ports/wallet-provider.port';
import type {
  IWalletRepository,
  WalletRecord,
} from './ports/wallet.repository.port';
import { WalletService } from './wallet.service';

// ---------------------------------------------------------------------------
// Fixed test values
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2025-01-15T10:00:00.000Z');
const USER_ID = 'user-uuid-aaaa';
const PROVIDER_REF = 'blockradar-child-id-1';
const ON_CHAIN_ADDRESS = 'TRX_ADDR_ABCDEF';
const USDT_BLOCKRADAR_ASSET_ID = 'f56d297c-a3db-4cda-95bd-180b54679070';

const EXISTING_WALLET: WalletRecord = {
  id: 'wallet-uuid-1111',
  userId: USER_ID,
  asset: 'USDT',
  network: 'TRON',
  address: ON_CHAIN_ADDRESS,
  providerReference: PROVIDER_REF,
  status: 'active',
};

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeProvider(
  provisionResult?: Partial<{
    providerReference: string;
    address: string;
    network: string;
  }>,
): jest.Mocked<IWalletProvider> {
  return {
    provisionAddress: jest.fn().mockResolvedValue({
      providerReference: PROVIDER_REF,
      address: ON_CHAIN_ADDRESS,
      network: 'TRON',
      ...provisionResult,
    }),
    getBalance: jest
      .fn()
      .mockResolvedValue({ amount: '5.000000', decimals: 6 }),
  };
}

function makeRepo(
  existing: WalletRecord | null = null,
): jest.Mocked<IWalletRepository> {
  return {
    findByUserAssetNetwork: jest.fn().mockResolvedValue(existing),
    findByAddress: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(EXISTING_WALLET),
  };
}

function makeClock(): jest.Mocked<Clock> {
  return { now: jest.fn().mockReturnValue(FIXED_NOW) };
}

/**
 * Minimal AssetRegistry stub — provides what WalletService needs:
 * asset(), network(), assetProviderId(), defaultCryptoAsset(), defaultNetworkFor().
 */
function makeAssetRegistry(): jest.Mocked<AssetRegistry> {
  return {
    asset: jest.fn().mockReturnValue({
      symbol: 'USDT',
      displayName: 'USDT',
      kind: 'crypto',
      decimals: 6,
      networks: ['TRON'],
      providers: { blockradar: { assetId: USDT_BLOCKRADAR_ASSET_ID } },
      enabled: true,
    }),
    network: jest.fn().mockReturnValue({
      id: 'TRON',
      displayName: 'TRON (TRC-20)',
      addressPattern: '^T[1-9A-HJ-NP-Za-km-z]{33}$',
      enabled: true,
    }),
    assetProviderId: jest.fn().mockReturnValue(USDT_BLOCKRADAR_ASSET_ID),
    defaultCryptoAsset: jest.fn().mockReturnValue('USDT'),
    defaultNetworkFor: jest.fn().mockReturnValue('TRON'),
    isAssetEnabled: jest.fn().mockReturnValue(true),
    isNetworkEnabled: jest.fn().mockReturnValue(true),
    isFiatEnabled: jest.fn().mockReturnValue(true),
    isCapabilityEnabled: jest.fn().mockReturnValue(true),
    requireCapability: jest.fn(),
    fiat: jest.fn(),
    formatCrypto: jest.fn(),
    formatFiat: jest.fn(),
    validateAddress: jest.fn().mockReturnValue(true),
  } as unknown as jest.Mocked<AssetRegistry>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WalletService', () => {
  // ── getOrProvisionWallet ─────────────────────────────────────────────────

  describe('getOrProvisionWallet', () => {
    it('returns existing wallet when found; does NOT call the provider', async () => {
      const provider = makeProvider();
      const repo = makeRepo(EXISTING_WALLET);
      const service = new WalletService(
        provider,
        repo,
        makeClock(),
        makeAssetRegistry(),
      );

      const result = await service.getOrProvisionWallet(
        USER_ID,
        'USDT',
        'TRON',
      );

      expect(result).toEqual(EXISTING_WALLET);
      expect(repo.findByUserAssetNetwork).toHaveBeenCalledWith(
        USER_ID,
        'USDT',
        'TRON',
      );
      expect(provider.provisionAddress).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('provisions and creates wallet when no existing record; returns created wallet', async () => {
      const provider = makeProvider();
      const repo = makeRepo(null); // no existing wallet
      const clock = makeClock();

      // create() resolves with the new wallet
      const createdWallet: WalletRecord = {
        ...EXISTING_WALLET,
        id: 'wallet-new-id',
      };
      repo.create.mockResolvedValue(createdWallet);

      const service = new WalletService(
        provider,
        repo,
        clock,
        makeAssetRegistry(),
      );
      const result = await service.getOrProvisionWallet(
        USER_ID,
        'USDT',
        'TRON',
      );

      expect(provider.provisionAddress).toHaveBeenCalledWith({
        userRef: USER_ID,
      });
      expect(repo.create).toHaveBeenCalledWith({
        userId: USER_ID,
        asset: 'USDT',
        network: 'TRON',
        address: ON_CHAIN_ADDRESS,
        providerReference: PROVIDER_REF,
        status: 'active',
        provisionedAt: FIXED_NOW,
      });
      expect(result).toEqual(createdWallet);
    });

    it('is idempotent: a second call with an existing wallet returns it without re-provisioning', async () => {
      const provider = makeProvider();
      const repo = makeRepo(EXISTING_WALLET);
      const service = new WalletService(
        provider,
        repo,
        makeClock(),
        makeAssetRegistry(),
      );

      const result1 = await service.getOrProvisionWallet(
        USER_ID,
        'USDT',
        'TRON',
      );
      const result2 = await service.getOrProvisionWallet(
        USER_ID,
        'USDT',
        'TRON',
      );

      expect(result1).toEqual(EXISTING_WALLET);
      expect(result2).toEqual(EXISTING_WALLET);
      expect(provider.provisionAddress).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('queries the repo with the provided asset and network', async () => {
      const provider = makeProvider();
      const repo = makeRepo(EXISTING_WALLET);
      const service = new WalletService(
        provider,
        repo,
        makeClock(),
        makeAssetRegistry(),
      );

      await service.getOrProvisionWallet(USER_ID, 'USDT', 'TRON');

      expect(repo.findByUserAssetNetwork).toHaveBeenCalledWith(
        USER_ID,
        'USDT',
        'TRON',
      );
    });

    it('throws UnsupportedAssetError when asset is not registered', async () => {
      const provider = makeProvider();
      const repo = makeRepo(null);
      const registry = makeAssetRegistry();
      // Override asset() to throw for an unknown asset
      registry.asset.mockImplementation((sym: string) => {
        throw new UnsupportedAssetError(sym);
      });

      const service = new WalletService(provider, repo, makeClock(), registry);

      await expect(
        service.getOrProvisionWallet(USER_ID, 'BTC', 'BITCOIN'),
      ).rejects.toBeInstanceOf(UnsupportedAssetError);
      // Provider must NOT be called when validation fails
      expect(provider.provisionAddress).not.toHaveBeenCalled();
    });

    it('throws UnsupportedNetworkForAssetError when the network is not listed for the asset', async () => {
      const provider = makeProvider();
      const repo = makeRepo(null);
      const registry = makeAssetRegistry();
      // USDT asset does NOT list 'ETH' as a supported network
      registry.asset.mockReturnValue({
        symbol: 'USDT',
        displayName: 'USDT',
        kind: 'crypto',
        decimals: 6,
        networks: ['TRON'], // ETH is not here
        providers: {},
        enabled: true,
      });

      const service = new WalletService(provider, repo, makeClock(), registry);

      await expect(
        service.getOrProvisionWallet(USER_ID, 'USDT', 'ETH'),
      ).rejects.toBeInstanceOf(UnsupportedNetworkForAssetError);
      expect(provider.provisionAddress).not.toHaveBeenCalled();
    });
  });

  // ── getOrProvisionUsdtTronWallet (thin delegate shim) ────────────────────

  describe('getOrProvisionUsdtTronWallet', () => {
    it('delegates to getOrProvisionWallet with USDT/TRON from registry defaults', async () => {
      const provider = makeProvider();
      const repo = makeRepo(EXISTING_WALLET);
      const registry = makeAssetRegistry();
      const service = new WalletService(provider, repo, makeClock(), registry);

      const result = await service.getOrProvisionUsdtTronWallet(USER_ID);

      expect(result).toEqual(EXISTING_WALLET);
      // Registry defaults consulted
      expect(registry.defaultCryptoAsset).toHaveBeenCalled();
      expect(registry.defaultNetworkFor).toHaveBeenCalledWith('USDT');
      // Repo queried with USDT/TRON
      expect(repo.findByUserAssetNetwork).toHaveBeenCalledWith(
        USER_ID,
        'USDT',
        'TRON',
      );
      expect(provider.provisionAddress).not.toHaveBeenCalled();
    });
  });

  // ── getBalance ───────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('delegates to the provider using wallet.providerReference and registry assetId', async () => {
      const provider = makeProvider();
      const repo = makeRepo(EXISTING_WALLET);
      const service = new WalletService(
        provider,
        repo,
        makeClock(),
        makeAssetRegistry(),
      );

      const result = await service.getBalance(EXISTING_WALLET);

      // getBalance must pass both the providerReference AND the resolved assetId
      expect(provider.getBalance).toHaveBeenCalledWith(
        PROVIDER_REF,
        USDT_BLOCKRADAR_ASSET_ID,
      );
      expect(result).toEqual({ amount: '5.000000', decimals: 6 });
    });

    it('returns the balance output from the provider as-is', async () => {
      const provider = makeProvider();
      provider.getBalance.mockResolvedValue({
        amount: '100.000001',
        decimals: 6,
      });
      const service = new WalletService(
        provider,
        makeRepo(),
        makeClock(),
        makeAssetRegistry(),
      );

      const result = await service.getBalance(EXISTING_WALLET);

      expect(result.amount).toBe('100.000001');
      expect(result.decimals).toBe(6);
    });
  });
});
