import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  ConversationRecord,
  IConversationRepository,
} from '../application/ports/conversation.repository.port';

@Injectable()
export class ConversationPrismaRepository implements IConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByContactId(contactId: string): Promise<ConversationRecord | null> {
    const row = await this.prisma.conversation.findUnique({
      where: { contactId },
      select: {
        id: true,
        contactId: true,
        userId: true,
        status: true,
        lastMessageAt: true,
        createdAt: true,
      },
    });
    return row;
  }

  async findByUserId(userId: string): Promise<ConversationRecord | null> {
    const row = await this.prisma.conversation.findUnique({
      where: { userId },
      select: {
        id: true,
        contactId: true,
        userId: true,
        status: true,
        lastMessageAt: true,
        createdAt: true,
      },
    });
    return row;
  }

  async create(data: {
    contactId?: string;
    userId?: string;
  }): Promise<ConversationRecord> {
    const row = await this.prisma.conversation.create({
      data: {
        contactId: data.contactId ?? null,
        userId: data.userId ?? null,
      },
      select: {
        id: true,
        contactId: true,
        userId: true,
        status: true,
        lastMessageAt: true,
        createdAt: true,
      },
    });
    return row;
  }

  async touch(id: string, lastMessageAt: Date): Promise<void> {
    await this.prisma.conversation.update({
      where: { id },
      data: { lastMessageAt },
    });
  }
}
