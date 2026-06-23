import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  ConversationMessageRecord,
  CreateMessageData,
  IMessageRepository,
} from '../application/ports/message.repository.port';

@Injectable()
export class MessagePrismaRepository implements IMessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByExternalId(
    externalMessageId: string,
  ): Promise<ConversationMessageRecord | null> {
    const row = await this.prisma.conversationMessage.findUnique({
      where: { externalMessageId },
      select: {
        id: true,
        conversationId: true,
        externalMessageId: true,
        channel: true,
        senderAddress: true,
        text: true,
        rawUserText: true,
        processingStatus: true,
        correlationId: true,
        createdAt: true,
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      conversationId: row.conversationId,
      externalMessageId: row.externalMessageId,
      channel: row.channel,
      senderAddress: row.senderAddress,
      text: row.text,
      rawUserText: row.rawUserText,
      processingStatus: row.processingStatus,
      correlationId: row.correlationId,
      createdAt: row.createdAt,
    };
  }

  async create(data: CreateMessageData): Promise<ConversationMessageRecord> {
    const row = await this.prisma.conversationMessage.create({
      data: {
        conversationId: data.conversationId,
        externalMessageId: data.externalMessageId,
        channel: data.channel as never,
        senderAddress: data.senderAddress,
        text: data.text,
        rawUserText: data.rawUserText,
        processingStatus: data.processingStatus as never,
        correlationId: data.correlationId,
      },
      select: {
        id: true,
        conversationId: true,
        externalMessageId: true,
        channel: true,
        senderAddress: true,
        text: true,
        rawUserText: true,
        processingStatus: true,
        correlationId: true,
        createdAt: true,
      },
    });
    return {
      id: row.id,
      conversationId: row.conversationId,
      externalMessageId: row.externalMessageId,
      channel: row.channel,
      senderAddress: row.senderAddress,
      text: row.text,
      rawUserText: row.rawUserText,
      processingStatus: row.processingStatus,
      correlationId: row.correlationId,
      createdAt: row.createdAt,
    };
  }

  async updateStatus(
    id: string,
    status: string,
    errorReason?: string,
  ): Promise<void> {
    await this.prisma.conversationMessage.update({
      where: { id },
      data: {
        processingStatus: status as never,
        ...(errorReason !== undefined ? { errorReason } : {}),
        ...(status === 'processed' ? { processedAt: new Date() } : {}),
      },
    });
  }
}
