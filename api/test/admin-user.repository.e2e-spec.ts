import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { AdminUserPrismaRepository } from '../src/modules/admin/infrastructure/admin-user.prisma.repository';

import { startTestPostgres } from './helpers/pg-testcontainer';

let prisma: PrismaClient;
let stop: () => Promise<void>;
let repo: AdminUserPrismaRepository;
let roleId: string;

async function seedRole(): Promise<string> {
  const role = await prisma.role.create({
    data: {
      name: `role-${randomUUID()}`,
      description: 'seed',
      isBuiltin: false,
    },
  });
  return role.id;
}

function email(): string {
  return `${randomUUID()}@admin.test`;
}

beforeAll(async () => {
  const t = await startTestPostgres();
  prisma = t.prisma;
  stop = t.stop;
  repo = new AdminUserPrismaRepository(prisma as unknown as PrismaService);
}, 180_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  await prisma.adminUser.deleteMany();
  await prisma.role.deleteMany();
  roleId = await seedRole();
});

describe('AdminUserPrismaRepository (integration)', () => {
  it('createInvited creates a pending admin with no last login', async () => {
    const created = await repo.createInvited({ email: email(), roleId });
    expect(created.status).toBe('pending');
    expect(created.mfaEnabled).toBe(false);
    expect(created.mfaSecret).toBeNull();
    expect(created.mfaRecoveryCodes).toEqual([]);
    expect(created.lastLoginAt).toBeNull();
    expect(created.roleId).toBe(roleId);
  });

  it('findByEmail returns the unique row, or null when absent', async () => {
    const addr = email();
    await repo.createInvited({ email: addr, roleId });

    const found = await repo.findByEmail(addr);
    expect(found?.email).toBe(addr);

    const missing = await repo.findByEmail(email());
    expect(missing).toBeNull();
  });

  it('findById returns the row, or null when absent', async () => {
    const created = await repo.createInvited({ email: email(), roleId });
    const found = await repo.findById(created.id);
    expect(found?.id).toBe(created.id);
    expect(await repo.findById(randomUUID())).toBeNull();
  });

  it('list pages newest-first by cursor', async () => {
    for (let i = 0; i < 3; i++) {
      await repo.createInvited({ email: email(), roleId });
    }
    const page1 = await repo.list({ limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await repo.list({ limit: 2, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    const ids = [...page1.items, ...page2.items].map((x) => x.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('setStatus(suspended) sets the status and is reflected on read', async () => {
    const created = await repo.createInvited({ email: email(), roleId });
    await repo.setStatus(created.id, 'suspended', new Date());
    expect((await repo.findById(created.id))?.status).toBe('suspended');
  });

  it('setStatus(offboarded) sets offboardedAt on the row', async () => {
    const created = await repo.createInvited({ email: email(), roleId });
    const at = new Date();
    await repo.setStatus(created.id, 'offboarded', at);

    const row = await prisma.adminUser.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.status).toBe('offboarded');
    expect(row.offboardedAt?.getTime()).toBe(at.getTime());
  });

  it('updateRole reassigns the role', async () => {
    const created = await repo.createInvited({ email: email(), roleId });
    const other = await seedRole();
    await repo.updateRole(created.id, other);
    expect((await repo.findById(created.id))?.roleId).toBe(other);
  });

  it('setPasswordAndActivate activates the admin and stamps acceptedAt', async () => {
    const created = await repo.createInvited({ email: email(), roleId });
    const at = new Date();
    await repo.setPasswordAndActivate(created.id, 'argon2-hash', at);

    const row = await prisma.adminUser.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.status).toBe('active');
    expect(row.passwordHash).toBe('argon2-hash');
    expect(row.acceptedAt?.getTime()).toBe(at.getTime());
  });

  it('enableMfa stores the secret and recovery codes and flips the flag', async () => {
    const created = await repo.createInvited({ email: email(), roleId });
    await repo.enableMfa(created.id, 'enc-secret', ['h1', 'h2', 'h3']);

    const found = await repo.findById(created.id);
    expect(found?.mfaEnabled).toBe(true);
    expect(found?.mfaSecret).toBe('enc-secret');
    expect(found?.mfaRecoveryCodes).toEqual(['h1', 'h2', 'h3']);
  });

  it('consumeRecoveryCode removes exactly one matching code and returns true', async () => {
    const created = await repo.createInvited({ email: email(), roleId });
    await repo.enableMfa(created.id, 'enc', ['h1', 'h2', 'h3']);

    const consumed = await repo.consumeRecoveryCode(
      created.id,
      (h) => h === 'h2',
    );
    expect(consumed).toBe(true);
    expect((await repo.findById(created.id))?.mfaRecoveryCodes).toEqual([
      'h1',
      'h3',
    ]);
  });

  it('consumeRecoveryCode returns false and changes nothing when none match', async () => {
    const created = await repo.createInvited({ email: email(), roleId });
    await repo.enableMfa(created.id, 'enc', ['h1', 'h2']);

    const consumed = await repo.consumeRecoveryCode(
      created.id,
      (h) => h === 'nope',
    );
    expect(consumed).toBe(false);
    expect((await repo.findById(created.id))?.mfaRecoveryCodes).toEqual([
      'h1',
      'h2',
    ]);
  });

  it('recordLogin stamps lastLoginAt', async () => {
    const created = await repo.createInvited({ email: email(), roleId });
    const at = new Date();
    await repo.recordLogin(created.id, at);
    expect((await repo.findById(created.id))?.lastLoginAt?.getTime()).toBe(
      at.getTime(),
    );
  });
});
