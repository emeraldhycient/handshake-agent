/**
 * Unit tests for InMemoryJobQueueAdapter.
 *
 * No Redis, no BullMQ — all in memory. Tests cover:
 *   - enqueue records the job
 *   - sequential ids assigned when no jobId supplied
 *   - jobId override is respected (dedup key)
 *   - registered handler is invoked with job data
 *   - clear() resets state
 */
import { InMemoryJobQueueAdapter } from './in-memory-job-queue.adapter';

describe('InMemoryJobQueueAdapter', () => {
  let adapter: InMemoryJobQueueAdapter;

  beforeEach(() => {
    adapter = new InMemoryJobQueueAdapter();
  });

  it('records an enqueued job', async () => {
    const result = await adapter.enqueue({
      queue: 'echo',
      name: 'ping',
      data: { msg: 'hello' },
    });

    expect(result.id).toBe('1');
    expect(adapter.jobs).toHaveLength(1);
    expect(adapter.jobs[0]).toMatchObject({
      queue: 'echo',
      name: 'ping',
      data: { msg: 'hello' },
    });
  });

  it('assigns auto-incrementing ids when jobId is not supplied', async () => {
    const r1 = await adapter.enqueue({ queue: 'q', name: 'a', data: null });
    const r2 = await adapter.enqueue({ queue: 'q', name: 'b', data: null });
    const r3 = await adapter.enqueue({ queue: 'q', name: 'c', data: null });

    expect(r1.id).toBe('1');
    expect(r2.id).toBe('2');
    expect(r3.id).toBe('3');
  });

  it('uses the supplied jobId as the recorded id (dedup key)', async () => {
    const result = await adapter.enqueue({
      queue: 'echo',
      name: 'ping',
      data: {},
      opts: { jobId: 'idempotency-key-abc' },
    });

    expect(result.id).toBe('idempotency-key-abc');
    expect(adapter.jobs[0].id).toBe('idempotency-key-abc');
  });

  it('invokes a registered handler with the job data', async () => {
    const received: unknown[] = [];
    adapter.registerHandler('ping', (data) => {
      received.push(data);
      return Promise.resolve();
    });

    await adapter.enqueue({ queue: 'echo', name: 'ping', data: { x: 42 } });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ x: 42 });
  });

  it('does not invoke a handler for a different job name', async () => {
    const received: unknown[] = [];
    adapter.registerHandler('other-job', (data) => {
      received.push(data);
      return Promise.resolve();
    });

    await adapter.enqueue({ queue: 'echo', name: 'ping', data: {} });

    expect(received).toHaveLength(0);
    expect(adapter.jobs).toHaveLength(1);
  });

  it('clear() resets recorded jobs and counter', async () => {
    await adapter.enqueue({ queue: 'q', name: 'a', data: null });
    await adapter.enqueue({ queue: 'q', name: 'b', data: null });
    expect(adapter.jobs).toHaveLength(2);

    adapter.clear();

    expect(adapter.jobs).toHaveLength(0);

    const result = await adapter.enqueue({ queue: 'q', name: 'c', data: null });
    // Counter resets to 1 after clear
    expect(result.id).toBe('1');
  });

  it('stores opts on the recorded job', async () => {
    await adapter.enqueue({
      queue: 'echo',
      name: 'retry-job',
      data: {},
      opts: { attempts: 3, backoffMs: 500 },
    });

    expect(adapter.jobs[0].opts).toEqual({ attempts: 3, backoffMs: 500 });
  });
});
