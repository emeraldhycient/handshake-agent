/**
 * PrismaBackfillRunRepository — infrastructure implementation of IBackfillRunRepository (BQ-2).
 *
 * Counter increments use SELECT FOR UPDATE row-level locking to serialize
 * concurrent per-user BullMQ workers updating the shared BackfillRun row.
 * This avoids SERIALIZABLE SSI conflict storms on a single hot row.
 *
 * Architecture: infrastructure layer only — imports Prisma + PrismaService.
 */
import { Injectable } from '@nestjs/common';
import type {
  BackfillFailure,
  BackfillRunStatus,
  PerNetworkTally,
} from '@handshake-agent/contracts';

import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  BackfillCounterIncrement,
  BackfillRunRecord,
  CreateBackfillRunData,
  IBackfillRunRepository,
} from '../application/ports/backfill-run.repository.port';

@Injectable()
export class PrismaBackfillRunRepository implements IBackfillRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateBackfillRunData): Promise<BackfillRunRecord> {
    const row = await this.prisma.backfillRun.create({
      data: { dryRun: data.dryRun },
    });
    return this.toRecord(row);
  }

  async findById(id: string): Promise<BackfillRunRecord | null> {
    const row = await this.prisma.backfillRun.findUnique({ where: { id } });
    if (!row) return null;
    return this.toRecord(row);
  }

  async markStarted(id: string, totalUsers: number): Promise<void> {
    await this.prisma.backfillRun.update({
      where: { id },
      data: {
        status: 'running',
        totalUsers,
        startedAt: new Date(),
      },
    });
  }

  /**
   * Atomic counter increment using SELECT FOR UPDATE row-level locking.
   *
   * Takes an exclusive lock on the BackfillRun row within a READ COMMITTED
   * transaction, merges deltas in-process, and writes back. This serializes
   * concurrent workers on a single shared row without SERIALIZABLE isolation
   * conflicts, which makes it reliable under high parallelism.
   *
   * Why SELECT FOR UPDATE instead of SERIALIZABLE?
   *   - A single shared BackfillRun row is a hot spot for all concurrent workers.
   *   - SERIALIZABLE SSI with many concurrent writers exhausts retries quickly.
   *   - FOR UPDATE locks one row at a time with no conflict-detection overhead.
   */
  async incrementCounters(
    id: string,
    delta: BackfillCounterIncrement,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Lock the row exclusively to serialize concurrent counter updates.
      const rows = await tx.$queryRaw<
        Array<{
          scannedUsers: number;
          perNetwork: unknown;
          failures: unknown;
        }>
      >`SELECT "scannedUsers", "perNetwork", "failures"
        FROM "backfill_runs"
        WHERE id = ${id}::uuid
        FOR UPDATE`;

      if (rows.length === 0) {
        throw new Error(`BackfillRun not found: ${id}`);
      }

      const row = rows[0];
      const currentPerNetwork =
        (row.perNetwork as Record<string, PerNetworkTally>) ?? {};
      const currentFailures = (row.failures as BackfillFailure[]) ?? [];

      // Merge perNetwork delta additively.
      const newPerNetwork: Record<string, PerNetworkTally> = {
        ...currentPerNetwork,
      };
      for (const [network, tally] of Object.entries(
        delta.perNetworkDelta ?? {},
      )) {
        const existing = newPerNetwork[network] ?? {
          alreadyHad: 0,
          provisioned: 0,
        };
        newPerNetwork[network] = {
          alreadyHad: existing.alreadyHad + (tally.alreadyHad ?? 0),
          provisioned: existing.provisioned + (tally.provisioned ?? 0),
        };
      }

      // Append failure if provided.
      const newFailures = delta.failure
        ? [...currentFailures, delta.failure]
        : currentFailures;

      await tx.backfillRun.update({
        where: { id },
        data: {
          scannedUsers: { increment: delta.scannedUsers ?? 0 },
          perNetwork: newPerNetwork,
          failures: newFailures,
        },
      });
    });
  }

  async markCompleted(id: string): Promise<void> {
    await this.prisma.backfillRun.update({
      where: { id },
      data: { status: 'completed', completedAt: new Date() },
    });
  }

  async markFailed(id: string): Promise<void> {
    await this.prisma.backfillRun.update({
      where: { id },
      data: { status: 'failed', completedAt: new Date() },
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private toRecord(row: {
    id: string;
    status: string;
    dryRun: boolean;
    totalUsers: number;
    scannedUsers: number;
    perNetwork: unknown;
    failures: unknown;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  }): BackfillRunRecord {
    return {
      id: row.id,
      status: row.status as BackfillRunStatus,
      dryRun: row.dryRun,
      totalUsers: row.totalUsers,
      scannedUsers: row.scannedUsers,
      perNetwork: (row.perNetwork as Record<string, PerNetworkTally>) ?? {},
      failures: (row.failures as BackfillFailure[]) ?? [],
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    };
  }
}
