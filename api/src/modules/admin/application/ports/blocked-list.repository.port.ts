// Port for the append-only admin deny-list store (ADM Phase 9). Backs the
// `blocked_entries` table: a subject (a user, a wallet address, or a bank account)
// is blocked out of the money path, and lifting a block SUPERSEDES the row (stamps
// who/when) rather than deleting it — the deny-list history stays fully auditable
// (§3.4). The application layer reaches it only through this port (§3.2); no Prisma
// import crosses into application/domain.

import type { BlockedEntryKind } from '@handshake-agent/contracts';

export const BLOCKED_LIST_REPOSITORY = Symbol('BLOCKED_LIST_REPOSITORY');

/** A persisted deny-list row (append-only; `supersededAt` null while active). */
export interface BlockedEntryRecord {
  id: string;
  kind: BlockedEntryKind;
  value: string;
  reason: string;
  addedByAdminId: string;
  createdAt: Date;
  supersededAt: Date | null;
}

/** The fields an operator supplies to add a new block (the actor is threaded separately). */
export interface CreateBlockedEntryInput {
  kind: BlockedEntryKind;
  value: string;
  reason: string;
  addedByAdminId: string;
}

export interface IBlockedListRepository {
  /** Active (not-yet-superseded) entries, newest-first. */
  listActive(): Promise<BlockedEntryRecord[]>;
  /** Load one entry by id, or null if it does not exist. */
  findById(id: string): Promise<BlockedEntryRecord | null>;
  /** Append a new active block and return the persisted row. */
  create(input: CreateBlockedEntryInput): Promise<BlockedEntryRecord>;
  /**
   * Lift (supersede) an ACTIVE entry: stamps `supersededAt` (now) +
   * `supersededByAdminId`. Returns the updated row, or null if the id does not
   * exist or is already superseded (idempotency / fail-closed at the service).
   */
  supersede(
    id: string,
    supersededByAdminId: string,
  ): Promise<BlockedEntryRecord | null>;
}
