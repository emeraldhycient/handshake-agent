import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { AdminInvitationPrismaRepository } from '../src/modules/admin/infrastructure/admin-invitation.prisma.repository';

import { startTestPostgres } from './helpers/pg-testcontainer';

let prisma: PrismaClient;
let stop: () => Promise<void>;
let repo: AdminInvitationPrismaRepository;
let roleId: string;
let createdByAdminId: string;

const HOUR = 60 * 60 * 1000;

async function seedRoleAndAdmin(): Promise<{
  roleId: string;
  adminId: string;
}> {
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
  return { roleId: role.id, adminId: admin.id };
}

beforeAll(async () => {
  const t = await startTestPostgres();
  prisma = t.prisma;
  stop = t.stop;
  repo = new AdminInvitationPrismaRepository(
    prisma as unknown as PrismaService,
  );
}, 180_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  await prisma.adminInvitation.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.role.deleteMany();
  const seeded = await seedRoleAndAdmin();
  roleId = seeded.roleId;
  createdByAdminId = seeded.adminId;
});

describe('AdminInvitationPrismaRepository (integration)', () => {
  it('create returns the new invitation id, email and expiry', async () => {
    const addr = `${randomUUID()}@admin.test`;
    const expiresAt = new Date(Date.now() + HOUR);
    const created = await repo.create({
      email: addr,
      roleId,
      tokenHash: 'th',
      expiresAt,
      createdByAdminId,
      reason: 'new hire',
    });
    expect(created.email).toBe(addr);
    expect(created.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
  });

  it('findActiveByTokenHash returns an unaccepted, unexpired invitation', async () => {
    await repo.create({
      email: `${randomUUID()}@admin.test`,
      roleId,
      tokenHash: 'active',
      expiresAt: new Date(Date.now() + HOUR),
      createdByAdminId,
    });
    const found = await repo.findActiveByTokenHash('active', new Date());
    expect(found?.roleId).toBe(roleId);
  });

  it('findActiveByTokenHash EXCLUDES an accepted invitation', async () => {
    const created = await repo.create({
      email: `${randomUUID()}@admin.test`,
      roleId,
      tokenHash: 'accepted',
      expiresAt: new Date(Date.now() + HOUR),
      createdByAdminId,
    });
    await repo.markAccepted(created.id, new Date());
    expect(await repo.findActiveByTokenHash('accepted', new Date())).toBeNull();
  });

  it('findActiveByTokenHash EXCLUDES an expired invitation', async () => {
    await repo.create({
      email: `${randomUUID()}@admin.test`,
      roleId,
      tokenHash: 'expired',
      expiresAt: new Date(Date.now() - HOUR),
      createdByAdminId,
    });
    expect(await repo.findActiveByTokenHash('expired', new Date())).toBeNull();
  });

  it('countAdmins reflects the total AdminUser count', async () => {
    // One admin was seeded in beforeEach.
    expect(await repo.countAdmins()).toBe(1);

    const other = await prisma.role.create({
      data: {
        name: `role-${randomUUID()}`,
        description: 'r',
        isBuiltin: false,
      },
    });
    await prisma.adminUser.create({
      data: {
        email: `${randomUUID()}@admin.test`,
        passwordHash: 'h',
        roleId: other.id,
      },
    });
    expect(await repo.countAdmins()).toBe(2);
  });
});
