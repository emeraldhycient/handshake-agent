/**
 * Prisma adapter for IKycRepository (K2).
 *
 * Lives in the infrastructure layer — the ONLY place that imports PrismaService
 * and the generated Prisma client (CLAUDE.md §3.2 / §4.1).
 *
 * The single public method, `completeVerificationAtomic`, wraps all writes in
 * a $transaction so the Contact → User upgrade is atomic. If ANY step fails the
 * entire transaction rolls back and no partial state is persisted.
 */

import { Injectable } from '@nestjs/common';

// Generated Prisma types and enums. Only infrastructure imports these.
import {
  KycStatus,
  KycTier,
  UserStatus,
  VerificationStatus,
} from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CompleteVerificationAtomicInput,
  CompleteVerificationAtomicResult,
  CompleteVerificationForUserAtomicInput,
  CompleteVerificationForUserAtomicResult,
  IKycRepository,
} from '../application/ports/kyc.repository.port';

@Injectable()
export class KycPrismaRepository implements IKycRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically:
   *   1. Creates a User (status=active, kycStatus=verified, kycTier=tier_1, pinHash).
   *   2. Creates a KycProfile (status=verified, tier=tier_1, identity fields, verifiedAt=now).
   *   3. Links the Contact (linkedUserId = user.id).
   *   4. Updates the ChannelIdentity (userId = user.id, verificationStatus=verified, verifiedAt=now).
   *
   * NOTE: nin/bvn stored plain for the skeleton.
   * TODO(NFR-1): encrypt nin/bvn at rest before production.
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
      now,
    } = input;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create the User
      const user = await tx.user.create({
        data: {
          status: UserStatus.active,
          kycStatus: KycStatus.verified,
          kycTier: KycTier.tier_1,
          pinHash,
        },
        select: { id: true },
      });

      // 2. Create the KycProfile (1:1 with User)
      // NOTE: nin/bvn stored plain — TODO(NFR-1): encrypt at rest.
      await tx.kycProfile.create({
        data: {
          userId: user.id,
          status: KycStatus.verified,
          tier: KycTier.tier_1,
          nin: nin ?? null,
          bvn: bvn ?? null,
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
   * Atomically upgrades an existing web-native User to Tier-1 verified status:
   *   1. Upserts the KycProfile (web users have no KycProfile yet at this point).
   *   2. Updates the User row: kycStatus=verified, kycTier=tier_1, status=active, pinHash.
   *
   * NOTE: nin/bvn stored plain for the skeleton.
   * TODO(NFR-1): encrypt nin/bvn at rest before production.
   */
  async completeVerificationForUserAtomic(
    input: CompleteVerificationForUserAtomicInput,
  ): Promise<CompleteVerificationForUserAtomicResult> {
    const { userId, nin, bvn, firstName, lastName, dateOfBirth, pinHash, now } =
      input;

    await this.prisma.$transaction(async (tx) => {
      // 1. Upsert the KycProfile (web users have no KycProfile yet)
      // NOTE: nin/bvn stored plain — TODO(NFR-1): encrypt at rest.
      await tx.kycProfile.upsert({
        where: { userId },
        create: {
          userId,
          status: KycStatus.verified,
          tier: KycTier.tier_1,
          nin: nin ?? null,
          bvn: bvn ?? null,
          firstName,
          lastName,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          verifiedAt: now,
        },
        update: {
          status: KycStatus.verified,
          tier: KycTier.tier_1,
          nin: nin ?? null,
          bvn: bvn ?? null,
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
          kycTier: KycTier.tier_1,
          status: UserStatus.active,
          pinHash,
        },
      });
    });

    return { userId };
  }
}
