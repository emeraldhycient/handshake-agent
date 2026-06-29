/**
 * Unit tests for WalletService (WN-1 refactor: wallet per network, not per asset).
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
import { UnsupportedNetworkError } from '../../../core/catalog/catalog-errors';
import type {
  IWalletProvider,
  GetWithdrawalStatusOutput,
} from './ports/wallet-provider.port';
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
const MASTER_WALLET_ID = 'master-wallet-uuid-tron';

const EXISTING_WALLET: WalletRecord = {
  id: 'wallet-uuid-1111',
  userId: USER_ID,
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
    // withdraw stub — present to satisfy the interface.
    withdraw: jest.fn().mockResolvedValue({
      providerReference: 'tx-ref-stub',
      status: 'pending' as const,
    }),
    // getWithdrawalStatus stub — exercised in the getWithdrawalStatus describe.
    getWithdrawalStatus: jest.fn().mockResolvedValue({
      status: 'pending' as const,
    }),
    // listWalletAssets stub — called by CatalogSyncService, not WalletService;
    // present to satisfy the IWalletProvider interface.
    listWalletAssets: jest.fn().mockResolvedValue([]),
  };
}

function makeRepo(
  existing: WalletRecord | null = null,
): jest.Mocked<IWalletRepository> {
  return {
    findByUserNetwork: jest.fn().mockResolvedValue(existing),
    findByAddress: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(EXISTING_WALLET),
  };
}

function makeClock(): jest.Mocked<Clock> {
  return { now: jest.fn().mockReturnValue(FIXED_NOW) };
}

/**
 * Minimal AssetRegistry stub — provides what WalletService needs:
 * asset(), network(), assetProviderId(), defaultCryptoAsset(), defaultNetworkFor(),
 * networkMasterWalletId(), enabledNetworks().
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
      networkFeeCrypto: { USDT: '1' },
      amlBlockchain: 'tron',
      masterWalletId: MASTER_WALLET_ID,
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
    networkMasterWalletId: jest.fn().mockReturnValue(MASTER_WALLET_ID),
    enabledNetworks: jest.fn().mockReturnValue(['TRON']),
  } as unknown as jest.Mocked<AssetRegistry>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WalletService', () => {
  // ── getOrProvisionNetworkWallet ───────────────────────────────────────────

  describe('getOrProvisionNetworkWallet', () => {
    it('returns existing wallet when found; does NOT call the provider', async () => {
      const provider = makeProvider();
      const repo = makeRepo(EXISTING_WALLET);
      const service = new WalletService(
        provider,
        repo,
        makeClock(),
        makeAssetRegistry(),
      );

      const result = await service.getOrProvisionNetworkWallet(USER_ID, 'TRON');

      expect(result).toEqual(EXISTING_WALLET);
      expect(repo.findByUserNetwork).toHaveBeenCalledWith(USER_ID, 'TRON');
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
      const result = await service.getOrProvisionNetworkWallet(USER_ID, 'TRON');

      expect(provider.provisionAddress).toHaveBeenCalledWith({
        userRef: USER_ID,
        network: 'TRON',
      });
      expect(repo.create).toHaveBeenCalledWith({
        userId: USER_ID,
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

      const result1 = await service.getOrProvisionNetworkWallet(
        USER_ID,
        'TRON',
      );
      const result2 = await service.getOrProvisionNetworkWallet(
        USER_ID,
        'TRON',
      );

      expect(result1).toEqual(EXISTING_WALLET);
      expect(result2).toEqual(EXISTING_WALLET);
      expect(provider.provisionAddress).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('queries the repo with user and network', async () => {
      const provider = makeProvider();
      const repo = makeRepo(EXISTING_WALLET);
      const service = new WalletService(
        provider,
        repo,
        makeClock(),
        makeAssetRegistry(),
      );

      await service.getOrProvisionNetworkWallet(USER_ID, 'TRON');

      expect(repo.findByUserNetwork).toHaveBeenCalledWith(USER_ID, 'TRON');
    });

    it('throws UnsupportedNetworkError when network is not registered or disabled', async () => {
      const provider = makeProvider();
      const repo = makeRepo(null);
      const registry = makeAssetRegistry();
      registry.network.mockImplementation((id: string) => {
        throw new UnsupportedNetworkError(id);
      });

      const service = new WalletService(provider, repo, makeClock(), registry);

      await expect(
        service.getOrProvisionNetworkWallet(USER_ID, 'ETH'),
      ).rejects.toBeInstanceOf(UnsupportedNetworkError);
      expect(provider.provisionAddress).not.toHaveBeenCalled();
    });

    it('passes network to provisionAddress so provider uses correct master wallet', async () => {
      const provider = makeProvider();
      const repo = makeRepo(null);
      const service = new WalletService(
        provider,
        repo,
        makeClock(),
        makeAssetRegistry(),
      );

      await service.getOrProvisionNetworkWallet(USER_ID, 'TRON');

      expect(provider.provisionAddress).toHaveBeenCalledWith(
        expect.objectContaining({ network: 'TRON' }),
      );
    });
  });

  // ── provisionAllEnabledNetworks ───────────────────────────────────────────

  describe('provisionAllEnabledNetworks', () => {
    it('calls getOrProvisionNetworkWallet for each enabled network', async () => {
      const provider = makeProvider();
      const repo = makeRepo(EXISTING_WALLET);
      const registry = makeAssetRegistry();
      registry.enabledNetworks.mockReturnValue(['TRON']);

      const service = new WalletService(provider, repo, makeClock(), registry);

      const results = await service.provisionAllEnabledNetworks(USER_ID);

      expect(registry.enabledNetworks).toHaveBeenCalled();
      expect(repo.findByUserNetwork).toHaveBeenCalledWith(USER_ID, 'TRON');
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(EXISTING_WALLET);
    });

    it('provisions wallets for multiple networks and returns all', async () => {
      const provider = makeProvider();
      const walletTron: WalletRecord = { ...EXISTING_WALLET, id: 'w-tron' };
      const walletEth: WalletRecord = {
        ...EXISTING_WALLET,
        id: 'w-eth',
        network: 'ETH',
      };

      // repo returns a specific wallet per network
      const repo = makeRepo(null);
      repo.findByUserNetwork
        .mockResolvedValueOnce(walletTron) // first call: TRON
        .mockResolvedValueOnce(walletEth); // second call: ETH

      const registry = makeAssetRegistry();
      registry.enabledNetworks.mockReturnValue(['TRON', 'ETH']);

      const service = new WalletService(provider, repo, makeClock(), registry);

      const results = await service.provisionAllEnabledNetworks(USER_ID);

      expect(results).toHaveLength(2);
      expect(results).toContainEqual(walletTron);
      expect(results).toContainEqual(walletEth);
      // Provider should NOT have been called since both wallets already existed
      expect(provider.provisionAddress).not.toHaveBeenCalled();
    });

    it('provisions missing wallets (idempotent across networks)', async () => {
      const provider = makeProvider();
      const walletTron: WalletRecord = { ...EXISTING_WALLET, id: 'w-tron' };

      const repo = makeRepo(null);
      // TRON: no existing wallet → provisions
      repo.findByUserNetwork.mockResolvedValueOnce(null);
      repo.create.mockResolvedValueOnce(walletTron);

      const registry = makeAssetRegistry();
      registry.enabledNetworks.mockReturnValue(['TRON']);

      const service = new WalletService(provider, repo, makeClock(), registry);

      const results = await service.provisionAllEnabledNetworks(USER_ID);

      expect(provider.provisionAddress).toHaveBeenCalledWith({
        userRef: USER_ID,
        network: 'TRON',
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(walletTron);
    });

    it('returns an empty array when no networks are enabled', async () => {
      const provider = makeProvider();
      const repo = makeRepo(null);
      const registry = makeAssetRegistry();
      registry.enabledNetworks.mockReturnValue([]);

      const service = new WalletService(provider, repo, makeClock(), registry);

      const results = await service.provisionAllEnabledNetworks(USER_ID);

      expect(results).toHaveLength(0);
      expect(provider.provisionAddress).not.toHaveBeenCalled();
    });
  });

  // ── getBalance ───────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('delegates to the provider using wallet.providerReference, registry assetId, and wallet.network', async () => {
      const provider = makeProvider();
      const repo = makeRepo(EXISTING_WALLET);
      const service = new WalletService(
        provider,
        repo,
        makeClock(),
        makeAssetRegistry(),
      );

      const result = await service.getBalance(EXISTING_WALLET, 'USDT');

      // getBalance must pass providerReference, the resolved assetId, and the network
      expect(provider.getBalance).toHaveBeenCalledWith(
        PROVIDER_REF,
        USDT_BLOCKRADAR_ASSET_ID,
        'TRON',
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

      const result = await service.getBalance(EXISTING_WALLET, 'USDT');

      expect(result.amount).toBe('100.000001');
      expect(result.decimals).toBe(6);
    });
  });

  // ── getWithdrawalStatus ───────────────────────────────────────────────────

  describe('getWithdrawalStatus', () => {
    it('delegates to provider.getWithdrawalStatus with wallet.providerReference, reference, and network', async () => {
      const provider = makeProvider();
      const service = new WalletService(
        provider,
        makeRepo(EXISTING_WALLET),
        makeClock(),
        makeAssetRegistry(),
      );

      await service.getWithdrawalStatus(EXISTING_WALLET, 'idem-key-123');

      expect(provider.getWithdrawalStatus).toHaveBeenCalledWith({
        reference: 'idem-key-123',
        addressId: PROVIDER_REF, // wallet.providerReference
        network: 'TRON', // wallet.network
      });
    });

    it('returns the provider output as-is (pending)', async () => {
      const provider = makeProvider();
      provider.getWithdrawalStatus.mockResolvedValue({ status: 'pending' });
      const service = new WalletService(
        provider,
        makeRepo(EXISTING_WALLET),
        makeClock(),
        makeAssetRegistry(),
      );

      const result = await service.getWithdrawalStatus(
        EXISTING_WALLET,
        'idem-key-pending',
      );

      expect(result.status).toBe('pending');
      expect(result.onChainTxHash).toBeUndefined();
    });

    it('returns success with onChainTxHash when provider confirms success', async () => {
      const provider = makeProvider();
      const statusOutput: GetWithdrawalStatusOutput = {
        status: 'success',
        onChainTxHash: 'tron_hash_abc123',
      };
      provider.getWithdrawalStatus.mockResolvedValue(statusOutput);
      const service = new WalletService(
        provider,
        makeRepo(EXISTING_WALLET),
        makeClock(),
        makeAssetRegistry(),
      );

      const result = await service.getWithdrawalStatus(
        EXISTING_WALLET,
        'idem-key-success',
      );

      expect(result.status).toBe('success');
      expect(result.onChainTxHash).toBe('tron_hash_abc123');
    });

    it('returns failed when provider confirms failure', async () => {
      const provider = makeProvider();
      provider.getWithdrawalStatus.mockResolvedValue({ status: 'failed' });
      const service = new WalletService(
        provider,
        makeRepo(EXISTING_WALLET),
        makeClock(),
        makeAssetRegistry(),
      );

      const result = await service.getWithdrawalStatus(
        EXISTING_WALLET,
        'idem-key-failed',
      );

      expect(result.status).toBe('failed');
    });
  });
});
