/**
 * BackfillRun repository integration test (BQ-2, Testcontainers Postgres).
 *
 * Scenario:
 *   1. Create a BackfillRun (queued).
 *   2. Mark started with totalUsers.
 *   3. Multiple concurrent incrementCounters — verify scannedUsers is correct
 *      (atomic increments, no lost updates).
 *   4. perNetwork delta merges additively.
 *   5. Failure appended to failures array.
 *   6. Mark completed / failed.
 *
 * Requires Docker.
 */

import { Logger } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { startTestPostgres } from './helpers/pg-testcontainer';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { PrismaBackfillRunRepository } from '../src/modules/wallets/infrastructure/backfill-run.prisma.repository';

jest.setTimeout(180_000);

describe('BackfillRun Repository (Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: PrismaBackfillRunRepository;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    ({ prisma, stop } = await startTestPostgres());
    const ps = prisma as unknown as PrismaService;
    repo = new PrismaBackfillRunRepository(ps);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await stop?.();
  });

  it('creates a run in queued status', async () => {
    const run = await repo.create({ dryRun: false });

    expect(run.id).toBeTruthy();
    expect(run.status).toBe('queued');
    expect(run.dryRun).toBe(false);
    expect(run.totalUsers).toBe(0);
    expect(run.scannedUsers).toBe(0);
    expect(run.perNetwork).toEqual({});
    expect(run.failures).toEqual([]);
    expect(run.startedAt).toBeNull();
    expect(run.completedAt).toBeNull();
  });

  it('creates a dryRun run', async () => {
    const run = await repo.create({ dryRun: true });
    expect(run.dryRun).toBe(true);
  });

  it('findById returns null for nonexistent id', async () => {
    const result = await repo.findById('00000000-0000-7000-0000-000000000099');
    expect(result).toBeNull();
  });

  it('findById returns the created run', async () => {
    const created = await repo.create({ dryRun: false });
    const found = await repo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.status).toBe('queued');
  });

  it('markStarted sets status=running, totalUsers, startedAt', async () => {
    const run = await repo.create({ dryRun: false });
    await repo.markStarted(run.id, 10);

    const updated = await repo.findById(run.id);
    expect(updated!.status).toBe('running');
    expect(updated!.totalUsers).toBe(10);
    expect(updated!.startedAt).not.toBeNull();
  });

  it('incrementCounters: scannedUsers increments atomically', async () => {
    const run = await repo.create({ dryRun: false });
    await repo.markStarted(run.id, 5);

    // Sequential increments to verify correct accumulation.
    await repo.incrementCounters(run.id, { scannedUsers: 1 });
    await repo.incrementCounters(run.id, { scannedUsers: 1 });
    await repo.incrementCounters(run.id, { scannedUsers: 1 });

    const updated = await repo.findById(run.id);
    expect(updated!.scannedUsers).toBe(3);
  });

  it('incrementCounters: concurrent increments are correct', async () => {
    const run = await repo.create({ dryRun: false });
    await repo.markStarted(run.id, 20);

    // Run 10 increments concurrently.
    await Promise.all(
      Array.from({ length: 10 }, () =>
        repo.incrementCounters(run.id, { scannedUsers: 1 }),
      ),
    );

    const updated = await repo.findById(run.id);
    expect(updated!.scannedUsers).toBe(10);
  });

  it('incrementCounters: perNetwork delta merges additively', async () => {
    const run = await repo.create({ dryRun: false });
    await repo.markStarted(run.id, 3);

    await repo.incrementCounters(run.id, {
      scannedUsers: 1,
      perNetworkDelta: { TRON: { alreadyHad: 1, provisioned: 0 } },
    });
    await repo.incrementCounters(run.id, {
      scannedUsers: 1,
      perNetworkDelta: { TRON: { alreadyHad: 0, provisioned: 1 } },
    });
    await repo.incrementCounters(run.id, {
      scannedUsers: 1,
      perNetworkDelta: { TRON: { alreadyHad: 0, provisioned: 1 } },
    });

    const updated = await repo.findById(run.id);
    expect(updated!.scannedUsers).toBe(3);
    expect(updated!.perNetwork['TRON']?.alreadyHad).toBe(1);
    expect(updated!.perNetwork['TRON']?.provisioned).toBe(2);
  });

  it('incrementCounters: appends failure to failures array', async () => {
    const run = await repo.create({ dryRun: false });
    await repo.markStarted(run.id, 2);

    await repo.incrementCounters(run.id, {
      scannedUsers: 1,
      failure: { userId: 'user-fail-1', error: 'Provider down' },
    });
    await repo.incrementCounters(run.id, {
      scannedUsers: 1,
      failure: { userId: 'user-fail-2', error: 'Timeout' },
    });

    const updated = await repo.findById(run.id);
    expect(updated!.scannedUsers).toBe(2);
    expect(updated!.failures).toHaveLength(2);
    expect(updated!.failures.map((f) => f.userId)).toContain('user-fail-1');
    expect(updated!.failures.map((f) => f.userId)).toContain('user-fail-2');
  });

  it('markCompleted sets status=completed, completedAt', async () => {
    const run = await repo.create({ dryRun: false });
    await repo.markStarted(run.id, 1);
    await repo.markCompleted(run.id);

    const updated = await repo.findById(run.id);
    expect(updated!.status).toBe('completed');
    expect(updated!.completedAt).not.toBeNull();
  });

  it('markFailed sets status=failed, completedAt', async () => {
    const run = await repo.create({ dryRun: false });
    await repo.markStarted(run.id, 1);
    await repo.markFailed(run.id);

    const updated = await repo.findById(run.id);
    expect(updated!.status).toBe('failed');
    expect(updated!.completedAt).not.toBeNull();
  });
});
