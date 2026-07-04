import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

import { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { ReconciliationPrismaRepository } from '../src/modules/transactions/infrastructure/reconciliation.prisma.repository';

/**
 * Go-readiness #3 integration test (Testcontainers Postgres) — proves the durable
 * reconciliation store's contract holds against a REAL database:
 *   • createRun persists a 'running' run; completeRun closes it with tallies
 *   • recordBreak persists a break FK'd to its run; listBreaksByRun reads it back
 *   • listRuns is keyset-paginated newest-first with a stable nextCursor
 *   • findBreaksByUser filters by user (+ optional status)
 *   • updateBreakStatus writes ONLY the disposition annotation — the detected
 *     facts (breakType/delta/currency/id refs/createdAt) are IMMUTABLE (§3.6)
 *
 * Requires Docker (Testcontainers). Runs in the `test:e2e` lane.
 */
const API_ROOT = join(__dirname, '..');
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

jest.setTimeout(180_000);

describe('ReconciliationPrismaRepository (integration, Testcontainers Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let repo: ReconciliationPrismaRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const url = container.getConnectionUri();

    execSync('node_modules/.bin/prisma migrate deploy', {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    });

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
    });
    await prisma.$connect();
    // The repo only touches prisma.reconRun / prisma.reconBreak delegates, which a
    // raw PrismaClient exposes; PrismaService extends PrismaClient at runtime.
    repo = new ReconciliationPrismaRepository(
      prisma as unknown as PrismaService,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('createRun persists a running run with a uuid7 id + startedAt', async () => {
    const run = await repo.createRun({ runType: 'settlement_outbox' });
    expect(run.id).toMatch(UUID_V7);
    expect(run.runType).toBe('settlement_outbox');
    expect(run.status).toBe('running');
    expect(run.totalChecked).toBe(0);
    expect(run.breaksDetected).toBe(0);
    expect(run.startedAt).toBeInstanceOf(Date);
    expect(run.completedAt).toBeNull();
  });

  it('recordBreak persists a break FK-linked to its run; completeRun closes the run', async () => {
    const run = await repo.createRun({ runType: 'wallet_deposit' });
    const userId = randomUUID();
    const walletId = randomUUID();

    const brk = await repo.recordBreak({
      reconRunId: run.id,
      breakType: 'over_credit',
      userId,
      walletId,
      currency: 'USDT',
      delta: '-50.5',
    });
    expect(brk.id).toMatch(UUID_V7);
    expect(brk.reconRunId).toBe(run.id);
    expect(brk.breakType).toBe('over_credit');
    expect(brk.userId).toBe(userId);
    expect(brk.walletId).toBe(walletId);
    expect(brk.outboxId).toBeNull();
    expect(brk.delta).toBe('-50.5');
    expect(brk.status).toBe('detected');

    await repo.completeRun(run.id, {
      status: 'completed',
      totalChecked: 3,
      breaksDetected: 1,
    });

    const closed = await repo.findRun(run.id);
    expect(closed?.status).toBe('completed');
    expect(closed?.totalChecked).toBe(3);
    expect(closed?.breaksDetected).toBe(1);
    expect(closed?.completedAt).toBeInstanceOf(Date);

    const breaks = await repo.listBreaksByRun(run.id);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].id).toBe(brk.id);
  });

  it('records a settlement_failure break carrying an outboxId (no user/wallet)', async () => {
    const run = await repo.createRun({ runType: 'settlement_outbox' });
    const outboxId = randomUUID();
    const brk = await repo.recordBreak({
      reconRunId: run.id,
      breakType: 'settlement_failure',
      outboxId,
      currency: 'NGN',
      delta: '0',
    });
    expect(brk.breakType).toBe('settlement_failure');
    expect(brk.outboxId).toBe(outboxId);
    expect(brk.userId).toBeNull();
    expect(brk.walletId).toBeNull();
  });

  it('listRuns is keyset-paginated newest-first with a stable nextCursor', async () => {
    // Three fresh runs; newest is created last.
    const a = await repo.createRun({ runType: 'settlement_outbox' });
    const b = await repo.createRun({ runType: 'settlement_outbox' });
    const c = await repo.createRun({ runType: 'settlement_outbox' });
    const ids = [a.id, b.id, c.id];

    const page1 = await repo.listRuns({ limit: 2 });
    expect(page1.items.length).toBe(2);
    expect(page1.nextCursor).not.toBeNull();
    // newest-first ordering: the two most recent of our three are c then b.
    const firstTwo = page1.items.map((r) => r.id);
    expect(firstTwo).toEqual([c.id, b.id]);

    // Walk the cursor until our oldest (a) shows up — no dup/skip across pages.
    const seen = new Set(page1.items.map((r) => r.id));
    let cursor = page1.nextCursor;
    let guard = 0;
    while (cursor && !seen.has(a.id) && guard < 20) {
      const next = await repo.listRuns({ limit: 2, cursor });
      next.items.forEach((r) => seen.add(r.id));
      cursor = next.nextCursor;
      guard += 1;
    }
    for (const id of ids) expect(seen.has(id)).toBe(true);
  });

  it('findBreaksByUser filters by user and optional status', async () => {
    const run = await repo.createRun({ runType: 'wallet_deposit' });
    const userId = randomUUID();
    const other = randomUUID();

    await repo.recordBreak({
      reconRunId: run.id,
      breakType: 'over_credit',
      userId,
      currency: 'USDT',
      delta: '-1',
    });
    await repo.recordBreak({
      reconRunId: run.id,
      breakType: 'balance_mismatch',
      userId,
      currency: 'USDT',
      delta: '2',
      status: 'resolved',
    });
    await repo.recordBreak({
      reconRunId: run.id,
      breakType: 'over_credit',
      userId: other,
      currency: 'USDT',
      delta: '-3',
    });

    const all = await repo.findBreaksByUser(userId);
    expect(all).toHaveLength(2);
    expect(all.every((b) => b.userId === userId)).toBe(true);

    const detected = await repo.findBreaksByUser(userId, 'detected');
    expect(detected).toHaveLength(1);
    expect(detected[0].breakType).toBe('over_credit');
  });

  it('updateBreakStatus writes ONLY the disposition annotation — detected facts are immutable', async () => {
    const run = await repo.createRun({ runType: 'wallet_deposit' });
    const brk = await repo.recordBreak({
      reconRunId: run.id,
      breakType: 'over_credit',
      userId: randomUUID(),
      walletId: randomUUID(),
      currency: 'USDT',
      delta: '-42.25',
    });
    const adminId = randomUUID();
    const actionAt = new Date();

    const updated = await repo.updateBreakStatus(brk.id, {
      status: 'resolved',
      approvedByAdminId: adminId,
      reason: 'Confirmed lagged provider balance; ledger authoritative.',
      actionAt,
    });

    // Disposition annotation applied.
    expect(updated.status).toBe('resolved');
    expect(updated.approvedByAdminId).toBe(adminId);
    expect(updated.reason).toContain('ledger authoritative');
    expect(updated.actionAt?.toISOString()).toBe(actionAt.toISOString());

    // Detected facts UNCHANGED (immutable, §3.6).
    expect(updated.id).toBe(brk.id);
    expect(updated.reconRunId).toBe(brk.reconRunId);
    expect(updated.breakType).toBe('over_credit');
    expect(updated.delta).toBe('-42.25');
    expect(updated.currency).toBe('USDT');
    expect(updated.userId).toBe(brk.userId);
    expect(updated.walletId).toBe(brk.walletId);
    expect(updated.createdAt.toISOString()).toBe(brk.createdAt.toISOString());
  });
});
