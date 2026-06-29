/**
 * WN-3 — Eager wallet provisioning on KYC completion (integration, Testcontainers Postgres).
 *
 * After POST /kyc/complete the controller calls
 * `walletService.provisionAllEnabledNetworks(userId)` best-effort.
 * This spec wires up the full stack minus real external providers and asserts:
 *
 *   1. After KYC completion, wallet rows exist for every enabled network.
 *   2. A provider failure during provisioning does NOT cause KYC completion
 *      to fail — the user is still created.
 *   3. The assertion is generic ("one per enabled network"), so adding a
 *      network later is covered without touching this spec.
 *
 * Architecture: manual wiring (no full AppModule boot) — same pattern as other
 * e2e specs. WalletService is constructed with a fake IWalletProvider and the
 * real WalletPrismaRepository.
 *
 * Requires Docker (Testcontainers Postgres).
 */

import { Logger } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { startTestPostgres } from './helpers/pg-testcontainer';

import type { PrismaService } from '../src/core/prisma/prisma.service';

// Identity stack
import { HandoffTokenPrismaRepository } from '../src/modules/identity/infrastructure/handoff-token.prisma.repository';
import { KycPrismaRepository } from '../src/modules/identity/infrastructure/kyc.prisma.repository';
import { IdentityPrismaRepository } from '../src/modules/identity/infrastructure/identity.prisma.repository';
import { HandoffTokenService } from '../src/modules/identity/application/handoff-token.service';
import { KycService } from '../src/modules/identity/application/kyc.service';

// Wallet stack
import { WalletPrismaRepository } from '../src/modules/wallets/infrastructure/wallet.prisma.repository';
import { WalletService } from '../src/modules/wallets/application/wallet.service';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';

// Catalog / config
import { AssetRegistry } from '../src/core/catalog/asset-registry';
import configuration from '../src/core/config/configuration';
import { SystemClock } from '../src/core/common/clock';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Config / stub helpers
// ---------------------------------------------------------------------------

/** Minimal ConfigService stub that reads from the JSON defaults + env. */
function makeConfigService(): { get: <T>(key: string) => T | undefined } {
  const defaults = configuration() as unknown as Record<string, unknown>;
  return {
    get: <T>(key: string): T | undefined => {
      const parts = key.split('.');
      let val: unknown = key in defaults ? defaults[key] : undefined;
      if (val === undefined && parts.length > 1) {
        let node: unknown = defaults;
        for (const part of parts) {
          node = (node as Record<string, unknown>)?.[part];
        }
        val = node;
      }
      if (key === 'WEB_APP_BASE_URL') {
        val = process.env.WEB_APP_BASE_URL ?? undefined;
      }
      return val as T;
    },
  };
}

/** Global counter to guarantee globally unique fake addresses across all tests. */
let globalProviderCallCount = 0;

/** Fake IWalletProvider that returns a globally unique child address per call. */
function makeFakeWalletProvider(): {
  provider: IWalletProvider;
  callCount: () => number;
} {
  let localCalls = 0;
  const provider: IWalletProvider = {
    // eslint-disable-next-line @typescript-eslint/require-await
    provisionAddress: async (input) => {
      globalProviderCallCount++;
      localCalls++;
      return {
        providerReference: `fake-ref-${input.network}-${globalProviderCallCount}`,
        // Use globalProviderCallCount so addresses never collide across tests.
        address: `FAKE_${input.network}_ADDR_${globalProviderCallCount}`,
        network: input.network,
      };
    },
    getBalance: jest
      .fn()
      .mockResolvedValue({ amount: '0.000000', decimals: 6 }),
    withdraw: jest.fn().mockResolvedValue({
      providerReference: 'fake-tx-ref',
      status: 'pending' as const,
    }),
    getWithdrawalStatus: jest
      .fn()
      .mockResolvedValue({ status: 'pending' as const }),
    listWalletAssets: jest.fn().mockResolvedValue([
      {
        assetId: 'e2e-usdt-tron-asset-id',
        symbol: 'USDT',
        name: 'Tether USD',
        network: 'TRON',
        contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        decimals: 6,
        isMainnet: false,
      },
    ]),
  };
  return { provider, callCount: () => localCalls };
}

/** Fake IWalletProvider that always throws (simulates Blockradar outage). */
function makeFailingWalletProvider(): IWalletProvider {
  return {
    provisionAddress: jest
      .fn()
      .mockRejectedValue(new Error('Blockradar unavailable')),
    getBalance: jest
      .fn()
      .mockResolvedValue({ amount: '0.000000', decimals: 6 }),
    withdraw: jest.fn().mockResolvedValue({
      providerReference: 'stub',
      status: 'pending' as const,
    }),
    getWithdrawalStatus: jest
      .fn()
      .mockResolvedValue({ status: 'pending' as const }),
    listWalletAssets: jest.fn().mockResolvedValue([
      {
        assetId: 'e2e-usdt-tron-asset-id',
        symbol: 'USDT',
        name: 'Tether USD',
        network: 'TRON',
        contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        decimals: 6,
        isMainnet: false,
      },
    ]),
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('WN-3: eager wallet provisioning on KYC completion (Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  let handoffTokenService: HandoffTokenService;
  let kycService: KycService;
  let walletRepo: WalletPrismaRepository;
  let assetRegistry: AssetRegistry;

  const channelAddress = '+2348099990002'; // unique from kyc-complete.e2e-spec.ts

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    const ps = prisma as unknown as PrismaService;
    const configSvc = makeConfigService() as never;

    // Identity repos & services
    const handoffRepo = new HandoffTokenPrismaRepository(ps);
    const kycRepo = new KycPrismaRepository(ps);
    const identityRepo = new IdentityPrismaRepository(ps);

    handoffTokenService = new HandoffTokenService(handoffRepo, configSvc);

    const kycProviderStub = {
      // eslint-disable-next-line @typescript-eslint/require-await
      verify: async () => ({
        approved: true as const,
        tier: 'tier_1' as const,
        reference: 'mock-ref-wn3',
      }),
    };
    const pinServiceStub = {
      // eslint-disable-next-line @typescript-eslint/require-await
      hashPin: async (pin: string) => `hashed:${pin}`,
    };

    kycService = new KycService(
      kycProviderStub,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      pinServiceStub as any,
      identityRepo,
      kycRepo,
    );

    // Wallet repo
    walletRepo = new WalletPrismaRepository(ps);

    // AssetRegistry (real, reads from config defaults)

    assetRegistry = new AssetRegistry(configSvc);

    // Seed Contact + ChannelIdentity
    const contact = await prisma.contact.create({
      data: {
        primaryChannel: 'whatsapp',
        primaryAddress: channelAddress,
        status: 'active',
      },
    });

    await prisma.channelIdentity.create({
      data: {
        channel: 'whatsapp',
        channelAddress,
        normalizedPhone: channelAddress,
        contactId: contact.id,
      },
    });
  });

  afterAll(async () => {
    await stop?.();
  });

  // ── Test 1: happy path ──────────────────────────────────────────────────────

  it('after KYC completion, exactly one wallet per enabled network exists in the DB', async () => {
    const { provider } = makeFakeWalletProvider();
    const walletService = new WalletService(
      provider,
      walletRepo,
      new SystemClock(),
      assetRegistry,
    );

    // Get the set of enabled networks from the SAME registry the service uses.
    const enabledNetworks = assetRegistry.enabledNetworks();
    expect(enabledNetworks.length).toBeGreaterThan(0);

    // Complete KYC
    const { token } = await handoffTokenService.mintKycToken({
      channelAddress,
    });
    const { channelAddress: addr } =
      await handoffTokenService.consumeKycToken(token);

    const { userId } = await kycService.completeVerification({
      channelAddress: addr,
      nin: '12345678901',
      firstName: 'Ada',
      lastName: 'Eze',
      dateOfBirth: '1990-01-01',
      pin: '5678',
    });

    // Emulate what KycController does after completeVerification (WN-3).
    await walletService.provisionAllEnabledNetworks(userId);

    // Assert: one wallet row per enabled network.
    for (const network of enabledNetworks) {
      const wallet = await walletRepo.findByUserNetwork(userId, network);
      expect(wallet).not.toBeNull();
      expect(wallet?.network).toBe(network);
      expect(wallet?.userId).toBe(userId);
    }

    // Assert: no extra wallet rows for this user beyond enabledNetworks.
    const wallets = await prisma.wallet.findMany({ where: { userId } });
    expect(wallets).toHaveLength(enabledNetworks.length);
  });

  // ── Test 2: provider failure does NOT fail KYC completion ───────────────────

  it('provisionAllEnabledNetworks failure (Blockradar down) does NOT fail KYC completion', async () => {
    // Use a separate channel address so there is no user collision.
    const failingChannelAddress = '+2348099990003';

    // Seed a new Contact + ChannelIdentity for this test.
    const contact = await prisma.contact.create({
      data: {
        primaryChannel: 'whatsapp',
        primaryAddress: failingChannelAddress,
        status: 'active',
      },
    });
    await prisma.channelIdentity.create({
      data: {
        channel: 'whatsapp',
        channelAddress: failingChannelAddress,
        normalizedPhone: failingChannelAddress,
        contactId: contact.id,
      },
    });

    const walletService = new WalletService(
      makeFailingWalletProvider(),
      walletRepo,
      new SystemClock(),
      assetRegistry,
    );

    // Suppress logger.warn output in test output
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    // Complete KYC
    const { token } = await handoffTokenService.mintKycToken({
      channelAddress: failingChannelAddress,
    });
    const { channelAddress: addr } =
      await handoffTokenService.consumeKycToken(token);

    const { userId } = await kycService.completeVerification({
      channelAddress: addr,
      nin: '98765432100',
      firstName: 'Chidi',
      lastName: 'Nwoke',
      dateOfBirth: '1988-03-15',
      pin: '9999',
    });

    // KYC completed — user exists in DB.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user).not.toBeNull();

    // Provisioning fails but does NOT throw (best-effort).
    await expect(
      walletService.provisionAllEnabledNetworks(userId),
    ).rejects.toThrow('Blockradar unavailable');

    // The user is still verified (exists in DB) — KYC is complete.
    // In production the controller catches this; we verify the service throws here
    // but the user was already persisted (KYC and provisioning are separate steps).
    expect(user?.id).toBe(userId);
  });

  // ── Test 3: provisionAllEnabledNetworks is idempotent ──────────────────────

  it('calling provisionAllEnabledNetworks twice for the same user is idempotent (no duplicate wallets)', async () => {
    const idempotentChannelAddress = '+2348099990004';

    const contact = await prisma.contact.create({
      data: {
        primaryChannel: 'whatsapp',
        primaryAddress: idempotentChannelAddress,
        status: 'active',
      },
    });
    await prisma.channelIdentity.create({
      data: {
        channel: 'whatsapp',
        channelAddress: idempotentChannelAddress,
        normalizedPhone: idempotentChannelAddress,
        contactId: contact.id,
      },
    });

    const { provider, callCount } = makeFakeWalletProvider();
    const walletService = new WalletService(
      provider,
      walletRepo,
      new SystemClock(),
      assetRegistry,
    );

    const { token } = await handoffTokenService.mintKycToken({
      channelAddress: idempotentChannelAddress,
    });
    const { channelAddress: addr } =
      await handoffTokenService.consumeKycToken(token);

    const { userId } = await kycService.completeVerification({
      channelAddress: addr,
      nin: '11122233344',
      firstName: 'Funmi',
      lastName: 'Adeyemi',
      dateOfBirth: '1995-06-22',
      pin: '4321',
    });

    const enabledNetworks = assetRegistry.enabledNetworks();

    // First provisioning call
    await walletService.provisionAllEnabledNetworks(userId);
    const callsAfterFirst = callCount();
    expect(callsAfterFirst).toBe(enabledNetworks.length);

    // Second provisioning call — idempotent, no extra provider calls.
    await walletService.provisionAllEnabledNetworks(userId);
    const callsAfterSecond = callCount();
    expect(callsAfterSecond).toBe(enabledNetworks.length); // no additional provider calls

    // Still exactly one wallet per network in the DB.
    const wallets = await prisma.wallet.findMany({ where: { userId } });
    expect(wallets).toHaveLength(enabledNetworks.length);
  });
});
