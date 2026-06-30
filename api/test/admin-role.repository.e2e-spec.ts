import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { PermissionPrismaRepository } from '../src/modules/admin/infrastructure/permission.prisma.repository';
import { RolePrismaRepository } from '../src/modules/admin/infrastructure/role.prisma.repository';

import { startTestPostgres } from './helpers/pg-testcontainer';

let prisma: PrismaClient;
let stop: () => Promise<void>;
let repo: RolePrismaRepository;
let permissions: PermissionPrismaRepository;

const READ_USERS = 'api_route:GET /api/admin/users:read';
const WRITE_KYC = 'web_page:/admin/kyc-review:write';

async function seedCatalog(): Promise<void> {
  await permissions.upsertCatalog([
    {
      resourceType: 'api_route',
      resourceId: 'GET /api/admin/users',
      action: 'read',
      category: 'Admins',
      description: 'List admins',
    },
    {
      resourceType: 'web_page',
      resourceId: '/admin/kyc-review',
      action: 'write',
      category: 'Compliance',
      description: 'Review KYC',
    },
  ]);
}

beforeAll(async () => {
  const t = await startTestPostgres();
  prisma = t.prisma;
  stop = t.stop;
  repo = new RolePrismaRepository(prisma as unknown as PrismaService);
  permissions = new PermissionPrismaRepository(
    prisma as unknown as PrismaService,
  );
}, 180_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  await prisma.adminUser.deleteMany();
  await prisma.rolePermissionAssignment.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.role.deleteMany();
  await seedCatalog();
});

describe('RolePrismaRepository (integration)', () => {
  it('create resolves permissionIds to assignments; findById returns the canonical strings', async () => {
    const created = await repo.create({
      name: `role-${randomUUID()}`,
      description: 'desc',
      isBuiltin: false,
      permissionIds: [READ_USERS, WRITE_KYC],
    });

    const found = await repo.findById(created.id);
    expect(found?.permissionIds.sort()).toEqual([READ_USERS, WRITE_KYC].sort());
  });

  it('create ignores permissionIds with no matching Permission row', async () => {
    const created = await repo.create({
      name: `role-${randomUUID()}`,
      description: 'desc',
      isBuiltin: false,
      permissionIds: [READ_USERS, 'api_route:DOES NOT EXIST:delete'],
    });
    const found = await repo.findById(created.id);
    expect(found?.permissionIds).toEqual([READ_USERS]);
  });

  it('findByName returns the role with its permissions', async () => {
    const name = `role-${randomUUID()}`;
    await repo.create({
      name,
      description: 'desc',
      isBuiltin: true,
      permissionIds: [READ_USERS],
    });
    const found = await repo.findByName(name);
    expect(found?.isBuiltin).toBe(true);
    expect(found?.permissionIds).toEqual([READ_USERS]);
    expect(await repo.findByName('nope')).toBeNull();
  });

  it('list returns every role with permissions', async () => {
    await repo.create({
      name: `role-${randomUUID()}`,
      description: 'a',
      isBuiltin: false,
      permissionIds: [READ_USERS],
    });
    await repo.create({
      name: `role-${randomUUID()}`,
      description: 'b',
      isBuiltin: false,
      permissionIds: [WRITE_KYC],
    });
    const all = await repo.list();
    expect(all).toHaveLength(2);
    expect(all.flatMap((r) => r.permissionIds).sort()).toEqual(
      [READ_USERS, WRITE_KYC].sort(),
    );
  });

  it('update replaces the assignments when permissionIds is given', async () => {
    const created = await repo.create({
      name: `role-${randomUUID()}`,
      description: 'desc',
      isBuiltin: false,
      permissionIds: [READ_USERS],
    });
    await repo.update(created.id, { permissionIds: [WRITE_KYC] });
    const found = await repo.findById(created.id);
    expect(found?.permissionIds).toEqual([WRITE_KYC]);
  });

  it('update changes only the description when permissionIds is omitted', async () => {
    const created = await repo.create({
      name: `role-${randomUUID()}`,
      description: 'old',
      isBuiltin: false,
      permissionIds: [READ_USERS],
    });
    await repo.update(created.id, { description: 'new' });
    const found = await repo.findById(created.id);
    expect(found?.description).toBe('new');
    expect(found?.permissionIds).toEqual([READ_USERS]);
  });

  it('countAdmins counts admins assigned to the role', async () => {
    const created = await repo.create({
      name: `role-${randomUUID()}`,
      description: 'desc',
      isBuiltin: false,
      permissionIds: [],
    });
    expect(await repo.countAdmins(created.id)).toBe(0);

    await prisma.adminUser.create({
      data: {
        email: `${randomUUID()}@admin.test`,
        passwordHash: 'h',
        roleId: created.id,
      },
    });
    await prisma.adminUser.create({
      data: {
        email: `${randomUUID()}@admin.test`,
        passwordHash: 'h',
        roleId: created.id,
      },
    });
    expect(await repo.countAdmins(created.id)).toBe(2);
  });
});
