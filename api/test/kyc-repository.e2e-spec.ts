/**
 * Integration test for KycPrismaRepository (K2).
 *
 * Runs against a REAL Postgres via Testcontainers — all DB constraints, FK
 * integrity, enum values, and $transaction atomicity are exercised.
 * Requires Docker.
 *
 * Also verifies end-to-end that PinService.verifyPin works on the pinHash
 * produced during completeVerificationAtomic (golden-path security check).
 *
 * Runs in the `test:e2e` lane (jest-e2e.json), NOT the default unit lane,
 * so a Docker-less machine does not fail `pnpm test`.
 */

import { ConfigService } from '@nestjs/config';

import { PrismaClient } from '../generated/prisma/client';
import { PinService } from '../src/core/auth/pin.service';
import { PinPrismaRepository } from '../src/core/auth/infrastructure/pin.prisma.repository';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import type { Clock } from '../src/core/common/clock';
import { KycPrismaRepository } from '../src/modules/identity/infrastructure/kyc.prisma.repository';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 32-byte AES key (64 hex chars) used to encrypt NIN/BVN at rest (NFR-1). */
const KYC_ENCRYPTION_KEY = 'a'.repeat(64);

/**
 * Stub ConfigService for PinService (scrypt key length etc.) and
 * KycPrismaRepository (KYC_ENCRYPTION_KEY for NIN/BVN field encryption).
 */
function makeConfigService(): ConfigService {
  return {
    get: (key: string) => {
      const cfg: Record<string, unknown> = {
        'auth.pin.maxAttempts': 5,
        'auth.pin.lockoutMinutes': 15,
        'auth.pin.scryptKeyLen': 64,
        KYC_ENCRYPTION_KEY,
      };
      return cfg[key];
    },
  } as unknown as ConfigService;
}

/** Fixed clock for PinService. */
const CLOCK: Clock = { now: () => new Date() };

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('KycPrismaRepository (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: KycPrismaRepository;
  let pinService: PinService;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    // Boundary cast: PrismaClient → PrismaService (same API surface at runtime).
    repo = new KycPrismaRepository(
      prisma as unknown as PrismaService,
      makeConfigService(),
    );

    const pinRepo = new PinPrismaRepository(prisma as unknown as PrismaService);
    pinService = new PinService(pinRepo, makeConfigService(), CLOCK);
  });

  afterAll(async () => {
    await stop?.();
  });

  /**
   * Seeds an unlinked Contact + ChannelIdentity and returns their ids.
   */
  async function seedContactAndCI(phone: string): Promise<{
    contactId: string;
    channelIdentityId: string;
  }> {
    const contact = await prisma.contact.create({
      data: {
        primaryChannel: 'whatsapp',
        primaryAddress: phone,
      },
      select: { id: true },
    });

    const ci = await prisma.channelIdentity.create({
      data: {
        channel: 'whatsapp',
        channelAddress: phone,
        normalizedPhone: phone,
        contactId: contact.id,
      },
      select: { id: true },
    });

    return { contactId: contact.id, channelIdentityId: ci.id };
  }

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('completeVerificationAtomic creates User(verified,tier_1), KycProfile(verified), links Contact + CI, PIN round-trips', async () => {
    const phone = '+2348099000001';
    const { contactId, channelIdentityId } = await seedContactAndCI(phone);
    const rawPin = '4321';

    // Hash the PIN exactly as KycService would
    const pinHash = await pinService.hashPin(rawPin);

    const now = new Date();
    const { userId } = await repo.completeVerificationAtomic({
      channelIdentityId,
      contactId,
      nin: '10000000001',
      bvn: undefined,
      firstName: 'Ngozi',
      lastName: 'Adeyemi',
      dateOfBirth: '1988-03-20',
      pinHash,
      now,
    });

    // ── Assert User ───────────────────────────────────────────────────────────
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        kycStatus: true,
        kycTier: true,
        pinHash: true,
      },
    });
    expect(user).not.toBeNull();
    expect(user!.status).toBe('active');
    expect(user!.kycStatus).toBe('verified');
    expect(user!.kycTier).toBe('tier_1');
    expect(user!.pinHash).toBe(pinHash);

    // ── Assert KycProfile ─────────────────────────────────────────────────────
    const profile = await prisma.kycProfile.findUnique({
      where: { userId },
      select: {
        status: true,
        tier: true,
        nin: true,
        firstName: true,
        lastName: true,
        verifiedAt: true,
      },
    });
    expect(profile).not.toBeNull();
    expect(profile!.status).toBe('verified');
    expect(profile!.tier).toBe('tier_1');
    // NFR-1: NIN is stored encrypted (ciphertext), never as plaintext, and
    // decrypts back to the original via the repo's read path.
    expect(profile!.nin).not.toBe('10000000001');
    expect(profile!.nin).toMatch(/^v1\./);
    expect(repo.decryptIdentifier(profile!.nin)).toBe('10000000001');
    expect(profile!.firstName).toBe('Ngozi');
    expect(profile!.lastName).toBe('Adeyemi');
    expect(profile!.verifiedAt).not.toBeNull();
    // verifiedAt should be close to `now`
    expect(
      Math.abs(profile!.verifiedAt!.getTime() - now.getTime()),
    ).toBeLessThan(5000);

    // ── Assert Contact linked ─────────────────────────────────────────────────
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { linkedUserId: true },
    });
    expect(contact).not.toBeNull();
    expect(contact!.linkedUserId).toBe(userId);

    // ── Assert ChannelIdentity linked + verified ──────────────────────────────
    const ci = await prisma.channelIdentity.findUnique({
      where: { id: channelIdentityId },
      select: {
        userId: true,
        contactId: true,
        verificationStatus: true,
        verifiedAt: true,
      },
    });
    expect(ci).not.toBeNull();
    expect(ci!.userId).toBe(userId);
    // CI now points to User; contactId is cleared
    expect(ci!.contactId).toBeNull();
    expect(ci!.verificationStatus).toBe('verified');
    expect(ci!.verifiedAt).not.toBeNull();

    // ── PIN round-trip: PinService.verifyPin resolves with the hashed PIN ─────
    // verifyPin loads pinHash from DB via PinPrismaRepository + User row
    await expect(pinService.verifyPin(userId, rawPin)).resolves.toBeUndefined();

    // Wrong PIN must reject
    await expect(pinService.verifyPin(userId, '0000')).rejects.toBeDefined();
  });

  // ── Isolation: second contact → separate User, no cross-contamination ──────

  it('two independent contacts produce two separate Users with no cross-contamination', async () => {
    const phone1 = '+2348099000002';
    const phone2 = '+2348099000003';

    const seed1 = await seedContactAndCI(phone1);
    const seed2 = await seedContactAndCI(phone2);

    const pin1 = await pinService.hashPin('1111');
    const pin2 = await pinService.hashPin('2222');

    const now = new Date();

    const { userId: uid1 } = await repo.completeVerificationAtomic({
      channelIdentityId: seed1.channelIdentityId,
      contactId: seed1.contactId,
      nin: '20000000001',
      bvn: undefined,
      firstName: 'Ada',
      lastName: 'Eze',
      dateOfBirth: undefined,
      pinHash: pin1,
      now,
    });

    const { userId: uid2 } = await repo.completeVerificationAtomic({
      channelIdentityId: seed2.channelIdentityId,
      contactId: seed2.contactId,
      nin: undefined,
      bvn: '30000000002',
      firstName: 'Bode',
      lastName: 'Adele',
      dateOfBirth: '1995-11-01',
      pinHash: pin2,
      now,
    });

    expect(uid1).not.toBe(uid2);

    // Each user's PIN only works for themselves
    await expect(pinService.verifyPin(uid1, '1111')).resolves.toBeUndefined();
    await expect(pinService.verifyPin(uid2, '2222')).resolves.toBeUndefined();

    // Cross-verify must fail
    await expect(pinService.verifyPin(uid1, '2222')).rejects.toBeDefined();
    await expect(pinService.verifyPin(uid2, '1111')).rejects.toBeDefined();
  });
});
