import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  ConversationLogDetailRecord,
  ConversationLogRecord,
  IConversationLogReadRepository,
} from '../application/ports/conversation-log-read.repository.port';

/**
 * Prisma adapter for the admin Agent conversation-LOG read repository (Phase 4
 * wave 2). Infrastructure layer only — the only place in this read path that
 * imports PrismaService (dependency-cruiser §3.2). Maps Prisma rows →
 * application-layer projections; the service never sees Prisma types.
 */
@Injectable()
export class ConversationLogReadPrismaRepository implements IConversationLogReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(page: {
    cursor?: string;
    limit: number;
  }): Promise<{ items: ConversationLogRecord[]; nextCursor: string | null }> {
    // Resolve the cursor row's createdAt so the keyset compares on (createdAt, id).
    // An unknown cursor yields no anchor → return the first page.
    const cursorAnchor =
      page.cursor !== undefined
        ? await this.prisma.conversation.findUnique({
            where: { id: page.cursor },
            select: { createdAt: true, id: true },
          })
        : null;

    const rows = await this.prisma.conversation.findMany({
      where:
        cursorAnchor !== null
          ? {
              OR: [
                { createdAt: { lt: cursorAnchor.createdAt } },
                {
                  createdAt: cursorAnchor.createdAt,
                  id: { lt: cursorAnchor.id },
                },
              ],
            }
          : {},
      select: {
        id: true,
        userId: true,
        contactId: true,
        language: true,
        status: true,
        lastMessageAt: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
    });

    const hasMore = rows.length > page.limit;
    const items = hasMore ? rows.slice(0, page.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items: items.map((r) => toConversationRecord(r)), nextCursor };
  }

  async loadConversationLog(
    conversationId: string,
  ): Promise<ConversationLogDetailRecord | null> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        userId: true,
        contactId: true,
        language: true,
        status: true,
        lastMessageAt: true,
        createdAt: true,
      },
    });
    if (conversation === null) return null;

    const messageRows = await this.prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        text: true,
        processingStatus: true,
        receivedAt: true,
        intent: {
          select: { action: true, extractionConfidence: true },
        },
      },
    });

    const replyRows = await this.prisma.conversationReply.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, text: true, status: true, sentAt: true },
    });

    return {
      conversation: toConversationRecord(conversation),
      messages: messageRows.map((m) => ({
        id: m.id,
        text: m.text,
        processingStatus: m.processingStatus,
        receivedAt: m.receivedAt,
        intent:
          m.intent !== null
            ? {
                action: m.intent.action,
                confidence:
                  m.intent.extractionConfidence !== null
                    ? Number(m.intent.extractionConfidence)
                    : null,
              }
            : null,
      })),
      replies: replyRows.map((r) => ({
        id: r.id,
        text: r.text,
        status: r.status,
        sentAt: r.sentAt,
      })),
    };
  }
}

function toConversationRecord(row: {
  id: string;
  userId: string | null;
  contactId: string | null;
  language: string;
  status: string;
  lastMessageAt: Date | null;
  createdAt: Date;
}): ConversationLogRecord {
  return {
    id: row.id,
    userId: row.userId,
    contactId: row.contactId,
    language: row.language,
    status: row.status,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
  };
}
