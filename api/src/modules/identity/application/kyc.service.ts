/**
 * KycService — mints Sumsub WebSDK verification sessions for tier_2/tier_3
 * upgrades.
 *
 * The legacy synchronous NIN/BVN path (`completeVerification` /
 * `completeVerificationForUser`, which backed the retired `POST /kyc/complete`
 * + `POST /kyc/submit` endpoints) has been removed: tier_1 is granted at email
 * verification, and tier_2/tier_3 via the signed Sumsub `applicantReviewed`
 * webhook. This service now owns only the WebSDK-token mint.
 *
 * Architecture: the service imports NO Prisma, NO infrastructure (CLAUDE.md §3.2).
 * All writes go through IKycRepository; all reads through IIdentityRepository.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { KycTier, KycTierLevel } from '@handshake-agent/contracts';

import { SumsubPrerequisiteNotMetError } from '../domain/kyc-errors';
import { tierAtLeast } from '../domain/tier-order';
import type { IIdentityRepository } from './ports/identity.repository.port';
import { IDENTITY_REPOSITORY } from './ports/identity.repository.port';
import type { IKycProvider } from './ports/kyc-provider.port';
import { KYC_PROVIDER } from './ports/kyc-provider.port';
import type { IKycRepository } from './ports/kyc.repository.port';
import { KYC_REPOSITORY } from './ports/kyc.repository.port';

export interface CreateSumsubSessionResult {
  /** Short-lived Sumsub WebSDK access token the frontend passes to the SDK init call. */
  token: string;
  userId: string;
}

@Injectable()
export class KycService {
  constructor(
    @Inject(KYC_PROVIDER) private readonly kycProvider: IKycProvider,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identityRepo: IIdentityRepository,
    @Inject(KYC_REPOSITORY) private readonly kycRepo: IKycRepository,
  ) {}

  /**
   * Mints a Sumsub WebSDK access token so the frontend can launch an
   * in-browser verification session for a `tier_2`/`tier_3` upgrade (task 3.4).
   *
   * Prerequisite (tier ladder — climbed one rung at a time): `level==='tier_2'`
   * requires `tierAtLeast(kycTier, 'tier_1')`; `level==='tier_3'` requires
   * `tierAtLeast(kycTier, 'tier_2')`.
   *
   * Persists the provider's `applicantId` onto the user's KycProfile for later
   * webhook correlation. Deliberately does NOT change `kycStatus`/`kycTier` —
   * the Sumsub `applicantReviewed` webhook owns every status transition, so an
   * abandoned session can never strand the account at "in review".
   *
   * @throws {SumsubPrerequisiteNotMetError} — the account hasn't earned the
   *   prior tier rung yet.
   */
  async createSumsubSession(
    userId: string,
    level: KycTierLevel,
  ): Promise<CreateSumsubSessionResult> {
    const user = await this.identityRepo.loadUser(userId);
    if (user === null) {
      throw new Error(`User not found: ${userId}`);
    }

    const requiredTier: KycTier = level === 'tier_2' ? 'tier_1' : 'tier_2';
    if (!tierAtLeast(user.kycTier as KycTier, requiredTier)) {
      throw new SumsubPrerequisiteNotMetError(
        level,
        requiredTier,
        user.kycTier,
      );
    }

    const { token, applicantId } =
      await this.kycProvider.createVerificationSession({ userId, level });

    await this.kycRepo.setSumsubApplicantId(userId, applicantId);

    return { token, userId };
  }
}
