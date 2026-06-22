import { Injectable } from '@nestjs/common';

// The generated Prisma client is the ONLY sanctioned DB door (CLAUDE.md §3.2).
// This is the infrastructure layer — the only place it is allowed.
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CreateProposalData,
  IProposalRepository,
  ProposalRecord,
} from '../application/ports/proposal.repository.port';

/**
 * Prisma adapter for the Proposal repository port. Maps application-level
 * CreateProposalData to Prisma create args; application never sees Prisma types.
 *
 * Dependency rule: infrastructure → core (PrismaService). Application imports
 * NOTHING from here (dependency-cruiser enforces the inward-only rule).
 */
@Injectable()
export class ProposalPrismaRepository implements IProposalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateProposalData): Promise<{ id: string }> {
    const row = await this.prisma.proposal.create({
      data: {
        userId: data.userId,
        conversationId: data.conversationId ?? null,
        // Prisma enum types are strings in Prisma 7; cast to bypass strict enum typing
        // at the boundary — the string values match the DB enum values exactly.
        type: data.type as never,
        status: 'pending',
        // Prisma JSON field: cast to `never` at the boundary — Record<string, unknown>
        // is a valid JSON object at runtime; the `never` cast skips the overly
        // strict InputJsonValue union without using `as any`.
        parameters: data.parameters as never,
        parametersChecksum: data.parametersChecksum,
        quoteId: data.quoteId ?? null,
        expiresAt: data.expiresAt,
      },
      select: { id: true },
    });

    return { id: row.id };
  }

  async findById(id: string): Promise<ProposalRecord | null> {
    const row = await this.prisma.proposal.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        conversationId: true,
        type: true,
        status: true,
        parameters: true,
        parametersChecksum: true,
        quoteId: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    if (row === null) return null;

    return {
      id: row.id,
      userId: row.userId,
      conversationId: row.conversationId,
      type: row.type,
      status: row.status,
      parameters: row.parameters as Record<string, unknown>,
      parametersChecksum: row.parametersChecksum,
      quoteId: row.quoteId,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }
}
