import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CreateIntentData,
  IIntentRepository,
} from '../application/ports/intent.repository.port';

@Injectable()
export class IntentPrismaRepository implements IIntentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateIntentData): Promise<{ id: string }> {
    const row = await this.prisma.messageIntent.create({
      data: {
        messageId: data.messageId,
        conversationId: data.conversationId,
        action: data.action as never,
        payload: data.payload as never,
      },
      select: { id: true },
    });
    return { id: row.id };
  }
}
