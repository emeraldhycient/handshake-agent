import { Inject, Injectable } from '@nestjs/common';

import type {
  AuditChainVerifyResponse,
  AuditLogEntry,
  AuditLogListResponse,
} from '@handshake-agent/contracts';

/** Page size used to DRAIN the full audit log for a CSV export (keyset walk). */
const EXPORT_PAGE_SIZE = 200;

/**
 * Hard safety cap on export pages so a malformed cursor loop can never hang the
 * request. At {@link EXPORT_PAGE_SIZE} rows/page this bounds an export to 200k
 * rows — far beyond any realistic filtered admin export.
 */
const EXPORT_MAX_PAGES = 1000;

import { AuditService } from '../../../core/audit/application/audit.service';
import type {
  AuditListQuery,
  AuditLogRecord,
} from '../../../core/audit/application/ports/audit-log.repository.port';
import {
  ADMIN_USER_REPOSITORY,
  type IAdminUserRepository,
} from './ports/admin-user.repository.port';

/**
 * Phase 6b (READ enrichment) — the admin AUDIT-LOG read service. It wraps the
 * core append-only, hash-chained {@link AuditService} read path and projects two
 * display-only fields the console needs but the immutable row never stored:
 *
 *   - `actorRole` — the admin role NAME, resolved from `actorAdminId` via the
 *     admin identity store. `null` for non-admin actors (system / end user) or
 *     when the admin can't be resolved. Resolved once per distinct admin id per
 *     page (no N+1).
 *   - `reason` — a first-class human reason, projected from `details.reason`
 *     when a non-empty string is present, else `null`.
 *
 * Both are computed at READ time — they are NOT part of the hashed row, so the
 * chain integrity check is untouched (§ audit immutability). This service moves
 * no money (§3.1) and holds no Prisma import — it reaches the admin store only
 * through the injected {@link IAdminUserRepository} port (§3.2).
 */
@Injectable()
export class AdminAuditService {
  constructor(
    private readonly audit: AuditService,
    @Inject(ADMIN_USER_REPOSITORY)
    private readonly admins: IAdminUserRepository,
  ) {}

  async list(query: AuditListQuery): Promise<AuditLogListResponse> {
    const page = await this.audit.list(query);
    return {
      items: await this.enrich(page.items),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Build the FULL set of audit rows for a CSV export — the SAME filter pipeline
   * as {@link list}, but with no caller cursor/limit: every matching row is
   * drained by walking the keyset pages, and each row is enriched with the same
   * (actorRole + projected reason) display fields. READ-ONLY — the hash-chained
   * log is never mutated; the controller records the `admin_export` event with
   * the resulting rowCount.
   */
  async exportRows(query: AuditListQuery): Promise<AuditLogEntry[]> {
    const rows: AuditLogEntry[] = [];

    let cursor: string | undefined = undefined;
    for (let page = 0; page < EXPORT_MAX_PAGES; page += 1) {
      const result = await this.audit.list({
        ...query,
        cursor,
        limit: EXPORT_PAGE_SIZE,
      });
      rows.push(...(await this.enrich(result.items)));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    return rows;
  }

  verifyChain(): Promise<AuditChainVerifyResponse> {
    return this.audit.verifyChain();
  }

  /**
   * Enrich a page of raw audit records with the two display-only fields the
   * console needs (per-actor role + projected reason). Resolves each distinct
   * actor-admin id exactly once per call (no N+1), then maps every row.
   */
  private async enrich(records: AuditLogRecord[]): Promise<AuditLogEntry[]> {
    const distinctAdminIds = [
      ...new Set(
        records
          .map((r) => r.actorAdminId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const roleById = new Map<string, string | null>();
    await Promise.all(
      distinctAdminIds.map(async (id) => {
        const admin = await this.admins.findById(id);
        roleById.set(id, admin?.roleName ?? null);
      }),
    );
    return records.map((record) =>
      toEntry(record, roleFor(record.actorAdminId, roleById)),
    );
  }
}

/** Role name for a row's actor-admin id from the resolved map (null if absent). */
function roleFor(
  actorAdminId: string | null,
  roleById: Map<string, string | null>,
): string | null {
  if (actorAdminId === null) return null;
  return roleById.get(actorAdminId) ?? null;
}

/** Project `details.reason` to a first-class reason (non-empty string, else null). */
function reasonFrom(details: unknown): string | null {
  if (details === null || typeof details !== 'object') return null;
  const reason = (details as Record<string, unknown>).reason;
  return typeof reason === 'string' && reason.length > 0 ? reason : null;
}

/** Serialize a stored audit record + resolved role into the contract entry shape. */
function toEntry(
  record: AuditLogRecord,
  actorRole: string | null,
): AuditLogEntry {
  return {
    id: record.id,
    correlationId: record.correlationId,
    actor: record.actor,
    actorAdminId: record.actorAdminId,
    actorUserId: record.actorUserId,
    actorRole,
    subject: record.subject,
    action: record.action,
    details: (record.details ?? {}) as Record<string, unknown>,
    before: record.before ?? null,
    after: record.after ?? null,
    reason: reasonFrom(record.details),
    currentHash: record.currentHash,
    prevHash: record.prevHash,
    createdAt: record.createdAt.toISOString(),
  };
}
