/**
 * Prisma adapter for IKycRepository (K2).
 *
 * Lives in the infrastructure layer — the ONLY place that imports PrismaService
 * and the generated Prisma client (CLAUDE.md §3.2 / §4.1).
 *
 * The single public method, `completeVerificationAtomic`, wraps all writes in
 * a $transaction so the Contact → User upgrade is atomic. If ANY step fails the
 * entire transaction rolls back and no partial state is persisted.
 *
 * NFR-1: NIN/BVN are NDPR-regulated Nigerian national IDs. They are encrypted
 * at rest with AES-256-GCM (see `core/crypto/field-encryption`) before they
 * touch the DB and decrypted on read. The columns stay TEXT (the ciphertext is
 * a string) — no schema migration.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Generated Prisma types and enums. Only infrastructure imports these.
import {
  KycStatus,
  KycTier,
  LivenessCheckResult,
  UserStatus,
  VerificationStatus,
} from '../../../../generated/prisma/client';
import {
  decryptField,
  encryptField,
  FieldEncryptionKeyError,
} from '../../../core/crypto/field-encryption';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type { KycTierValue } from '../application/ports/kyc-provider.port';
import type {
  CompleteVerificationAtomicInput,
  CompleteVerificationAtomicResult,
  CompleteVerificationForUserAtomicInput,
  CompleteVerificationForUserAtomicResult,
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
   * Encrypts a sensitive identifier (NIN/BVN) for at-rest storage, or returns
   * `null` when absent. Fail-closed (NFR-1): if a value IS present but no
   * KYC_ENCRYPTION_KEY is configured, throw rather than persist plaintext —
   * the boot guard normally blocks startup, this is the in-repo backstop.
   */
  private encryptIdentifier(value: string | undefined): string | null {
    if (value === undefined || value === null) return null;
    const key = this.config.get<string>('KYC_ENCRYPTION_KEY') ?? '';
    if (!key) {
      throw new FieldEncryptionKeyError(
        'KYC_ENCRYPTION_KEY is not set — refusing to store NIN/BVN in plaintext',
      );
    }
    return encryptField(value, key);
  }

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
   * Atomically:
   *   1. Creates a User (status=active, kycStatus=verified, kycTier=input.tier, pinHash).
   *   2. Creates a KycProfile (status=verified, tier=input.tier, identity fields, verifiedAt=now).
   *   3. Links the Contact (linkedUserId = user.id).
   *   4. Updates the ChannelIdentity (userId = user.id, verificationStatus=verified, verifiedAt=now).
   *
   * NIN/BVN are AES-256-GCM-encrypted before they reach the DB (NFR-1). The
   * tier is whatever IKycProvider granted (input.tier) — never hardcoded here.
   */
  async completeVerificationAtomic(
    input: CompleteVerificationAtomicInput,
  ): Promise<CompleteVerificationAtomicResult> {
    const {
      channelIdentityId,
      contactId,
      nin,
      bvn,
      firstName,
      lastName,
      dateOfBirth,
      pinHash,
      tier,
      now,
    } = input;

    // Encrypt PII outside the transaction (fail-closed before any write).
    const ninEnc = this.encryptIdentifier(nin);
    const bvnEnc = this.encryptIdentifier(bvn);

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create the User
      const user = await tx.user.create({
        data: {
          status: UserStatus.active,
          kycStatus: KycStatus.verified,
          kycTier: tier,
          // Stamp the initial tier grant so the gate can enforce the cooling-off.
          tierChangedAt: new Date(),
          pinHash,
        },
        select: { id: true },
      });

      // 2. Create the KycProfile (1:1 with User)
      await tx.kycProfile.create({
        data: {
          userId: user.id,
          status: KycStatus.verified,
          tier,
          nin: ninEnc,
          bvn: bvnEnc,
          firstName,
          lastName,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          verifiedAt: now,
        },
      });

      // 3. Link the Contact → User
      await tx.contact.update({
        where: { id: contactId },
        data: { linkedUserId: user.id },
      });

      // 4. Link the ChannelIdentity → User and mark as verified
      await tx.channelIdentity.update({
        where: { id: channelIdentityId },
        data: {
          userId: user.id,
          contactId: null, // CI now points to User; Contact retains the history via linkedUserId
          verificationStatus: VerificationStatus.verified,
          verifiedAt: now,
        },
      });

      return { userId: user.id };
    });

    return result;
  }

  /**
   * Atomically upgrades an existing web-native User to verified status at the
   * provider-granted tier:
   *   1. Upserts the KycProfile (web users have no KycProfile yet at this point).
   *   2. Updates the User row: kycStatus=verified, kycTier=input.tier, status=active, pinHash.
   *
   * NIN/BVN are AES-256-GCM-encrypted before they reach the DB (NFR-1). The
   * tier is whatever IKycProvider granted (input.tier) — never hardcoded here.
   */
  async completeVerificationForUserAtomic(
    input: CompleteVerificationForUserAtomicInput,
  ): Promise<CompleteVerificationForUserAtomicResult> {
    const {
      userId,
      nin,
      bvn,
      firstName,
      lastName,
      dateOfBirth,
      pinHash,
      tier,
      now,
    } = input;

    // Encrypt PII outside the transaction (fail-closed before any write).
    const ninEnc = this.encryptIdentifier(nin);
    const bvnEnc = this.encryptIdentifier(bvn);

    await this.prisma.$transaction(async (tx) => {
      // 1. Upsert the KycProfile (web users have no KycProfile yet)
      await tx.kycProfile.upsert({
        where: { userId },
        create: {
          userId,
          status: KycStatus.verified,
          tier,
          nin: ninEnc,
          bvn: bvnEnc,
          firstName,
          lastName,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          verifiedAt: now,
        },
        update: {
          status: KycStatus.verified,
          tier,
          nin: ninEnc,
          bvn: bvnEnc,
          firstName,
          lastName,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          verifiedAt: now,
        },
      });

      // 2. Update the User
      await tx.user.update({
        where: { id: userId },
        data: {
          kycStatus: KycStatus.verified,
          kycTier: tier,
          // Stamp the tier grant so the gate can enforce the post-change cooling-off.
          tierChangedAt: new Date(),
          status: UserStatus.active,
          pinHash,
        },
      });
    });

    return { userId };
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
   * Sumsub RED review at an UNMAPPED/absent level → rejection + fail-closed tier
   * re-lock (task 3.6, hardened). Sets `kycStatus='rejected'` AND drops any
   * ELEVATED grant (tier_2/tier_3) to the `tier_1` (email-verified) FLOOR.
   *
   * Why the tier drop is mandatory: the money gate keys on `kycTier`, not
   * `kycStatus`. A status-only rejection would leave a flagged user at tier_2/3,
   * still able to send/sell/swap — so an unmappable adverse Sumsub finding
   * (ongoing AML/PEP monitoring, an action-review RED, or a RED with no
   * levelName) has to lower the tier to actually re-lock those capabilities.
   * Since the level can't be attributed to a specific rung, it fails closed to
   * tier_1 (mirroring `downgradeSumsubTier` with target=tier_1).
   *
   * Two conditional writes in ONE $transaction (no TOCTOU):
   *   1. Unconditional (for an existing user): `kycStatus='rejected'`.
   *   2. GUARDED: `kycTier → tier_1` (+ `tierChangedAt`) only when the current
   *      tier is strictly ABOVE tier_1 — never raises a tier, never re-stamps
   *      tierChangedAt for a user already at/below tier_1.
   */
  async markSumsubRejected(
    userId: string,
    reason: string,
  ): Promise<MarkSumsubStatusResult> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const rejected = await tx.user.updateMany({
        where: { id: userId },
        data: { kycStatus: KycStatus.rejected },
      });

      if (rejected.count === 0) {
        return { found: false };
      }

      const relocked = await tx.user.updateMany({
        where: { id: userId, kycTier: { in: tiersAbove(KycTier.tier_1) } },
        data: { kycTier: KycTier.tier_1, tierChangedAt: now },
      });

      await tx.kycProfile.upsert({
        where: { userId },
        create: {
          userId,
          status: KycStatus.rejected,
          rejectionReason: reason,
          ...(relocked.count > 0 ? { tier: KycTier.tier_1 } : {}),
        },
        update: {
          status: KycStatus.rejected,
          rejectionReason: reason,
          ...(relocked.count > 0 ? { tier: KycTier.tier_1 } : {}),
        },
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
