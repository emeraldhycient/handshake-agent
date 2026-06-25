/**
 * EchoProcessor — minimal BullMQ worker for the echo queue (BQ-1).
 *
 * Purpose: prove the enqueue → process round-trip in the integration test.
 * No business logic — logs the received payload and records the last processed job
 * via a static field so the integration test can assert without side effects.
 *
 * Real processors (backfill tasks, etc.) will be added in BQ-2.
 */
import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { ECHO_QUEUE_NAME } from '../echo-queue.constants';

export interface EchoPayload {
  message: string;
}

@Processor(ECHO_QUEUE_NAME)
export class EchoProcessor extends WorkerHost {
  private readonly logger = new Logger(EchoProcessor.name);

  /**
   * Last processed job data — used by the integration test to assert the
   * processor ran without setting up a real side-effecting service.
   * Reset between tests via `EchoProcessor.lastProcessed = null`.
   */
  static lastProcessed: EchoPayload | null = null;

  process(job: Job<EchoPayload>): Promise<void> {
    this.logger.debug(
      `[echo] job=${job.id} name=${job.name} data=${JSON.stringify(job.data)}`,
    );
    EchoProcessor.lastProcessed = job.data;
    return Promise.resolve();
  }
}
