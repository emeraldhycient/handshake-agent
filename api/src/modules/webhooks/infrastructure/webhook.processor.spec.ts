import type { Job } from 'bullmq';

import type { WebhookProcessingService } from '../application/webhook-processing.service';
import { WebhookProcessor } from './webhook.processor';
import { WEBHOOK_PROCESS_JOB } from './webhook-queue.constants';

function makeJob(over: Partial<Job> = {}): Job {
  return {
    name: WEBHOOK_PROCESS_JOB,
    data: { webhookEventId: 'wh-1' },
    attemptsMade: 0,
    opts: { attempts: 5 },
    ...over,
  } as unknown as Job;
}

describe('WebhookProcessor', () => {
  let processing: jest.Mocked<
    Pick<WebhookProcessingService, 'process' | 'handleExhausted'>
  >;
  let processor: WebhookProcessor;

  beforeEach(() => {
    processing = {
      process: jest.fn().mockResolvedValue(undefined),
      handleExhausted: jest.fn().mockResolvedValue(undefined),
    };
    processor = new WebhookProcessor(
      processing as unknown as WebhookProcessingService,
    );
  });

  it('delegates a process-webhook job to the processing service', async () => {
    await processor.process(makeJob());
    expect(processing.process).toHaveBeenCalledWith('wh-1');
  });

  it('ignores an unknown job name', async () => {
    await processor.process(makeJob({ name: 'something-else' }));
    expect(processing.process).not.toHaveBeenCalled();
  });

  it('dead-letters on the FINAL failed attempt', async () => {
    const err = new Error('exhausted');
    await processor.onFailed(
      makeJob({ attemptsMade: 4, opts: { attempts: 5 } }),
      err,
    );
    expect(processing.handleExhausted).toHaveBeenCalledWith('wh-1', err);
  });

  it('does NOT dead-letter on a non-final failed attempt', async () => {
    await processor.onFailed(
      makeJob({ attemptsMade: 1, opts: { attempts: 5 } }),
      new Error('transient'),
    );
    expect(processing.handleExhausted).not.toHaveBeenCalled();
  });
});
