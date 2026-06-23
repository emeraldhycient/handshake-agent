import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  ConversationReplyRecord,
  CreateReplyData,
  IReplyRepository,
} from '../application/ports/reply.repository.port';

@Injectable()
export class ReplyPrismaRepository implements IReplyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateReplyData): Promise<ConversationReplyRecord> {
    const row = await this.prisma.conversationReply.create({
      data: {
        conversationId: data.conversationId,
        messageId: data.messageId,
        text: data.text,
        correlationId: data.correlationId,
        directives: [],
      },
      select: {
        id: true,
        conversationId: true,
        messageId: true,
        text: true,
        status: true,
        correlationId: true,
        createdAt: true,
      },
    });
    return {
      id: row.id,
      conversationId: row.conversationId,
      messageId: row.messageId,
      text: row.text,
      status: row.status,
      correlationId: row.correlationId,
      createdAt: row.createdAt,
    };
  }

  async updateStatus(
    id: string,
    status: string,
    fields?: { sentAt?: Date; failureReason?: string },
  ): Promise<void> {
    await this.prisma.conversationReply.update({
      where: { id },
      data: {
        status: status as never,
        ...(fields?.sentAt !== undefined ? { sentAt: fields.sentAt } : {}),
        ...(fields?.failureReason !== undefined
          ? { failureReason: fields.failureReason }
          : {}),
      },
    });
  }
}
