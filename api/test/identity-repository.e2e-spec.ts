/**
 * Integration test for IdentityPrismaRepository (task 2.1).
 *
 * Runs against a REAL Postgres via Testcontainers so all schema constraints
 * (partial unique, FK, enums) are verified. Requires Docker.
 *
 * Runs in the `test:e2e` lane (jest-e2e.json), NOT the default unit lane,
 * so a Docker-less machine does not fail `pnpm test`.
 */

import { PrismaClient } from '../generated/prisma/client';
import { IdentityPrismaRepository } from '../src/modules/identity/infrastructure/identity.prisma.repository';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

describe('IdentityPrismaRepository (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: IdentityPrismaRepository;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    // The repo injects PrismaService; PrismaService extends PrismaClient, so
    // passing the raw test PrismaClient works at runtime — only standard client
    // methods are used. The cast keeps TypeScript happy at the boundary.
    // Boundary cast: PrismaClient → PrismaService (safe; same API surface).
    repo = new IdentityPrismaRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await stop?.();
  });

  // ── Test 1: create → read back ───────────────────────────────────────────
  it('createContactWithChannelIdentity persists both rows and they read back via findActiveChannelIdentity', async () => {
    const input = {
      channel: 'whatsapp',
      channelAddress: '+2348000000099',
      normalizedPhone: '+2348000000099',
    };

    const { contact, channelIdentity } =
      await repo.createContactWithChannelIdentity(input);

    // Returned records are populated
    expect(contact.id).toBeTruthy();
    expect(contact.primaryChannel).toBe('whatsapp');
    expect(contact.primaryAddress).toBe('+2348000000099');
    expect(contact.status).toBe('active');
    expect(contact.linkedUserId).toBeNull();

    expect(channelIdentity.id).toBeTruthy();
    expect(channelIdentity.channel).toBe('whatsapp');
    expect(channelIdentity.channelAddress).toBe('+2348000000099');
    expect(channelIdentity.contactId).toBe(contact.id);
    expect(channelIdentity.userId).toBeNull();
    expect(channelIdentity.simSwapDetectedAt).toBeNull();

    // Round-trip: findActiveChannelIdentity returns the same row
    const found = await repo.findActiveChannelIdentity(
      'whatsapp',
      '+2348000000099',
    );
    expect(found).not.toBeNull();
    expect(found!.id).toBe(channelIdentity.id);
    expect(found!.contactId).toBe(contact.id);
    expect(found!.userId).toBeNull();

    // loadContact resolves the linked contact
    const loadedContact = await repo.loadContact(contact.id);
    expect(loadedContact).not.toBeNull();
    expect(loadedContact!.id).toBe(contact.id);
    expect(loadedContact!.primaryChannel).toBe('whatsapp');
  });

  // ── Test 2: seed a linked User CI and read back via loadUser ─────────────
  it('loadUser returns the seeded user when a CI points to a userId', async () => {
    // Seed: create a user + channelIdentity with userId set
    const user = await prisma.user.create({ data: {} });

    await prisma.channelIdentity.create({
      data: {
        channel: 'whatsapp',
        channelAddress: '+2348000000098',
        normalizedPhone: '+2348000000098',
        userId: user.id,
      },
    });

    // findActiveChannelIdentity returns the CI with userId set
    const ci = await repo.findActiveChannelIdentity(
      'whatsapp',
      '+2348000000098',
    );
    expect(ci).not.toBeNull();
    expect(ci!.userId).toBe(user.id);
    expect(ci!.contactId).toBeNull();

    // loadUser returns the seeded user record
    const loadedUser = await repo.loadUser(user.id);
    expect(loadedUser).not.toBeNull();
    expect(loadedUser!.id).toBe(user.id);
    expect(loadedUser!.status).toBe('provisional');
    expect(loadedUser!.kycStatus).toBe('not_started');
    expect(loadedUser!.kycTier).toBe('unverified');
    expect(loadedUser!.simSwapDetectedAt).toBeNull();
  });

  // ── Test 3: findActiveChannelIdentity returns null for unknown address ────
  it('findActiveChannelIdentity returns null for an unknown channel address', async () => {
    const result = await repo.findActiveChannelIdentity(
      'whatsapp',
      '+0000000000000',
    );
    expect(result).toBeNull();
  });

  // ── Test 4: loadUser returns null for unknown id ──────────────────────────
  it('loadUser returns null for an unknown user id', async () => {
    const result = await repo.loadUser('00000000-0000-7000-8000-000000000000');
    expect(result).toBeNull();
  });

  // ── Test 5: loadContact returns null for unknown id ───────────────────────
  it('loadContact returns null for an unknown contact id', async () => {
    const result = await repo.loadContact(
      '00000000-0000-7000-8000-000000000001',
    );
    expect(result).toBeNull();
  });

  // ── Test 6: partial unique index (channel, channelAddress) WHERE deletedAt IS NULL ──
  it('rejects a second ACTIVE ChannelIdentity with the same (channel, channelAddress); allows a soft-deleted duplicate', async () => {
    const addr = '+2348000000097';

    // First active row — should succeed.
    await prisma.channelIdentity.create({
      data: { channel: 'whatsapp', channelAddress: addr },
    });

    // Second active row with the same (channel, address) — partial unique rejects it.
    await expect(
      prisma.channelIdentity.create({
        data: { channel: 'whatsapp', channelAddress: addr },
      }),
    ).rejects.toThrow();

    // A soft-deleted (deletedAt set) row with the same pair is outside the
    // partial index predicate (WHERE deletedAt IS NULL) and must be accepted.
    await expect(
      prisma.channelIdentity.create({
        data: {
          channel: 'whatsapp',
          channelAddress: addr,
          deletedAt: new Date(),
        },
      }),
    ).resolves.toBeDefined();
  });
});
