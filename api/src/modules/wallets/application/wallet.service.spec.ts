/**
 * Unit tests for WalletService (task 5.1).
 *
 * All external dependencies are mocked:
 *   - WALLET_PROVIDER → mock IWalletProvider
 *   - WALLET_REPOSITORY → mock IWalletRepository
 *   - CLOCK → stub returning a fixed Date
 *
 * TDD: tests written first (red), then WalletService is implemented.
 */

import type { Clock } from '../../../core/common/clock';
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
    create: jest.fn().mockResolvedValue(EXISTING_WALLET),
  };
}

function makeClock(): jest.Mocked<Clock> {
  return { now: jest.fn().mockReturnValue(FIXED_NOW) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WalletService', () => {
  // ── getOrProvisionUsdtTronWallet ─────────────────────────────────────────

  describe('getOrProvisionUsdtTronWallet', () => {
    it('returns existing wallet when found; does NOT call the provider', async () => {
      const provider = makeProvider();
      const repo = makeRepo(EXISTING_WALLET);
      const service = new WalletService(provider, repo, makeClock());

      const result = await service.getOrProvisionUsdtTronWallet(USER_ID);

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

      const service = new WalletService(provider, repo, clock);
      const result = await service.getOrProvisionUsdtTronWallet(USER_ID);

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
      const service = new WalletService(provider, repo, makeClock());

      const result1 = await service.getOrProvisionUsdtTronWallet(USER_ID);
      const result2 = await service.getOrProvisionUsdtTronWallet(USER_ID);

      expect(result1).toEqual(EXISTING_WALLET);
      expect(result2).toEqual(EXISTING_WALLET);
      expect(provider.provisionAddress).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('queries the repo with USDT and TRON constants', async () => {
      const provider = makeProvider();
      const repo = makeRepo(EXISTING_WALLET);
      const service = new WalletService(provider, repo, makeClock());

      await service.getOrProvisionUsdtTronWallet(USER_ID);

      expect(repo.findByUserAssetNetwork).toHaveBeenCalledWith(
        USER_ID,
        'USDT',
        'TRON',
      );
    });
  });

  // ── getBalance ───────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('delegates to the provider using wallet.providerReference', async () => {
      const provider = makeProvider();
      const repo = makeRepo(EXISTING_WALLET);
      const service = new WalletService(provider, repo, makeClock());

      const result = await service.getBalance(EXISTING_WALLET);

      expect(provider.getBalance).toHaveBeenCalledWith(PROVIDER_REF);
      expect(result).toEqual({ amount: '5.000000', decimals: 6 });
    });

    it('returns the balance output from the provider as-is', async () => {
      const provider = makeProvider();
      provider.getBalance.mockResolvedValue({
        amount: '100.000001',
        decimals: 6,
      });
      const service = new WalletService(provider, makeRepo(), makeClock());

      const result = await service.getBalance(EXISTING_WALLET);

      expect(result.amount).toBe('100.000001');
      expect(result.decimals).toBe(6);
    });
  });
});
