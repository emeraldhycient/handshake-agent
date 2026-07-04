/**
 * Prisma adapter for the WebhookEvent repository port.
 *
 * The webhook_events table is the durable source of truth for every inbound
 * provider webhook. `createIfNew` performs the (provider, providerEventId) dedup
 * by catching the unique-constraint violation — the funds-safety guard against
 * re-processing a re-delivery (§3.1).
 *
 * Dependency rule: infrastructure → core (PrismaService). Application imports
 * NOTHING from here (dependency-cruiser enforces the inward-only rule).
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import type {
  WebhookEventStatus as PrismaWebhookEventStatus,
  WebhookProvider as PrismaWebhookProvider,
} from '../../../../generated/prisma/client';

import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CreateWebhookEventData,
  IWebhookEventRepository,
  WebhookEventRecord,
  WebhookListFilter,
  WebhookListPage,
} from '../application/ports/webhook-event.repository.port';

const SELECT = {
  id: true,
  provider: true,
  providerEventId: true,
  payload: true,
  headers: true,
  signature: true,
  status: true,
  attempts: true,
  lastError: true,
  receivedAt: true,
  lastAttemptAt: true,
  processedAt: true,
  deadAt: true,
} as const;

type Row = {
  id: string;
  provider: string;
  providerEventId: string;
  payload: unknown;
  headers: unknown;
  signature: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  receivedAt: Date;
  lastAttemptAt: Date | null;
  processedAt: Date | null;
  deadAt: Date | null;
};

@Injectable()
export class WebhookEventPrismaRepository implements IWebhookEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createIfNew(
    data: CreateWebhookEventData,
  ): Promise<{ record: WebhookEventRecord; duplicate: boolean }> {
    try {
      const row = await this.prisma.webhookEvent.create({
        data: {
          provider: data.provider as PrismaWebhookProvider,
          providerEventId: data.providerEventId,
          payload: data.payload as never,
          headers: data.headers as never,
          signature: data.signature ?? null,
        },
        select: SELECT,
      });
      return { record: this.toRecord(row), duplicate: false };
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Unique (provider, providerEventId) violation → a re-delivery. Return
        // the existing row; the ingestion layer skips re-enqueue on duplicate.
        const existing = await this.prisma.webhookEvent.findUnique({
          where: {
            provider_providerEventId: {
              provider: data.provider as PrismaWebhookProvider,
              providerEventId: data.providerEventId,
            },
          },
          select: SELECT,
        });
        if (existing)
          return { record: this.toRecord(existing), duplicate: true };
      }
      throw err;
    }
  }

  async findById(id: string): Promise<WebhookEventRecord | null> {
    const row = await this.prisma.webhookEvent.findUnique({
      where: { id },
      select: SELECT,
    });
    return row ? this.toRecord(row) : null;
  }

  async list(filter: WebhookListFilter): Promise<WebhookListPage> {
    const where: Prisma.WebhookEventWhereInput = {};
    if (filter.provider)
      where.provider = filter.provider as PrismaWebhookProvider;
    if (filter.status) where.status = filter.status as PrismaWebhookEventStatus;
    if (filter.from || filter.to) {
      where.receivedAt = {};
      if (filter.from) where.receivedAt.gte = filter.from;
      if (filter.to) where.receivedAt.lte = filter.to;
    }

    const cursor = filter.cursor ? decodeCursor(filter.cursor) : null;
    if (cursor) {
      // Keyset seek on (receivedAt desc, id desc): rows strictly "after" the
      // cursor tuple. Emulated with an OR since Prisma has no row-value compare.
      where.OR = [
        { receivedAt: { lt: cursor.receivedAt } },
        { receivedAt: cursor.receivedAt, id: { lt: cursor.id } },
      ];
    }

    const rows = await this.prisma.webhookEvent.findMany({
      where,
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      select: SELECT,
    });

    const hasMore = rows.length > filter.limit;
    const items = (hasMore ? rows.slice(0, filter.limit) : rows).map((r) =>
      this.toRecord(r),
    );
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor(last.receivedAt, last.id) : null;

    return { items, nextCursor };
  }

  async markProcessing(id: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: {
        status: 'processing',
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
  }

  async markSucceeded(id: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: { status: 'succeeded', processedAt: new Date(), lastError: null },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: { status: 'failed', lastError: truncate(error) },
    });
  }

  async markDead(id: string, error: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: { status: 'dead', deadAt: new Date(), lastError: truncate(error) },
    });
  }

  async resetToReceived(id: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: { status: 'received', deadAt: null, processedAt: null },
    });
  }

  async findStuckReceived(
    olderThanSec: number,
    limit: number,
  ): Promise<WebhookEventRecord[]> {
    const cutoff = new Date(Date.now() - olderThanSec * 1_000);
    const rows = await this.prisma.webhookEvent.findMany({
      where: { status: 'received', receivedAt: { lt: cutoff } },
      orderBy: { receivedAt: 'asc' },
      take: limit,
      select: SELECT,
    });
    return rows.map((r) => this.toRecord(r));
  }

  async countByStatus(): Promise<Record<string, number>> {
    const grouped = await this.prisma.webhookEvent.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const g of grouped) counts[g.status] = g._count._all;
    return counts;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private toRecord(row: Row): WebhookEventRecord {
    return {
      id: row.id,
      provider: row.provider,
      providerEventId: row.providerEventId,
      payload: row.payload,
      headers: (row.headers ?? {}) as Record<string, unknown>,
      signature: row.signature,
      status: row.status,
      attempts: row.attempts,
      lastError: row.lastError,
      receivedAt: row.receivedAt,
      lastAttemptAt: row.lastAttemptAt,
      processedAt: row.processedAt,
      deadAt: row.deadAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Keyset cursor: base64 of "<receivedAt ISO>|<id>". Opaque to callers.
// ---------------------------------------------------------------------------

function encodeCursor(receivedAt: Date, id: string): string {
  return Buffer.from(`${receivedAt.toISOString()}|${id}`, 'utf8').toString(
    'base64',
  );
}

function decodeCursor(cursor: string): { receivedAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8');
    const sep = raw.lastIndexOf('|');
    if (sep === -1) return null;
    const receivedAt = new Date(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (Number.isNaN(receivedAt.getTime()) || !id) return null;
    return { receivedAt, id };
  } catch {
    return null;
  }
}

/** Bound stored error text so a giant provider message can't bloat the row. */
function truncate(text: string, max = 2_000): string {
  return text.length > max ? text.slice(0, max) : text;
}
