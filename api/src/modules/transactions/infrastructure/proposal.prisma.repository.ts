import { Injectable } from '@nestjs/common';

// The generated Prisma client is the ONLY sanctioned DB door (CLAUDE.md §3.2).
// This is the infrastructure layer — the only place it is allowed.
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CreateProposalData,
  IProposalRepository,
  ProposalRecord,
  ProposalStatus,
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
        confirmedAt: true,
        createdAt: true,
      },
    });

    if (row === null) return null;

    return {
      id: row.id,
      userId: row.userId,
      conversationId: row.conversationId,
      type: row.type,
      // Cast Prisma enum to port-layer string-literal union — values are identical.
      status: row.status as ProposalStatus,
      parameters: row.parameters as Record<string, unknown>,
      parametersChecksum: row.parametersChecksum,
      quoteId: row.quoteId,
      expiresAt: row.expiresAt,
      confirmedAt: row.confirmedAt,
      createdAt: row.createdAt,
    };
  }

  async updateStatus(
    id: string,
    status: ProposalStatus,
    fields?: {
      confirmedAt?: Date;
      executedAt?: Date;
      rejectedAt?: Date;
      rejectionReason?: string;
    },
  ): Promise<void> {
    await this.prisma.proposal.update({
      where: { id },
      data: {
        status,
        ...(fields?.confirmedAt !== undefined
          ? { confirmedAt: fields.confirmedAt }
          : {}),
        ...(fields?.executedAt !== undefined
          ? { executedAt: fields.executedAt }
          : {}),
        ...(fields?.rejectedAt !== undefined
          ? { rejectedAt: fields.rejectedAt }
          : {}),
        ...(fields?.rejectionReason !== undefined
          ? { rejectionReason: fields.rejectionReason }
          : {}),
      },
    });
  }

  /**
   * Returns only the `type` column for a Proposal, or null when not found.
   * Avoids loading the full record (parameters, metadata) for the dispatch use-case (W1).
   */
  async getType(proposalId: string): Promise<string | null> {
    const row = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      select: { type: true },
    });
    return row?.type ?? null;
  }
}
