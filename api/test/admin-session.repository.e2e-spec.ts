import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { AdminSessionPrismaRepository } from '../src/modules/admin/infrastructure/admin-session.prisma.repository';

import { startTestPostgres } from './helpers/pg-testcontainer';

let prisma: PrismaClient;
let stop: () => Promise<void>;
let repo: AdminSessionPrismaRepository;
let adminUserId: string;

const HOUR = 60 * 60 * 1000;

async function seedAdmin(): Promise<string> {
  const role = await prisma.role.create({
    data: {
      name: `role-${randomUUID()}`,
      description: 'seed',
      isBuiltin: false,
    },
  });
  const admin = await prisma.adminUser.create({
    data: {
      email: `${randomUUID()}@admin.test`,
      passwordHash: 'h',
      roleId: role.id,
    },
  });
  return admin.id;
}

beforeAll(async () => {
  const t = await startTestPostgres();
  prisma = t.prisma;
  stop = t.stop;
  repo = new AdminSessionPrismaRepository(prisma as unknown as PrismaService);
}, 180_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  await prisma.adminSession.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.role.deleteMany();
  adminUserId = await seedAdmin();
});

describe('AdminSessionPrismaRepository (integration)', () => {
  it('create returns a non-revoked session with the given metadata', async () => {
    const session = await repo.create({
      adminUserId,
      tokenHash: 'th',
      expiresAt: new Date(Date.now() + HOUR),
      ipAddress: '1.2.3.4',
      userAgent: 'jest',
    });
    expect(session.adminUserId).toBe(adminUserId);
    expect(session.revokedAt).toBeNull();
    expect(session.stepUpCompletedAt).toBeNull();
    expect(session.ipAddress).toBe('1.2.3.4');
    expect(session.userAgent).toBe('jest');
  });

  it('findActiveByTokenHash returns an unrevoked, unexpired session', async () => {
    await repo.create({
      adminUserId,
      tokenHash: 'active',
      expiresAt: new Date(Date.now() + HOUR),
    });
    const found = await repo.findActiveByTokenHash('active', new Date());
    expect(found?.tokenHash).toBe('active');
  });

  it('findActiveByTokenHash EXCLUDES a revoked session', async () => {
    const session = await repo.create({
      adminUserId,
      tokenHash: 'revoked',
      expiresAt: new Date(Date.now() + HOUR),
    });
    await repo.revoke(session.id, new Date());
    const found = await repo.findActiveByTokenHash('revoked', new Date());
    expect(found).toBeNull();
  });

  it('findActiveByTokenHash EXCLUDES an expired session', async () => {
    await repo.create({
      adminUserId,
      tokenHash: 'expired',
      expiresAt: new Date(Date.now() - HOUR),
    });
    const found = await repo.findActiveByTokenHash('expired', new Date());
    expect(found).toBeNull();
  });

  it('recordStepUp stamps stepUpCompletedAt', async () => {
    const session = await repo.create({
      adminUserId,
      tokenHash: 'su',
      expiresAt: new Date(Date.now() + HOUR),
    });
    const at = new Date();
    await repo.recordStepUp(session.id, at);
    const found = await repo.findById(session.id);
    expect(found?.stepUpCompletedAt?.getTime()).toBe(at.getTime());
  });

  it('findById returns the session, or null when absent', async () => {
    const session = await repo.create({
      adminUserId,
      tokenHash: 'byid',
      expiresAt: new Date(Date.now() + HOUR),
    });
    expect((await repo.findById(session.id))?.id).toBe(session.id);
    expect(await repo.findById(randomUUID())).toBeNull();
  });

  it('listForAdmin returns all sessions for the admin', async () => {
    await repo.create({
      adminUserId,
      tokenHash: 'a',
      expiresAt: new Date(Date.now() + HOUR),
    });
    await repo.create({
      adminUserId,
      tokenHash: 'b',
      expiresAt: new Date(Date.now() + HOUR),
    });
    const sessions = await repo.listForAdmin(adminUserId);
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.adminUserId === adminUserId)).toBe(true);
  });

  it('revokeAllForAdmin revokes every active session for the admin', async () => {
    await repo.create({
      adminUserId,
      tokenHash: 'x',
      expiresAt: new Date(Date.now() + HOUR),
    });
    await repo.create({
      adminUserId,
      tokenHash: 'y',
      expiresAt: new Date(Date.now() + HOUR),
    });
    await repo.revokeAllForAdmin(adminUserId, new Date());

    const now = new Date();
    expect(await repo.findActiveByTokenHash('x', now)).toBeNull();
    expect(await repo.findActiveByTokenHash('y', now)).toBeNull();
  });
});
