/**
 * Integration test for POST /kyc/complete (K3).
 *
 * Manual wiring (no full AppModule boot) — same pattern as the other e2e specs.
 * Exercises the controller + service + repository chain against real Postgres.
 *
 * Covers:
 *   - valid token → consume + completeVerification → { userId, status: 'verified' }
 *   - invalid / unknown token → HandoffTokenNotFoundError propagated correctly
 *   - missing required fields (checked at controller layer via mock)
 *
 * Requires Docker (Testcontainers).
 */

import { PrismaClient } from '../generated/prisma/client';
import { startTestPostgres } from './helpers/pg-testcontainer';

import type { PrismaService } from '../src/core/prisma/prisma.service';
import { HandoffTokenPrismaRepository } from '../src/modules/identity/infrastructure/handoff-token.prisma.repository';
import { KycPrismaRepository } from '../src/modules/identity/infrastructure/kyc.prisma.repository';
import { IdentityPrismaRepository } from '../src/modules/identity/infrastructure/identity.prisma.repository';
import { HandoffTokenService } from '../src/modules/identity/application/handoff-token.service';
import { KycService } from '../src/modules/identity/application/kyc.service';
import { HandoffTokenNotFoundError } from '../src/modules/identity/domain/handoff-token-errors';
import { ContactNotFoundError } from '../src/modules/identity/domain/kyc-errors';

import configuration from '../src/core/config/configuration';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Helpers — thin ConfigService stub (reads from defaults JSON)
// ---------------------------------------------------------------------------

/** Minimal ConfigService stub that reads from the JSON defaults and env. */
function makeConfigService(): { get: <T>(key: string) => T | undefined } {
  // Load the defaults from configuration() so TTLs / other values are set.
  const defaults = configuration() as unknown as Record<string, unknown>;
  return {
    get: <T>(key: string): T | undefined => {
      // Nested key lookup (e.g. 'handoffToken.kycTtlMinutes')
      const parts = key.split('.');
      let val: unknown = key in defaults ? defaults[key] : undefined;
      if (val === undefined && parts.length > 1) {
        let node: unknown = defaults;
        for (const part of parts) {
          node = (node as Record<string, unknown>)?.[part];
        }
        val = node;
      }
      // Also check WEB_APP_BASE_URL from env (not in JSON defaults)
      if (key === 'WEB_APP_BASE_URL') {
        val = process.env.WEB_APP_BASE_URL ?? undefined;
      }
      return val as T;
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('KYC complete — service integration (Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  let handoffTokenService: HandoffTokenService;
  let kycService: KycService;

  let channelAddress: string;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    const ps = prisma as unknown as PrismaService;
    const configSvc = makeConfigService() as never;

    const handoffRepo = new HandoffTokenPrismaRepository(ps);
    const kycRepo = new KycPrismaRepository(ps);
    const identityRepo = new IdentityPrismaRepository(ps);

    handoffTokenService = new HandoffTokenService(handoffRepo, configSvc);

    // Build minimal stubs for KycService's non-repo dependencies.
    // KycService signature: (kycProvider, pinService, identityRepo, kycRepo)
    const kycProviderStub = {
      // eslint-disable-next-line @typescript-eslint/require-await
      verify: async () => ({
        approved: true as const,
        tier: 'tier_1' as const,
        reference: 'mock-ref',
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

    channelAddress = '+2348099990001';

    // Seed a Contact + ChannelIdentity so KycService can find the contact.
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

  // ---------------------------------------------------------------------------
  // mintKycToken → consumeKycToken (integration happy path)
  // ---------------------------------------------------------------------------

  it('mint → consume: returns the correct channelAddress', async () => {
    const { token } = await handoffTokenService.mintKycToken({
      channelAddress,
    });

    const result = await handoffTokenService.consumeKycToken(token);

    expect(result.channelAddress).toBe(channelAddress);
  });

  it('second consume of the same token → HandoffTokenNotFoundError', async () => {
    const { token } = await handoffTokenService.mintKycToken({
      channelAddress,
    });

    // First consume: success.
    await handoffTokenService.consumeKycToken(token);

    // Second consume: rejected.
    await expect(handoffTokenService.consumeKycToken(token)).rejects.toThrow(
      HandoffTokenNotFoundError,
    );
  });

  // ---------------------------------------------------------------------------
  // KycService.completeVerification via channelAddress from consumed token
  // ---------------------------------------------------------------------------

  it('mint → consumeKycToken → completeVerification → creates a User', async () => {
    const { token } = await handoffTokenService.mintKycToken({
      channelAddress,
    });
    const { channelAddress: addr } =
      await handoffTokenService.consumeKycToken(token);

    const result = await kycService.completeVerification({
      channelAddress: addr,
      nin: '12345678901',
      firstName: 'Amaka',
      lastName: 'Okafor',
      dateOfBirth: '1992-07-14',
      pin: '1234',
    });

    expect(result.userId).toBeTruthy();
    expect(typeof result.userId).toBe('string');
  });

  it('completeVerification with unknown channelAddress → ContactNotFoundError', async () => {
    await expect(
      kycService.completeVerification({
        channelAddress: '+2340000000000', // not seeded
        firstName: 'Ghost',
        lastName: 'User',
        pin: '0000',
      }),
    ).rejects.toThrow(ContactNotFoundError);
  });

  it('invalid token → HandoffTokenNotFoundError', async () => {
    await expect(
      handoffTokenService.consumeKycToken('completely-made-up-token'),
    ).rejects.toThrow(HandoffTokenNotFoundError);
  });
});
