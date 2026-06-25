/**
 * AdminWalletsController — admin-only wallet management endpoints (WN-5, BQ-2).
 *
 * POST /admin/wallets/backfill-networks
 *   Enqueues an async wallet-network backfill (BQ-2). Creates a BackfillRun
 *   record, enqueues the coordinate job, and returns { runId } (HTTP 202).
 *   The coordinator fans out per-user provision-user jobs via BullMQ.
 *
 * GET /admin/wallets/backfill-runs/:id
 *   Returns the current state of a BackfillRun (for admin UI polling / CLI).
 *
 * Guard: AdminTokenGuard (Bearer <ADMIN_API_TOKEN>). Fail-closed:
 *   - ADMIN_API_TOKEN unset → every request is denied (403). The endpoint ships
 *     disabled and unexploitable by default.
 *
 * Admin UI hookup seam:
 *   When the admin UI + proper admin-session auth is built, swap AdminTokenGuard
 *   for the session/role guard here (and in AdminModule providers).
 *
 * Architecture: presentation layer only. No Prisma, no domain logic, no agent.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import type {
  BackfillRunStatusDto,
  EnqueueBackfillResponse,
} from '@handshake-agent/contracts';

import { AdminTokenGuard } from '../guards/admin-token.guard';
import {
  BACKFILL_RUN_REPOSITORY,
  type IBackfillRunRepository,
} from '../../wallets/application/ports/backfill-run.repository.port';
import {
  WALLET_BACKFILL_QUEUE_NAME,
  WALLET_BACKFILL_JOB,
} from '../../wallets/application/wallet-backfill-queue.constants';
import type { CoordinateBackfillPayload } from '../../wallets/infrastructure/coordinate-backfill.processor';
import { EnqueueBackfillDto } from './dto/enqueue-backfill.dto';

/** Default page size for the coordinator's user cursor scan. */
const DEFAULT_BATCH_SIZE = 100;

@Controller('admin/wallets')
@UseGuards(AdminTokenGuard)
export class AdminWalletsController {
  constructor(
    @Inject(BACKFILL_RUN_REPOSITORY)
    private readonly runRepo: IBackfillRunRepository,
    @InjectQueue(WALLET_BACKFILL_QUEUE_NAME)
    private readonly backfillQueue: Queue,
  ) {}

  /**
   * POST /admin/wallets/backfill-networks
   *
   * Enqueues an async backfill. Returns { runId } (HTTP 202).
   * Poll GET /admin/wallets/backfill-runs/:runId for progress.
   */
  @Post('backfill-networks')
  @HttpCode(HttpStatus.ACCEPTED)
  async backfillNetworks(
    @Body() dto: EnqueueBackfillDto,
  ): Promise<EnqueueBackfillResponse> {
    const dryRun = dto.dryRun ?? false;
    const batchSize = dto.batchSize ?? DEFAULT_BATCH_SIZE;

    // Create a durable BackfillRun record (status=queued).
    const run = await this.runRepo.create({ dryRun });

    // Enqueue the coordinator job.
    const payload: CoordinateBackfillPayload = {
      runId: run.id,
      dryRun,
      batchSize,
    };

    await this.backfillQueue.add(WALLET_BACKFILL_JOB.COORDINATE, payload, {
      jobId: `coordinate:${run.id}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
    });

    return { runId: run.id };
  }

  /**
   * GET /admin/wallets/backfill-runs/:id
   *
   * Returns the current status of a BackfillRun. 404 when not found.
   */
  @Get('backfill-runs/:id')
  async getBackfillRun(@Param('id') id: string): Promise<BackfillRunStatusDto> {
    const run = await this.runRepo.findById(id);
    if (!run) {
      throw new NotFoundException(`BackfillRun ${id} not found`);
    }

    return {
      id: run.id,
      status: run.status,
      dryRun: run.dryRun,
      totalUsers: run.totalUsers,
      scannedUsers: run.scannedUsers,
      perNetwork: run.perNetwork,
      failures: run.failures,
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
    };
  }
}
