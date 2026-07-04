import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  BlockedEntry,
  BlockedEntryCreateRequest,
  BlockedEntryListResponse,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { AdminNotFoundError } from '../domain/admin-errors';
import {
  BLOCKED_LIST_REPOSITORY,
  type BlockedEntryRecord,
  type IBlockedListRepository,
} from './ports/blocked-list.repository.port';

/**
 * ADM Phase 9 — the APPEND-ONLY admin deny-list service. An operator blocks a
 * subject (a user, a wallet address, or a bank account) out of the money path, and
 * LIFTS a block by SUPERSEDING its row (stamping who/when) — a block is never
 * deleted, so the deny-list history stays fully auditable (§3.4).
 *
 * A block moves no money (§3.1): it is a gate, not a transfer — this surface only
 * appends/annotates rows and records an immutable audit line. Both writes are
 * audited as `admin_override` (the deny-list is an operator override of the default
 * allow) with `subject = BlockedEntry:<id>` + the reason. The actor is threaded
 * straight from the authenticated principal (never a body param), so `addedByAdminId`
 * / `supersededByAdminId` always reflect the real operator. Lifting an unknown or
 * already-lifted entry fails closed (§3.6, mapped to 404). Holds no Prisma import —
 * it reaches data only through the injected port (§3.2).
 */
@Injectable()
export class AdminBlockedListService {
  constructor(
    @Inject(BLOCKED_LIST_REPOSITORY)
    private readonly repo: IBlockedListRepository,
    private readonly audit: AuditService,
  ) {}

  /** The active (not-yet-lifted) deny-list, newest-first. Read-only, no audit. */
  async list(): Promise<BlockedEntryListResponse> {
    const rows = await this.repo.listActive();
    return { items: rows.map(toWire) };
  }

  /**
   * Append a new block. The actor becomes `addedByAdminId` (threaded from the
   * principal, never the body), and the add is immutably audited.
   */
  async add(
    input: BlockedEntryCreateRequest,
    adminId: string,
  ): Promise<BlockedEntry> {
    const created = await this.repo.create({
      kind: input.kind,
      value: input.value,
      reason: input.reason,
      addedByAdminId: adminId,
    });

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `BlockedEntry:${created.id}`,
      action: 'admin_override',
      after: {
        disposition: 'blocked',
        kind: input.kind,
        value: input.value,
        reason: input.reason,
      },
    });

    return toWire(created);
  }

  /**
   * Lift (supersede) an ACTIVE block: stamps `supersededAt` + `supersededByAdminId`
   * (the actor, from the principal). An unknown or already-lifted entry fails closed
   * (no row updated → 404, no audit line). The lift is immutably audited.
   */
  async supersede(
    id: string,
    reason: string,
    adminId: string,
  ): Promise<BlockedEntry> {
    const lifted = await this.repo.supersede(id, adminId);
    if (lifted === null) throw new AdminNotFoundError('Blocked entry');

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `BlockedEntry:${id}`,
      action: 'admin_override',
      before: {
        disposition: 'blocked',
        kind: lifted.kind,
        value: lifted.value,
      },
      after: { disposition: 'lifted', reason },
    });

    return toWire(lifted);
  }
}

// ── mapper (record → contract shape) ──────────────────────────────────────────────

/** Projects a persisted deny-list row into the wire `BlockedEntry` shape (ISO dates). */
function toWire(row: BlockedEntryRecord): BlockedEntry {
  return {
    id: row.id,
    kind: row.kind,
    value: row.value,
    reason: row.reason,
    addedByAdminId: row.addedByAdminId,
    createdAt: row.createdAt.toISOString(),
    supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
  };
}
