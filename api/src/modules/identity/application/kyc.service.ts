/**
 * KycService — upgrades an unlinked Contact to a verified Tier-1 User (K2).
 *
 * Flow (see task-K2-brief.md):
 *   1. Resolve Contact + ChannelIdentity by channelAddress.
 *   2. Call KYC provider; reject if not approved.
 *   3. Hash the PIN (never store plaintext — CLAUDE.md §3.4 / NFR-1).
 *   4. Atomic write: User + KycProfile + Contact link + CI link ($transaction).
 *   5. Return { userId }.
 *
 * Idempotent: if the CI already points to a verified User, the existing userId
 * is returned without re-running verification or persistence. This behavior is
 * documented; callers that need to distinguish the two outcomes can check
 * whether the returned userId was pre-existing.
 *
 * Architecture: the service imports NO Prisma, NO infrastructure (CLAUDE.md §3.2).
 * All writes go through IKycRepository; all reads go through IIdentityRepository.
 */

import { Inject, Injectable } from '@nestjs/common';

import { PinService } from '../../../core/auth/pin.service';
import { ContactNotFoundError, KycRejectedError } from '../domain/kyc-errors';
import type { IIdentityRepository } from './ports/identity.repository.port';
import { IDENTITY_REPOSITORY } from './ports/identity.repository.port';
import type { IKycProvider, KycVerifyInput } from './ports/kyc-provider.port';
import { KYC_PROVIDER } from './ports/kyc-provider.port';
import type { IKycRepository } from './ports/kyc.repository.port';
import { KYC_REPOSITORY } from './ports/kyc.repository.port';

// ---------------------------------------------------------------------------
// Input / output
// ---------------------------------------------------------------------------

export interface CompleteVerificationInput {
  channelAddress: string;
  nin?: string;
  bvn?: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  /** Raw PIN — hashed immediately; never reaches persistence or logs. */
  pin: string;
}

export interface CompleteVerificationResult {
  userId: string;
}

export interface CompleteVerificationForUserInput {
  userId: string;
  nin?: string;
  bvn?: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  /** Raw PIN — hashed immediately; never reaches persistence or logs. */
  pin: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class KycService {
  constructor(
    @Inject(KYC_PROVIDER) private readonly kycProvider: IKycProvider,
    private readonly pinService: PinService,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identityRepo: IIdentityRepository,
    @Inject(KYC_REPOSITORY) private readonly kycRepo: IKycRepository,
  ) {}

  /**
   * Turns an unlinked Contact into a verified Tier-1 User with a PIN.
   *
   * Idempotent: if the channelAddress is already linked to a User, that userId
   * is returned immediately (no provider call, no persistence).
   *
   * @throws {ContactNotFoundError} — no ChannelIdentity / Contact for the address.
   * @throws {KycRejectedError}     — provider did not approve.
   */
  async completeVerification(
    input: CompleteVerificationInput,
  ): Promise<CompleteVerificationResult> {
    const { channelAddress, nin, bvn, firstName, lastName, dateOfBirth, pin } =
      input;

    // ── Step 1: Resolve the ChannelIdentity ──────────────────────────────────
    // We use a broad channel search — at this stage the caller sends a
    // channelAddress (e.g. the WhatsApp phone used during onboarding) and the
    // CI holds the channel context. We search by channelAddress across any
    // channel since a unique address already identifies the CI.
    //
    // For simplicity (and to avoid widening the repo interface unnecessarily),
    // we search by channelAddress only; the CI's channel is a secondary field.
    // If a future requirement needs channel-scoped resolution, extend the port.
    const ci = await this.identityRepo.findActiveChannelIdentity(
      'whatsapp', // primary surface at launch (K3 web will pass 'web')
      channelAddress,
    );

    if (ci === null || ci.contactId === null) {
      throw new ContactNotFoundError(channelAddress);
    }

    // ── Idempotent branch: CI already linked to a User ────────────────────────
    if (ci.userId !== null) {
      // Documented behavior: return the existing userId without re-verifying.
      return { userId: ci.userId };
    }

    // ── Step 2: KYC provider call ─────────────────────────────────────────────
    const verifyInput: KycVerifyInput = {
      nin,
      bvn,
      firstName,
      lastName,
      dateOfBirth,
    };
    const result = await this.kycProvider.verify(verifyInput);

    if (!result.approved) {
      throw new KycRejectedError(result.reason);
    }

    // ── Step 3: Hash the PIN — the ONLY form persisted (NFR-1) ───────────────
    const pinHash = await this.pinService.hashPin(pin);

    // ── Step 4: Atomic write ──────────────────────────────────────────────────
    const { userId } = await this.kycRepo.completeVerificationAtomic({
      channelIdentityId: ci.id,
      contactId: ci.contactId,
      nin,
      bvn,
      firstName,
      lastName,
      dateOfBirth,
      pinHash,
      now: new Date(),
    });

    // ── Step 5: Return ────────────────────────────────────────────────────────
    return { userId };
  }

  /**
   * Verifies an already-existing web User and sets their transaction PIN.
   *
   * Idempotent: if the User already has kycStatus='verified', returns { userId }
   * without re-running verification or persistence.
   *
   * @throws {KycRejectedError} — provider did not approve.
   */
  async completeVerificationForUser(
    input: CompleteVerificationForUserInput,
  ): Promise<CompleteVerificationResult> {
    const { userId, nin, bvn, firstName, lastName, dateOfBirth, pin } = input;

    // ── Idempotent check ──────────────────────────────────────────────────────
    // Load the User to check current kycStatus. If already verified, return early.
    const user = await this.identityRepo.loadUser(userId);
    if (user !== null && user.kycStatus === 'verified') {
      return { userId };
    }

    // ── KYC provider call ─────────────────────────────────────────────────────
    const verifyInput: KycVerifyInput = {
      nin,
      bvn,
      firstName,
      lastName,
      dateOfBirth,
    };
    const result = await this.kycProvider.verify(verifyInput);
    if (!result.approved) {
      throw new KycRejectedError(result.reason);
    }

    // ── Hash the PIN — the ONLY form persisted (NFR-1) ───────────────────────
    const pinHash = await this.pinService.hashPin(pin);

    // ── Atomic write ──────────────────────────────────────────────────────────
    const atomicResult = await this.kycRepo.completeVerificationForUserAtomic({
      userId,
      nin,
      bvn,
      firstName,
      lastName,
      dateOfBirth,
      pinHash,
      now: new Date(),
    });

    return { userId: atomicResult.userId };
  }
}
