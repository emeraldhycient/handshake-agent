import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { PermissionPrismaRepository } from '../src/modules/admin/infrastructure/permission.prisma.repository';
import { RolePrismaRepository } from '../src/modules/admin/infrastructure/role.prisma.repository';
import type { PermissionCatalogEntry } from '../src/modules/admin/application/ports/permission.repository.port';

import { startTestPostgres } from './helpers/pg-testcontainer';

let prisma: PrismaClient;
let stop: () => Promise<void>;
let repo: PermissionPrismaRepository;
let roles: RolePrismaRepository;

function catalog(): PermissionCatalogEntry[] {
  return [
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
  ];
}

beforeAll(async () => {
  const t = await startTestPostgres();
  prisma = t.prisma;
  stop = t.stop;
  repo = new PermissionPrismaRepository(prisma as unknown as PrismaService);
  roles = new RolePrismaRepository(prisma as unknown as PrismaService);
}, 180_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  await prisma.rolePermissionAssignment.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.role.deleteMany();
});

describe('PermissionPrismaRepository (integration)', () => {
  it('upsertCatalog is idempotent — running it twice yields the same row count', async () => {
    await repo.upsertCatalog(catalog());
    const after1 = await repo.list();
    expect(after1).toHaveLength(2);

    await repo.upsertCatalog(catalog());
    const after2 = await repo.list();
    expect(after2).toHaveLength(2);
  });

  it('upsertCatalog refreshes description/category for an existing key', async () => {
    await repo.upsertCatalog(catalog());
    await repo.upsertCatalog([
      {
        resourceType: 'api_route',
        resourceId: 'GET /api/admin/users',
        action: 'read',
        category: 'Admins',
        description: 'Updated description',
      },
    ]);
    const updated = (await repo.list()).find(
      (p) => p.resourceId === 'GET /api/admin/users',
    );
    expect(updated?.description).toBe('Updated description');
  });

  it('list returns catalog rows with their canonical fields', async () => {
    await repo.upsertCatalog(catalog());
    const all = await repo.list();
    const route = all.find((p) => p.resourceType === 'api_route');
    expect(route).toMatchObject({
      resourceType: 'api_route',
      resourceId: 'GET /api/admin/users',
      action: 'read',
      category: 'Admins',
    });
  });

  it('findByRole returns only the permissions assigned to the role', async () => {
    await repo.upsertCatalog(catalog());
    const role = await roles.create({
      name: `role-${randomUUID()}`,
      description: 'r',
      isBuiltin: false,
      permissionIds: ['api_route:GET /api/admin/users:read'],
    });

    const assigned = await repo.findByRole(role.id);
    expect(assigned).toHaveLength(1);
    expect(assigned[0].resourceId).toBe('GET /api/admin/users');

    expect(await repo.findByRole(randomUUID())).toEqual([]);
  });
});
