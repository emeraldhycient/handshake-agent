/**
 * WebhookEvent repository integration test (Track A, Testcontainers Postgres).
 *
 * Verifies the durable-webhook persistence contract against a REAL Postgres:
 *   - createIfNew inserts; a second call on the same (provider, providerEventId)
 *     returns duplicate:true + the SAME row (dedup — never double-process, §3.1).
 *   - the lifecycle writes (processing/succeeded/failed/dead/reset).
 *   - keyset list with filters + cursor round-trip.
 *   - findStuckReceived + countByStatus (sweeper + metrics reads).
 *
 * Requires Docker.
 */

import { Logger } from '@nestjs/common';

import { PrismaClient } from '../generated/prisma/client';
import { startTestPostgres } from './helpers/pg-testcontainer';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { WebhookEventPrismaRepository } from '../src/modules/webhooks/infrastructure/webhook-event.prisma.repository';

jest.setTimeout(180_000);

const base = (over: Record<string, unknown> = {}) => ({
  provider: 'blockradar',
  providerEventId: `evt-${Math.random().toString(36).slice(2)}`,
  payload: { event: 'deposit.success', data: { hash: '0xabc' } },
  headers: { 'x-blockradar-signature': 'sig-1' },
  signature: 'sig-1',
  ...over,
});

describe('WebhookEvent Repository (Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: WebhookEventPrismaRepository;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    ({ prisma, stop } = await startTestPostgres());
    repo = new WebhookEventPrismaRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await stop?.();
  });

  it('createIfNew inserts a received row', async () => {
    const { record, duplicate } = await repo.createIfNew(base());
    expect(duplicate).toBe(false);
    expect(record.id).toBeTruthy();
    expect(record.status).toBe('received');
    expect(record.attempts).toBe(0);
    expect(record.signature).toBe('sig-1');
    expect(record.headers['x-blockradar-signature']).toBe('sig-1');
  });

  it('createIfNew dedups on (provider, providerEventId)', async () => {
    const data = base({ providerEventId: 'dup-1' });
    const first = await repo.createIfNew(data);
    const second = await repo.createIfNew(data);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.record.id).toBe(first.record.id);
  });

  it('allows the same providerEventId across different providers', async () => {
    const a = await repo.createIfNew(
      base({ provider: 'blockradar', providerEventId: 'shared' }),
    );
    const b = await repo.createIfNew(
      base({ provider: 'flutterwave', providerEventId: 'shared' }),
    );
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(false);
    expect(a.record.id).not.toBe(b.record.id);
  });

  it('markProcessing sets status=processing + increments attempts', async () => {
    const { record } = await repo.createIfNew(base());
    await repo.markProcessing(record.id);
    const found = await repo.findById(record.id);
    expect(found!.status).toBe('processing');
    expect(found!.attempts).toBe(1);
    expect(found!.lastAttemptAt).not.toBeNull();
  });

  it('markSucceeded sets status=succeeded + processedAt + clears lastError', async () => {
    const { record } = await repo.createIfNew(base());
    await repo.markFailed(record.id, 'transient');
    await repo.markSucceeded(record.id);
    const found = await repo.findById(record.id);
    expect(found!.status).toBe('succeeded');
    expect(found!.processedAt).not.toBeNull();
    expect(found!.lastError).toBeNull();
  });

  it('markFailed records the error but stays retryable', async () => {
    const { record } = await repo.createIfNew(base());
    await repo.markFailed(record.id, 'boom');
    const found = await repo.findById(record.id);
    expect(found!.status).toBe('failed');
    expect(found!.lastError).toBe('boom');
  });

  it('markDead sets status=dead + deadAt', async () => {
    const { record } = await repo.createIfNew(base());
    await repo.markDead(record.id, 'exhausted');
    const found = await repo.findById(record.id);
    expect(found!.status).toBe('dead');
    expect(found!.deadAt).not.toBeNull();
    expect(found!.lastError).toBe('exhausted');
  });

  it('resetToReceived re-arms a dead row, preserving attempts', async () => {
    const { record } = await repo.createIfNew(base());
    await repo.markProcessing(record.id);
    await repo.markDead(record.id, 'exhausted');
    await repo.resetToReceived(record.id);
    const found = await repo.findById(record.id);
    expect(found!.status).toBe('received');
    expect(found!.deadAt).toBeNull();
    expect(found!.attempts).toBe(1);
  });

  it('list filters by provider + status and keyset-paginates', async () => {
    // three fresh whatsapp/failed rows
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { record } = await repo.createIfNew(
        base({ provider: 'whatsapp', providerEventId: `wa-list-${i}` }),
      );
      await repo.markFailed(record.id, `e${i}`);
      ids.push(record.id);
    }

    const page1 = await repo.list({
      provider: 'whatsapp',
      status: 'failed',
      limit: 2,
    });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    page1.items.forEach((r) => {
      expect(r.provider).toBe('whatsapp');
      expect(r.status).toBe('failed');
    });

    const page2 = await repo.list({
      provider: 'whatsapp',
      status: 'failed',
      limit: 2,
      cursor: page1.nextCursor!,
    });
    const seen = [...page1.items, ...page2.items].map((r) => r.id);
    ids.forEach((id) => expect(seen).toContain(id));
  });

  it('findStuckReceived returns received rows and excludes terminal ones', async () => {
    const stuck = await repo.createIfNew(base({ providerEventId: 'stuck-1' }));
    const done = await repo.createIfNew(base({ providerEventId: 'done-1' }));
    await repo.markSucceeded(done.record.id);

    const rows = await repo.findStuckReceived(0, 100);
    const rowIds = rows.map((r) => r.id);
    expect(rowIds).toContain(stuck.record.id);
    expect(rowIds).not.toContain(done.record.id);
  });

  it('countByStatus returns per-status counts', async () => {
    const counts = await repo.countByStatus();
    expect(typeof counts.received).toBe('number');
    expect(counts.received).toBeGreaterThanOrEqual(1);
  });
});
