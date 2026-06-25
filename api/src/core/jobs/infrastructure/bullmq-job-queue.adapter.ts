/**
 * BullMqJobQueueAdapter — production JobQueue adapter backed by BullMQ.
 *
 * Obtains a Queue instance via @nestjs/bullmq's BULL_MODULE_QUEUE token.
 * The queue name is injected at module-registration time.
 *
 * This adapter is thin on purpose: it translates the port's EnqueueInput into
 * BullMQ's JobsOptions and delegates to Queue#add. All retry / back-off
 * semantics live inside BullMQ.
 *
 * The adapter is registered per-queue (one DI token per queue name) inside
 * JobsModule. The port token JOB_QUEUE is bound to this class.
 */
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import type {
  EnqueueInput,
  EnqueueResult,
  JobQueue,
} from '../application/job-queue.port';

import { ECHO_QUEUE_NAME } from '../echo-queue.constants';

@Injectable()
export class BullMqJobQueueAdapter implements JobQueue {
  constructor(@InjectQueue(ECHO_QUEUE_NAME) private readonly queue: Queue) {}

  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    const job = await this.queue.add(input.name, input.data, {
      jobId: input.opts?.jobId,
      attempts: input.opts?.attempts,
      backoff: input.opts?.backoffMs
        ? { type: 'fixed', delay: input.opts.backoffMs }
        : undefined,
    });

    return { id: job.id ?? String(job.id) };
  }
}
