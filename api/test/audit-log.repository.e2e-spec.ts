import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { AuditLogPrismaRepository } from '../src/core/audit/infrastructure/audit-log.prisma.repository';
import type { AppendAuditInput } from '../src/core/audit/application/ports/audit-log.repository.port';

import { startTestPostgres } from './helpers/pg-testcontainer';

let prisma: PrismaClient;
let stop: () => Promise<void>;
let repo: AuditLogPrismaRepository;

const adminId = randomUUID();

function input(over: Partial<AppendAuditInput> = {}): AppendAuditInput {
  return {
    correlationId: randomUUID(),
    actor: `admin:${adminId}`,
    actorAdminId: adminId,
    actorUserId: null,
    subject: 'Role:' + randomUUID(),
    action: 'admin_update',
    details: { k: 'v' },
    ...over,
  };
}

beforeAll(async () => {
  const t = await startTestPostgres();
  prisma = t.prisma;
  stop = t.stop;
  repo = new AuditLogPrismaRepository(prisma as unknown as PrismaService);
}, 180_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
});

describe('AuditLogPrismaRepository (integration)', () => {
  it('the genesis row links to the 64-char genesis sentinel', async () => {
    const res = await repo.append(input());
    expect(res.prevHash).toBe('0'.repeat(64));
    expect(res.currentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('each append links to the previous row currentHash', async () => {
    const first = await repo.append(input());
    const second = await repo.append(input());
    expect(second.prevHash).toBe(first.currentHash);
  });

  it('concurrent appends form a single unbroken chain (no fork)', async () => {
    await Promise.all(Array.from({ length: 12 }, () => repo.append(input())));
    const verify = await repo.verifyChain();
    expect(verify.ok).toBe(true);
    expect(verify.checked).toBe(12);
    expect(verify.brokenAt).toBeNull();
  });

  it('verifyChain detects a tampered row', async () => {
    await repo.append(input());
    const mid = await repo.append(input({ subject: 'Role:tamper-target' }));
    await repo.append(input());
    // Mutate the row's details out from under its hash.
    await prisma.auditLog.update({
      where: { id: mid.id },
      data: { details: { k: 'TAMPERED' } },
    });
    const verify = await repo.verifyChain();
    expect(verify.ok).toBe(false);
    expect(verify.brokenAt).toBe(mid.id);
  });

  it('list returns newest-first, filters by subject, and pages by cursor', async () => {
    const subject = 'Role:filter-me';
    for (let i = 0; i < 3; i++) await repo.append(input({ subject }));
    for (let i = 0; i < 2; i++) await repo.append(input()); // noise

    const page1 = await repo.list({ subject, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.items.every((x) => x.subject === subject)).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await repo.list({
      subject,
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });
});
