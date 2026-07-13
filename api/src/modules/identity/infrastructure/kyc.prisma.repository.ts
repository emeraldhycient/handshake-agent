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
  UserStatus,
  VerificationStatus,
} from '../../../../generated/prisma/client';
import {
  decryptField,
  encryptField,
  FieldEncryptionKeyError,
} from '../../../core/crypto/field-encryption';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CompleteVerificationAtomicInput,
  CompleteVerificationAtomicResult,
  CompleteVerificationForUserAtomicInput,
  CompleteVerificationForUserAtomicResult,
  IKycRepository,
  UpdateKycProfileDecisionInput,
} from '../application/ports/kyc.repository.port';

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
}
