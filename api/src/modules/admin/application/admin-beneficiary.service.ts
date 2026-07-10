import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  AdminBeneficiary,
  AdminBeneficiaryListResponse,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import {
  BENEFICIARY_REPOSITORY,
  type IBeneficiaryRepository,
  type BeneficiaryRecord,
} from '../../beneficiaries/application/ports/beneficiary.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';
import { toIso } from './iso-date.util';

/** Default page size for the admin beneficiary list when the caller omits one. */
const DEFAULT_LIST_LIMIT = 50;

/** List query — `now` is injectable so coolingOffActive is deterministic in tests. */
export interface AdminBeneficiaryListQuery {
  limit?: number;
  now?: Date;
}

/**
 * Phase 3 (sub-area D) — the admin BENEFICIARY OVERSIGHT service: a read-only
 * listing of saved payout destinations and the first-use cooling-off override.
 *
 * It NEVER moves money (§3.1) and holds no Prisma import — it reaches data only
 * through the injected BENEFICIARY_REPOSITORY port (§3.2). The override clears
 * the cooling-off lock and is audited as an `admin_override` (subject
 * `Beneficiary:<id>`). Sensitive fields (account number, address) are NOT
 * surfaced — only label + verification + cooling-off state.
 */
@Injectable()
export class AdminBeneficiaryService {
  constructor(
    @Inject(BENEFICIARY_REPOSITORY)
    private readonly beneficiaries: IBeneficiaryRepository,
    private readonly audit: AuditService,
  ) {}

  // ── list ───────────────────────────────────────────────────────────────────

  async list(
    query: AdminBeneficiaryListQuery = {},
  ): Promise<AdminBeneficiaryListResponse> {
    const now = query.now ?? new Date();
    const rows = await this.beneficiaries.listAll({
      limit: query.limit ?? DEFAULT_LIST_LIMIT,
    });
    return { items: rows.map((b) => toAdminBeneficiary(b, now)) };
  }

  // ── overrideCoolingOff ──────────────────────────────────────────────────────

  /**
   * Clears a beneficiary's first-use cooling-off lock (IDN-08) and audits the
   * override. Throws AdminNotFoundError (→ 404) when the beneficiary is absent.
   */
  async overrideCoolingOff(
    beneficiaryId: string,
    adminId: string,
  ): Promise<void> {
    const before = await this.beneficiaries.findById(beneficiaryId);
    if (before === null) throw new AdminNotFoundError('Beneficiary');

    await this.beneficiaries.clearCoolingOff(beneficiaryId);

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Beneficiary:${beneficiaryId}`,
      action: 'admin_override',
      before: { firstUseLockedUntil: toIso(before.firstUseLockedUntil) },
      after: { firstUseLockedUntil: null },
    });
  }

  // ── remove (Phase 9 — admin-initiated soft-delete) ──────────────────────────

  /**
   * Admin-initiated removal of a saved payout destination: SOFT-deletes it (sets
   * `deletedAt`) so it disappears from the user's picker while funds-safety history
   * is preserved. It moves NO money (§3.1) — a beneficiary is only a destination
   * record, never a balance.
   *
   * The owning `userId` is resolved SERVER-SIDE from the beneficiary record (never
   * trusted from the client, §3.3) and passed to the existing owner-scoped
   * `softDelete`, so the same delete path — and the same idempotency guarantees —
   * as the end-user route is reused (no admin-only bypass of ownership scoping).
   * The mutation is audited as `beneficiary_remove` (subject `Beneficiary:<id>`)
   * with the operator's justification.
   *
   * Throws AdminNotFoundError (→ 404) when the beneficiary is absent or already
   * soft-deleted (the delete then matches no active row).
   */
  async remove(
    beneficiaryId: string,
    reason: string,
    adminId: string,
  ): Promise<void> {
    const before = await this.beneficiaries.findById(beneficiaryId);
    if (before === null) throw new AdminNotFoundError('Beneficiary');

    const deleted = await this.beneficiaries.softDelete(
      before.userId,
      beneficiaryId,
    );
    if (!deleted) throw new AdminNotFoundError('Beneficiary');

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Beneficiary:${beneficiaryId}`,
      action: 'beneficiary_remove',
      before: { deletedAt: toIso(before.deletedAt) },
      after: { deleted: true, reason },
    });
  }
}

// ── mapper (record → contract shape) ────────────────────────────────────────────

function toAdminBeneficiary(b: BeneficiaryRecord, now: Date): AdminBeneficiary {
  const lockedUntil = b.firstUseLockedUntil;
  return {
    id: b.id,
    userId: b.userId,
    type: b.type,
    label: b.label,
    verificationStatus: b.verificationStatus,
    firstUseLockedUntil: toIso(lockedUntil),
    coolingOffActive:
      lockedUntil !== null && lockedUntil.getTime() > now.getTime(),
    createdAt: b.createdAt.toISOString(),
  };
}
