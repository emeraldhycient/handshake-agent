/**
 * Prisma-backed IReconciliationRepository (Go-readiness #3).
 *
 * The durable reconciliation run + break store. Only this infrastructure file
 * imports the generated Prisma client (§3.2 / §4.1). `updateBreakStatus` writes
 * ONLY the disposition annotation columns — the detected facts are immutable
 * (§3.6); the immutability is proven by the integration test.
 */

import { Injectable } from '@nestjs/common';

import {
  ReconRunStatus,
  type Prisma,
} from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CompleteReconRunInput,
  CreateReconRunInput,
  IReconciliationRepository,
  ListReconRunsOptions,
  ReconBreakRecord,
  ReconBreakStatusValue,
  ReconRunPage,
  ReconRunRecord,
  RecordReconBreakInput,
  UpdateReconBreakStatusInput,
} from '../application/ports/reconciliation.repository.port';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RUN_SELECT = {
  id: true,
  runType: true,
  status: true,
  totalChecked: true,
  breaksDetected: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
} satisfies Prisma.ReconRunSelect;

const BREAK_SELECT = {
  id: true,
  reconRunId: true,
  breakType: true,
  userId: true,
  walletId: true,
  outboxId: true,
  currency: true,
  delta: true,
  status: true,
  approvedByAdminId: true,
  reason: true,
  actionAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ReconBreakSelect;

type RunRow = Prisma.ReconRunGetPayload<{ select: typeof RUN_SELECT }>;
type BreakRow = Prisma.ReconBreakGetPayload<{ select: typeof BREAK_SELECT }>;

@Injectable()
export class ReconciliationPrismaRepository implements IReconciliationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createRun(input: CreateReconRunInput): Promise<ReconRunRecord> {
    const row = await this.prisma.reconRun.create({
      data: {
        runType: input.runType,
        status: ReconRunStatus.running,
        startedAt: new Date(),
      },
      select: RUN_SELECT,
    });
    return toRunRecord(row);
  }

  async recordBreak(input: RecordReconBreakInput): Promise<ReconBreakRecord> {
    const row = await this.prisma.reconBreak.create({
      data: {
        reconRunId: input.reconRunId,
        breakType: input.breakType,
        userId: input.userId ?? null,
        walletId: input.walletId ?? null,
        outboxId: input.outboxId ?? null,
        currency: input.currency,
        delta: input.delta,
        status: input.status ?? 'detected',
      },
      select: BREAK_SELECT,
    });
    return toBreakRecord(row);
  }

  async completeRun(id: string, input: CompleteReconRunInput): Promise<void> {
    await this.prisma.reconRun.update({
      where: { id },
      data: {
        status: input.status,
        totalChecked: input.totalChecked,
        breaksDetected: input.breaksDetected,
        completedAt: new Date(),
      },
    });
  }

  async listRuns(options: ListReconRunsOptions): Promise<ReconRunPage> {
    // Keyset on (createdAt desc, id desc): resolve the cursor row's createdAt so
    // the page boundary is stable. An unknown/invalid cursor yields the first page.
    const anchor =
      options.cursor !== undefined && UUID_RE.test(options.cursor)
        ? await this.prisma.reconRun.findUnique({
            where: { id: options.cursor },
            select: { createdAt: true, id: true },
          })
        : null;

    const where: Prisma.ReconRunWhereInput =
      anchor !== null
        ? {
            OR: [
              { createdAt: { lt: anchor.createdAt } },
              { createdAt: anchor.createdAt, id: { lt: anchor.id } },
            ],
          }
        : {};

    const rows = await this.prisma.reconRun.findMany({
      where,
      select: RUN_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.limit + 1,
    });

    const hasMore = rows.length > options.limit;
    const items = hasMore ? rows.slice(0, options.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items: items.map(toRunRecord), nextCursor };
  }

  async findRun(id: string): Promise<ReconRunRecord | null> {
    if (!UUID_RE.test(id)) return null;
    const row = await this.prisma.reconRun.findUnique({
      where: { id },
      select: RUN_SELECT,
    });
    return row === null ? null : toRunRecord(row);
  }

  async listBreaksByRun(reconRunId: string): Promise<ReconBreakRecord[]> {
    const rows = await this.prisma.reconBreak.findMany({
      where: { reconRunId },
      select: BREAK_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toBreakRecord);
  }

  async findBreak(id: string): Promise<ReconBreakRecord | null> {
    if (!UUID_RE.test(id)) return null;
    const row = await this.prisma.reconBreak.findUnique({
      where: { id },
      select: BREAK_SELECT,
    });
    return row === null ? null : toBreakRecord(row);
  }

  async findBreaksByUser(
    userId: string,
    status?: ReconBreakStatusValue,
  ): Promise<ReconBreakRecord[]> {
    const rows = await this.prisma.reconBreak.findMany({
      where: {
        userId,
        ...(status !== undefined ? { status } : {}),
      },
      select: BREAK_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toBreakRecord);
  }

  async updateBreakStatus(
    id: string,
    input: UpdateReconBreakStatusInput,
  ): Promise<ReconBreakRecord> {
    // Only the disposition annotation is written — the detected facts (breakType,
    // delta, currency, id refs) are never touched (§3.6 immutability).
    const row = await this.prisma.reconBreak.update({
      where: { id },
      data: {
        status: input.status,
        approvedByAdminId: input.approvedByAdminId,
        reason: input.reason,
        actionAt: input.actionAt,
      },
      select: BREAK_SELECT,
    });
    return toBreakRecord(row);
  }
}

// ── mappers (row → record) ──────────────────────────────────────────────────────

function toRunRecord(row: RunRow): ReconRunRecord {
  return {
    id: row.id,
    runType: row.runType,
    status: row.status,
    totalChecked: row.totalChecked,
    breaksDetected: row.breaksDetected,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}

function toBreakRecord(row: BreakRow): ReconBreakRecord {
  return {
    id: row.id,
    reconRunId: row.reconRunId,
    breakType: row.breakType,
    userId: row.userId,
    walletId: row.walletId,
    outboxId: row.outboxId,
    currency: row.currency,
    delta: row.delta.toString(),
    status: row.status,
    approvedByAdminId: row.approvedByAdminId,
    reason: row.reason,
    actionAt: row.actionAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
