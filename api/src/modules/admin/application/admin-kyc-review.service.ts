import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  KycQueueItem,
  KycSubmissionDetail,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import {
  IDENTITY_REPOSITORY,
  type AdminUserListRecord,
  type IIdentityRepository,
} from '../../identity/application/ports/identity.repository.port';
import {
  KYC_REPOSITORY,
  type IKycRepository,
} from '../../identity/application/ports/kyc.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';

/** Default page size for the KYC review queue when the caller omits a limit. */
const DEFAULT_QUEUE_LIMIT = 20;

export type KycApprovalTier = 'tier_1' | 'tier_2' | 'tier_3';

export interface KycQueuePage {
  cursor?: string;
  limit?: number;
}

/**
 * ADM-03 KYC review queue — the compliance reviewer's surface. PII is minimized:
 * NIN/BVN are TRUNCATED to last-4 here before they ever leave the backend; the
 * full identifiers never appear in a response. Decisions mirror onto the User so
 * the server-side gate (§3.3) reflects them without a second read. The model
 * never approves KYC — a human admin does, and it is audited.
 */
@Injectable()
export class AdminKycReviewService {
  constructor(
    @Inject(IDENTITY_REPOSITORY)
    private readonly identity: IIdentityRepository,
    @Inject(KYC_REPOSITORY)
    private readonly kyc: IKycRepository,
    private readonly audit: AuditService,
  ) {}

  // ── listQueue ────────────────────────────────────────────────────────────────

  async listQueue(
    page: KycQueuePage,
  ): Promise<{ items: KycQueueItem[]; nextCursor: string | null }> {
    const result = await this.identity.listUsersPendingKycReview({
      cursor: page.cursor,
      limit: page.limit ?? DEFAULT_QUEUE_LIMIT,
    });
    return {
      items: result.items.map((u) => this.toQueueItem(u)),
      nextCursor: result.nextCursor,
    };
  }

  // ── getSubmission ──────────────────────────────────────────────────────────

  async getSubmission(userId: string): Promise<KycSubmissionDetail> {
    const detail = await this.identity.loadUserWithKycAndDevices(userId);
    if (!detail || !detail.kyc) throw new AdminNotFoundError('KYC submission');

    const { kyc } = detail;
    return {
      userId: detail.id,
      firstName: kyc.firstName,
      lastName: kyc.lastName,
      dateOfBirth: kyc.dateOfBirth ? kyc.dateOfBirth.toISOString() : null,
      // PII minimization: last-4 only — the full NIN/BVN never leaves the backend.
      ninLast4: last4(kyc.nin),
      bvnLast4: last4(kyc.bvn),
      idDocumentType: kyc.idDocumentType,
      livenessResult: kyc.livenessCheckResult,
      status: kyc.status as KycSubmissionDetail['status'],
      tier: kyc.tier as KycSubmissionDetail['tier'],
      rejectionReason: kyc.rejectionReason,
    };
  }

  // ── approve ──────────────────────────────────────────────────────────────────

  async approve(
    userId: string,
    tier: KycApprovalTier,
    adminId: string,
  ): Promise<void> {
    const before = await this.identity.loadUserWithKycAndDevices(userId);
    await this.kyc.updateKycProfileDecision(userId, {
      status: 'verified',
      tier,
      reviewedByAdminId: adminId,
    });
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `User:${userId}`,
      action: 'kyc_state_change',
      before: before
        ? { status: before.kycStatus, tier: before.kycTier }
        : null,
      after: { status: 'verified', tier },
    });
  }

  // ── reject ───────────────────────────────────────────────────────────────────

  async reject(userId: string, reason: string, adminId: string): Promise<void> {
    const before = await this.identity.loadUserWithKycAndDevices(userId);
    await this.kyc.updateKycProfileDecision(userId, {
      status: 'rejected',
      tier: 'unverified',
      rejectionReason: reason,
      reviewedByAdminId: adminId,
    });
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `User:${userId}`,
      action: 'kyc_state_change',
      before: before
        ? { status: before.kycStatus, tier: before.kycTier }
        : null,
      after: {
        status: 'rejected',
        tier: 'unverified',
        rejectionReason: reason,
      },
    });
  }

  // ── private mappers ──────────────────────────────────────────────────────────

  private toQueueItem(u: AdminUserListRecord): KycQueueItem {
    return {
      userId: u.id,
      email: u.email,
      status: u.kycStatus as KycQueueItem['status'],
      submittedAt: u.createdAt.toISOString(),
    };
  }
}

function last4(value: string | null): string | null {
  return value ? value.slice(-4) : null;
}
