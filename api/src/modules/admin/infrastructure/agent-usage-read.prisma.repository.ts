import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  AgentUsageWindowRecord,
  IAgentUsageReadRepository,
} from '../application/ports/agent-usage-read.repository.port';

/**
 * Prisma adapter for IAgentUsageReadRepository (admin Agent console, Phase 6b
 * READ enrichment). READ-ONLY rolling-window counts over ConversationMessage /
 * ConversationReply.
 *
 * Infrastructure layer only — the only place in this read path that imports
 * PrismaService (dependency-cruiser §3.2). Maps Prisma rows → an application-layer
 * record; the service never sees Prisma types. Nothing here mutates anything (§3.1);
 * it counts existing rows. No token/cost is read — the schema stores none (§3.6).
 */
@Injectable()
export class AgentUsageReadPrismaRepository implements IAgentUsageReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countUsageSince(since: Date): Promise<AgentUsageWindowRecord> {
    // Distinct-conversation counting: group both messages and replies by
    // conversationId in the window, then union the id sets so a conversation with
    // both an inbound message and an outbound reply is counted once.
    const [inboundMessages, outboundReplies, msgGroups, replyGroups] =
      await Promise.all([
        this.prisma.conversationMessage.count({
          where: { receivedAt: { gte: since } },
        }),
        this.prisma.conversationReply.count({
          where: { createdAt: { gte: since } },
        }),
        this.prisma.conversationMessage.groupBy({
          by: ['conversationId'],
          where: { receivedAt: { gte: since } },
        }),
        this.prisma.conversationReply.groupBy({
          by: ['conversationId'],
          where: { createdAt: { gte: since } },
        }),
      ]);

    const touched = new Set<string>();
    for (const g of msgGroups) touched.add(g.conversationId);
    for (const g of replyGroups) touched.add(g.conversationId);

    return {
      conversations: touched.size,
      inboundMessages,
      outboundReplies,
    };
  }
}
