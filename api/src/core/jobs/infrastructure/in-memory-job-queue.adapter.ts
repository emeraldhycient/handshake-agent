/**
 * InMemoryJobQueueAdapter — zero-Redis JobQueue implementation for unit tests.
 *
 * Records enqueued jobs and optionally invokes a registered handler so tests
 * can assert side effects without standing up Redis or BullMQ.
 *
 * Usage in unit tests:
 *   const queue = new InMemoryJobQueueAdapter();
 *   // optionally register a handler:
 *   queue.registerHandler('echo', async (data) => { ... });
 *   // enqueue
 *   await queue.enqueue({ queue: 'echo', name: 'ping', data: { x: 1 } });
 *   expect(queue.jobs).toHaveLength(1);
 */
import type {
  EnqueueInput,
  EnqueueResult,
  JobQueue,
} from '../application/job-queue.port';

export interface RecordedJob {
  queue: string;
  name: string;
  data: unknown;
  opts?: EnqueueInput['opts'];
  id: string;
}

type HandlerFn = (data: unknown) => Promise<void>;

export class InMemoryJobQueueAdapter implements JobQueue {
  private readonly _jobs: RecordedJob[] = [];
  private readonly _handlers = new Map<string, HandlerFn>();
  private _counter = 0;

  /** All enqueued jobs in insertion order. */
  get jobs(): ReadonlyArray<RecordedJob> {
    return this._jobs;
  }

  /**
   * Register a handler that is called synchronously (in the same tick as
   * enqueue) when a job with the given name is added.  Useful for asserting
   * side effects without a real worker.
   */
  registerHandler(name: string, fn: HandlerFn): void {
    this._handlers.set(name, fn);
  }

  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    const id = input.opts?.jobId ?? String(++this._counter);
    this._jobs.push({ ...input, id });

    const handler = this._handlers.get(input.name);
    if (handler) {
      await handler(input.data);
    }

    return { id };
  }

  /** Reset state between tests. */
  clear(): void {
    this._jobs.length = 0;
    this._handlers.clear();
    this._counter = 0;
  }
}
