/**
 * ProvisionUserProcessor — BullMQ processor for the `provision-user` job (BQ-2).
 *
 * Responsibility per job:
 *   - dryRun=false: calls WalletService.provisionAllEnabledNetworks(userId) (idempotent),
 *     then increments BackfillRun counters (scannedUsers + perNetworkDelta).
 *   - dryRun=true:  inspects the wallet repo to tally missing networks, increments
 *     counters, but does NOT call the WaaS provider.
 *   - On unrecoverable error: throws so BullMQ retries with exponential backoff.
 *     After all attempts exhausted, OnWorkerEvent('failed') appends to BackfillRun.failures.
 *   - Checks scannedUsers === totalUsers after each increment; if equal → markCompleted.
 *
 * Rate-limit / concurrency: configured on the queue in WorkerModule (N jobs/sec).
 *
 * Lives in WorkerModule (consumer side) — never imported by AppModule.
 */
import { Inject, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import {
  WALLET_REPOSITORY,
  type IWalletRepository,
} from '../application/ports/wallet.repository.port';
import {
  BACKFILL_RUN_REPOSITORY,
  type IBackfillRunRepository,
} from '../application/ports/backfill-run.repository.port';
import { WalletService } from '../application/wallet.service';
import {
  WALLET_BACKFILL_QUEUE_NAME,
  WALLET_BACKFILL_JOB,
} from '../application/wallet-backfill-queue.constants';
import type { ProvisionUserPayload } from './coordinate-backfill.processor';

@Processor(WALLET_BACKFILL_QUEUE_NAME)
export class ProvisionUserProcessor extends WorkerHost {
  private readonly logger = new Logger(ProvisionUserProcessor.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly assetRegistry: AssetRegistry,
    @Inject(WALLET_REPOSITORY)
    private readonly walletRepo: IWalletRepository,
    @Inject(BACKFILL_RUN_REPOSITORY)
    private readonly runRepo: IBackfillRunRepository,
  ) {
    super();
  }

  async process(job: Job<ProvisionUserPayload>): Promise<void> {
    if (job.name !== WALLET_BACKFILL_JOB.PROVISION_USER) {
      // Not our job type — skip (CoordinateBackfillProcessor handles 'coordinate').
      return;
    }

    const { runId, userId, dryRun } = job.data;
    const enabledNetworks = this.assetRegistry.enabledNetworks();

    this.logger.debug(
      `[provision-user] job=${job.id} runId=${runId} userId=${userId} dryRun=${dryRun}`,
    );

    const perNetworkDelta: Record<
      string,
      { alreadyHad: number; provisioned: number }
    > = Object.fromEntries(
      enabledNetworks.map((n) => [n, { alreadyHad: 0, provisioned: 0 }]),
    );

    if (dryRun) {
      // Tally missing networks without calling the provider.
      for (const network of enabledNetworks) {
        const existing = await this.walletRepo.findByUserNetwork(
          userId,
          network,
        );
        const tally = perNetworkDelta[network];
        if (existing !== null) {
          tally.alreadyHad++;
        } else {
          tally.provisioned++;
        }
      }
    } else {
      // Snapshot pre-existing wallets before provisioning.
      const preExisting = new Set<string>();
      for (const network of enabledNetworks) {
        const existing = await this.walletRepo.findByUserNetwork(
          userId,
          network,
        );
        if (existing !== null) preExisting.add(network);
      }

      // Call the idempotent provisioning method.
      await this.walletService.provisionAllEnabledNetworks(userId);

      // Tally the delta.
      for (const network of enabledNetworks) {
        const tally = perNetworkDelta[network];
        if (preExisting.has(network)) {
          tally.alreadyHad++;
        } else {
          tally.provisioned++;
        }
      }
    }

    // Atomically increment counters.
    await this.runRepo.incrementCounters(runId, {
      scannedUsers: 1,
      perNetworkDelta,
    });

    // Check if all users are done → mark completed.
    await this.checkAndMarkCompleted(runId);
  }

  /**
   * Called by BullMQ after all retry attempts are exhausted.
   * Records the failure in BackfillRun.failures and checks for completion.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ProvisionUserPayload>, err: Error): Promise<void> {
    if (job.name !== WALLET_BACKFILL_JOB.PROVISION_USER) return;
    if ((job.attemptsMade ?? 0) < (job.opts?.attempts ?? 1) - 1) {
      // Not final attempt — BullMQ will retry.
      return;
    }

    const { runId, userId } = job.data;
    this.logger.warn(
      `[provision-user] job=${job.id} runId=${runId} userId=${userId} final failure: ${err.message}`,
    );

    // Record the failure and still increment scannedUsers so totalUsers math stays correct.
    await this.runRepo.incrementCounters(runId, {
      scannedUsers: 1,
      failure: { userId, error: err.message },
    });

    await this.checkAndMarkCompleted(runId);
  }

  private async checkAndMarkCompleted(runId: string): Promise<void> {
    const run = await this.runRepo.findById(runId);
    if (!run) return;
    if (run.status === 'completed' || run.status === 'failed') return;
    if (run.totalUsers > 0 && run.scannedUsers >= run.totalUsers) {
      await this.runRepo.markCompleted(runId);
      this.logger.log(
        `[provision-user] runId=${runId} all ${run.totalUsers} users processed — run completed`,
      );
    }
  }
}
