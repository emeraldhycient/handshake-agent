/**
 * Prisma adapter for IKycRepository (K2).
 *
 * Lives in the infrastructure layer — the ONLY place that imports PrismaService
 * and the generated Prisma client (CLAUDE.md §3.2 / §4.1).
 *
 * NFR-1: NIN/BVN are NDPR-regulated Nigerian national IDs. They are decrypted
 * on read via `core/crypto/field-encryption` (AES-256-GCM). The columns stay
 * TEXT (the ciphertext is a string) — no schema migration.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Generated Prisma types and enums. Only infrastructure imports these.
import {
  KycStatus,
  KycTier,
  LivenessCheckResult,
} from '../../../../generated/prisma/client';
import {
  decryptField,
  FieldEncryptionKeyError,
} from '../../../core/crypto/field-encryption';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type { KycTierValue } from '../application/ports/kyc-provider.port';
import type {
  GrantSumsubTierInput,
  GrantSumsubTierResult,
  IKycRepository,
  MarkSumsubStatusResult,
  UpdateKycProfileDecisionInput,
} from '../application/ports/kyc.repository.port';

/** Ordinal tier ladder — mirrors identity/domain/tier-order.ts's TIER_ORDER, but
 * expressed against the Prisma `KycTier` enum (infrastructure-only). Used to
 * compute the "strictly below target" set for the atomic no-downgrade guard in
 * `grantSumsubTier` — a single conditional UPDATE, not a read-then-write. */
const KYC_TIER_LADDER: KycTier[] = [
  KycTier.unverified,
  KycTier.tier_1,
  KycTier.tier_2,
  KycTier.tier_3,
];

function tiersBelow(target: KycTier): KycTier[] {
  return KYC_TIER_LADDER.slice(0, KYC_TIER_LADDER.indexOf(target));
}

/** The complement of `tiersBelow` — used by `downgradeSumsubTier`'s guarded
 * downgrade (WHERE kycTier IN tiersAbove(target)): a user strictly ABOVE the
 * RED-downgrade target actually gets downgraded; a user already at/below it
 * is left untouched (idempotent, never raises a tier). */
function tiersAbove(target: KycTier): KycTier[] {
  return KYC_TIER_LADDER.slice(KYC_TIER_LADDER.indexOf(target) + 1);
}

@Injectable()
export class KycPrismaRepository implements IKycRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Decrypts a stored NIN/BVN ciphertext, or returns `null` when absent.
   * Throws if the key is missing (a present ciphertext cannot be read without
   * it) or if the blob fails GCM authentication (tamper).
   */
  decryptIdentifier(blob: string | null): string | null {
    if (blob === null || blob === '') return null;
    const key = this.config.get<string>('KYC_ENCRYPTION_KEY') ?? '';
    if (!key) {
      throw new FieldEncryptionKeyError(
        'KYC_ENCRYPTION_KEY is not set — cannot decrypt NIN/BVN',
      );
    }
    return decryptField(blob, key);
  }

  /**
   * Applies an admin KYC-review decision atomically: the KycProfile and the
   * mirrored User fields (kycStatus/kycTier) move together so the server-side
   * gate (§3.3) never observes a partial decision. verifiedAt is stamped only
   * when the decision verifies; rejectionReason is persisted as provided.
   */
  async updateKycProfileDecision(
    userId: string,
    decision: UpdateKycProfileDecisionInput,
  ): Promise<void> {
    const { status, tier, rejectionReason, reviewedByAdminId } = decision;
    const verified = status === KycStatus.verified;

    await this.prisma.$transaction(async (tx) => {
      await tx.kycProfile.update({
        where: { userId },
        data: {
          status: status as KycStatus,
          tier: tier as KycTier,
          rejectionReason: rejectionReason ?? null,
          reviewedByAdminId,
          verifiedAt: verified ? new Date() : null,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          kycStatus: status as KycStatus,
          kycTier: tier as KycTier,
        },
      });
    });
  }

  /**
   * Bounces a submission back to the user for more information (Phase 9). Sets
   * the KycProfile to `needs_info` + reviewer attribution and mirrors the status
   * onto the User in one $transaction so the server-side gate (§3.3) never sees
   * a partial state. Tier/verifiedAt/rejectionReason are deliberately left
   * untouched — the review is PAUSED, not decided. The operator's reason lives
   * in the AuditLog, not on this row.
   */
  async markKycNeedsInfo(
    userId: string,
    reviewedByAdminId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.kycProfile.update({
        where: { userId },
        data: { status: KycStatus.needs_info, reviewedByAdminId },
      });

      await tx.user.update({
        where: { id: userId },
        data: { kycStatus: KycStatus.needs_info },
      });
    });
  }

  /**
   * Upserts KycProfile.sumsubApplicantId (task 3.4). Creates the profile if
   * none exists yet — status/tier take their schema defaults (`not_started`/
   * `unverified`) — or updates the applicant id on an existing row. Does NOT
   * touch status/tier: the Sumsub webhook (later task) owns those transitions.
   */
  async setSumsubApplicantId(
    userId: string,
    applicantId: string,
  ): Promise<void> {
    await this.prisma.kycProfile.upsert({
      where: { userId },
      create: { userId, sumsubApplicantId: applicantId },
      update: { sumsubApplicantId: applicantId },
    });
  }

  /**
   * Sumsub GREEN review → tier grant (task 3.6). See the port doc for the full
   * atomic/idempotent/no-downgrade contract — the guard is a single conditional
   * `updateMany` (WHERE kycTier IN <tiers strictly below target>), not a
   * read-then-write, so there is no TOCTOU race with a concurrent redelivery.
   */
  async grantSumsubTier(
    input: GrantSumsubTierInput,
  ): Promise<GrantSumsubTierResult> {
    const { userId, applicantId, livenessCheckResult } = input;
    const targetTier: KycTier = input.tier;
    const now = new Date();
    const resolvedLiveness =
      (livenessCheckResult as LivenessCheckResult | undefined) ??
      LivenessCheckResult.passed;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: userId, kycTier: { in: tiersBelow(targetTier) } },
        data: {
          kycStatus: KycStatus.verified,
          kycTier: targetTier,
          tierChangedAt: now,
        },
      });

      if (updated.count === 0) {
        // Idempotent no-op: either the userId doesn't match any User row, or
        // the user is already at/above `targetTier` (a redelivered/out-of-order
        // GREEN). Either way: no downgrade, no tierChangedAt re-stamp.
        return { granted: false };
      }

      await tx.kycProfile.upsert({
        where: { userId },
        create: {
          userId,
          status: KycStatus.verified,
          tier: targetTier,
          sumsubApplicantId: applicantId ?? null,
          livenessCheckResult: resolvedLiveness,
          verifiedAt: now,
        },
        update: {
          status: KycStatus.verified,
          tier: targetTier,
          ...(applicantId ? { sumsubApplicantId: applicantId } : {}),
          livenessCheckResult: resolvedLiveness,
          verifiedAt: now,
        },
      });

      return { granted: true };
    });
  }

  /**
   * Sumsub RED review → rejection (task 3.6). Tier is never touched — see the
   * port doc for why this is intentionally NOT guarded against an existing
   * `verified` status (a RED review is authoritative and must apply regardless).
   */
  async markSumsubRejected(
    userId: string,
    reason: string,
  ): Promise<MarkSumsubStatusResult> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: userId },
        data: { kycStatus: KycStatus.rejected },
      });

      if (updated.count === 0) {
        return { found: false };
      }

      await tx.kycProfile.upsert({
        where: { userId },
        create: { userId, status: KycStatus.rejected, rejectionReason: reason },
        update: { status: KycStatus.rejected, rejectionReason: reason },
      });

      return { found: true };
    });
  }

  /**
   * A Sumsub webhook with no `reviewResult` → pending_review (task 3.6),
   * GUARDED against overwriting an existing `verified` status via a single
   * conditional `updateMany` (WHERE kycStatus != verified) — no TOCTOU race.
   * When the guard blocks the write (0 rows matched), a separate existence
   * check distinguishes "already verified" (found: true, no-op) from "no such
   * user" (found: false) for the caller's logging — this extra read never
   * affects the atomicity of the actual state mutation above.
   */
  async markSumsubPendingReview(
    userId: string,
  ): Promise<MarkSumsubStatusResult> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: userId, kycStatus: { not: KycStatus.verified } },
        data: { kycStatus: KycStatus.pending_review },
      });

      if (updated.count === 0) {
        const existing = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true },
        });
        return { found: existing !== null };
      }

      await tx.kycProfile.upsert({
        where: { userId },
        create: { userId, status: KycStatus.pending_review },
        update: { status: KycStatus.pending_review },
      });

      return { found: true };
    });
  }

  /**
   * Sumsub RED review at a KNOWN level → auto-downgrade (task R-red-downgrade).
   * See the port doc for the full atomic/idempotent/no-raise contract. Two
   * conditional writes in ONE $transaction, mirroring `grantSumsubTier`'s
   * no-TOCTOU shape:
   *   1. Unconditional (for an existing user): `User.kycStatus='rejected'`.
   *   2. GUARDED: `User.kycTier` → `targetTier` (+ `tierChangedAt=now`) only
   *      when the row's CURRENT `kycTier` is strictly ABOVE `targetTier`
   *      (`WHERE kycTier IN tiersAbove(targetTier)`) — a single conditional
   *      `updateMany`, not a read-then-write.
   *
   * The `KycProfile` upsert always sets `status`/`rejectionReason`, and
   * additionally sets `tier` only when step 2 actually wrote a row — so a
   * no-op downgrade never touches the profile's tier either.
   */
  async downgradeSumsubTier(
    userId: string,
    targetTier: KycTierValue,
    reason: string,
  ): Promise<MarkSumsubStatusResult> {
    const target: KycTier = targetTier;
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const rejected = await tx.user.updateMany({
        where: { id: userId },
        data: { kycStatus: KycStatus.rejected },
      });

      if (rejected.count === 0) {
        return { found: false };
      }

      const downgraded = await tx.user.updateMany({
        where: { id: userId, kycTier: { in: tiersAbove(target) } },
        data: { kycTier: target, tierChangedAt: now },
      });

      await tx.kycProfile.upsert({
        where: { userId },
        create: {
          userId,
          status: KycStatus.rejected,
          rejectionReason: reason,
          ...(downgraded.count > 0 ? { tier: target } : {}),
        },
        update: {
          status: KycStatus.rejected,
          rejectionReason: reason,
          ...(downgraded.count > 0 ? { tier: target } : {}),
        },
      });

      return { found: true };
    });
  }
}
