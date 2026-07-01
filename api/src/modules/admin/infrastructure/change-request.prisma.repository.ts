/**
 * Prisma adapter for IChangeRequestRepository (admin APPROVALS / maker-checker,
 * Phase 7). Infrastructure layer only — the only place in this feature that imports
 * the generated Prisma client / PrismaService (dependency-cruiser rule §3.2). Maps
 * Prisma rows → application-layer records; the service never sees Prisma types.
 *
 * This adapter stores/reads the request envelope ONLY — it never applies the change
 * and never touches the ledger (§3.1). The `decideIfPending` update is CONDITIONAL
 * on `status = pending` (a compare-and-set), so two concurrent checkers can never
 * both win: the second `updateMany` matches zero rows and returns null.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  ChangeRequestRecord,
  CreateChangeRequestInput,
  DecideChangeRequestInput,
  IChangeRequestRepository,
} from '../application/ports/change-request.repository.port';

/** Prisma row shape (subset) the mapper consumes — keeps the client type local. */
interface ChangeRequestRow {
  id: string;
  kind: ChangeRequestRecord['kind'];
  resource: string;
  payload: Prisma.JsonValue;
  status: ChangeRequestRecord['status'];
  reason: string;
  requestedByAdminId: string;
  decidedByAdminId: string | null;
  decisionReason: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class ChangeRequestPrismaRepository implements IChangeRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateChangeRequestInput): Promise<ChangeRequestRecord> {
    const row = await this.prisma.changeRequest.create({
      data: {
        kind: input.kind,
        resource: input.resource,
        payload: input.payload as Prisma.InputJsonValue,
        reason: input.reason,
        requestedByAdminId: input.requestedByAdminId,
      },
    });
    return toRecord(row);
  }

  async findById(id: string): Promise<ChangeRequestRecord | null> {
    const row = await this.prisma.changeRequest.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async listPending(): Promise<ChangeRequestRecord[]> {
    const rows = await this.prisma.changeRequest.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  async listByRequester(adminId: string): Promise<ChangeRequestRecord[]> {
    const rows = await this.prisma.changeRequest.findMany({
      where: { requestedByAdminId: adminId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  async decideIfPending(
    input: DecideChangeRequestInput,
  ): Promise<ChangeRequestRecord | null> {
    // Compare-and-set: only flip a row that is STILL pending. A lost race matches
    // zero rows → return null (the caller surfaces a conflict). At-most-once.
    const result = await this.prisma.changeRequest.updateMany({
      where: { id: input.id, status: 'pending' },
      data: {
        status: input.status,
        decidedByAdminId: input.decidedByAdminId,
        decisionReason: input.decisionReason,
        decidedAt: input.decidedAt,
      },
    });
    if (result.count === 0) return null;

    const row = await this.prisma.changeRequest.findUnique({
      where: { id: input.id },
    });
    return row ? toRecord(row) : null;
  }

  async resolveEmails(adminIds: string[]): Promise<Map<string, string>> {
    if (adminIds.length === 0) return new Map();
    const admins = await this.prisma.adminUser.findMany({
      where: { id: { in: adminIds } },
      select: { id: true, email: true },
    });
    return new Map(admins.map((a) => [a.id, a.email]));
  }
}

/** Prisma row → application record. `payload` is narrowed to an object bag. */
function toRecord(row: ChangeRequestRow): ChangeRequestRecord {
  return {
    id: row.id,
    kind: row.kind,
    resource: row.resource,
    payload: asObject(row.payload),
    status: row.status,
    reason: row.reason,
    requestedByAdminId: row.requestedByAdminId,
    decidedByAdminId: row.decidedByAdminId,
    decisionReason: row.decisionReason,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  };
}

function asObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}
