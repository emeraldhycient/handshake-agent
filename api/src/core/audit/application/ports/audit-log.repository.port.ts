import type { z } from 'zod';

import { AuditActionSchema } from '@handshake-agent/contracts';

// Port for the append-only, hash-chained audit log (AUD-01). The only writer is
// `append`; there is intentionally NO update/delete on this interface —
// immutability is a contract of the port, not just a DB convention.

export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');

export type AuditAction = z.infer<typeof AuditActionSchema>;

export interface AppendAuditInput {
  correlationId: string;
  /** "system" | "user:<id>" | "admin:<id>" | external service name. */
  actor: string;
  actorUserId?: string | null;
  actorAdminId?: string | null;
  /** Free-form "Type:id", e.g. "Role:<uuid>". */
  subject: string;
  action: AuditAction;
  details: Record<string, unknown>;
  /** null for creates. */
  before?: unknown;
  /** null for pure reads. */
  after?: unknown;
}

export interface AuditAppendResult {
  id: string;
  prevHash: string;
  currentHash: string;
  createdAt: Date;
}

export interface AuditLogRecord {
  id: string;
  correlationId: string;
  actor: string;
  actorUserId: string | null;
  actorAdminId: string | null;
  subject: string;
  action: AuditAction;
  /** JSON read back from storage; narrowed by the contract schema at the API edge. */
  details: unknown;
  before: unknown;
  after: unknown;
  prevHash: string;
  currentHash: string;
  createdAt: Date;
}

export interface AuditListQuery {
  actorAdminId?: string;
  actorUserId?: string;
  subject?: string;
  action?: AuditAction;
  from?: Date;
  to?: Date;
  /** Opaque cursor (the previous page's last record id). */
  cursor?: string;
  limit?: number;
}

export interface AuditListResult {
  items: AuditLogRecord[];
  nextCursor: string | null;
}

export interface AuditChainVerifyResult {
  ok: boolean;
  checked: number;
  /** Id of the first row whose recomputed hash/linkage breaks, else null. */
  brokenAt: string | null;
}

export interface IAuditLogRepository {
  append(input: AppendAuditInput): Promise<AuditAppendResult>;
  list(query: AuditListQuery): Promise<AuditListResult>;
  verifyChain(): Promise<AuditChainVerifyResult>;
}
