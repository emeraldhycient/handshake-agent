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

function toIso(value: Date | null): string | null {
  return value !== null ? value.toISOString() : null;
}
