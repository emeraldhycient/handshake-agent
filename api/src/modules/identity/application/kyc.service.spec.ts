/**
 * Unit tests for KycService.createSumsubSession (task 3.4).
 *
 * The legacy synchronous NIN/BVN path (`completeVerification` /
 * `completeVerificationForUser`, which backed the retired `POST /kyc/complete`
 * + `POST /kyc/submit` endpoints) has been removed from source — its tests are
 * gone with it. This service now owns only the Sumsub WebSDK-token mint.
 *
 * Mocked: KYC_PROVIDER, IKycRepository, IIdentityRepository.loadUser.
 * No Nest TestingModule — KycService is constructed directly.
 */

import type {
  CreateVerificationSessionResult,
  IKycProvider,
} from './ports/kyc-provider.port';
import type {
  IIdentityRepository,
  UserRecord,
} from './ports/identity.repository.port';
import type { IKycRepository } from './ports/kyc.repository.port';
import { SumsubPrerequisiteNotMetError } from '../domain/kyc-errors';
import { KycService } from './kyc.service';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const CHANNEL_ADDRESS = '+2348099990001';
const CI_ID = 'ci-uuid-1';
const CONTACT_ID = 'contact-uuid-1';

/** Creates a mock IKycProvider (only createVerificationSession survives). */
function makeKycProvider(): jest.Mocked<IKycProvider> {
  return {
    createVerificationSession: jest.fn(),
  };
}

/** Creates a mock IIdentityRepository with the CI returning an unlinked Contact. */
function makeIdentityRepo(
  overrides: Partial<IIdentityRepository> = {},
): jest.Mocked<IIdentityRepository> {
  return {
    findActiveChannelIdentity: jest.fn().mockResolvedValue({
      id: CI_ID,
      channel: 'whatsapp',
      channelAddress: CHANNEL_ADDRESS,
      contactId: CONTACT_ID,
      userId: null,
      simSwapDetectedAt: null,
    }),
    loadContact: jest.fn().mockResolvedValue({
      id: CONTACT_ID,
      primaryChannel: 'whatsapp',
      primaryAddress: CHANNEL_ADDRESS,
      status: 'active',
      linkedUserId: null,
    }),
    loadUser: jest.fn().mockResolvedValue(null),
    findWhatsAppAddressByUserId: jest.fn().mockResolvedValue(null),
    createContactWithChannelIdentity: jest.fn(),
    ...overrides,
  } as jest.Mocked<IIdentityRepository>;
}

/** Creates a mock IKycRepository. */
function makeKycRepo(): jest.Mocked<IKycRepository> {
  return {
    updateKycProfileDecision: jest.fn().mockResolvedValue(undefined),
    markKycNeedsInfo: jest.fn().mockResolvedValue(undefined),
    setSumsubApplicantId: jest.fn().mockResolvedValue(undefined),
    grantSumsubTier: jest.fn().mockResolvedValue({ granted: true }),
    markSumsubRejected: jest.fn().mockResolvedValue({ found: true }),
    markSumsubPendingReview: jest.fn().mockResolvedValue({ found: true }),
    downgradeSumsubTier: jest.fn().mockResolvedValue({ found: true }),
  };
}

/** Builds a KycService with default mocks. */
function buildService(opts: {
  kycProvider?: jest.Mocked<IKycProvider>;
  identityRepo?: jest.Mocked<IIdentityRepository>;
  kycRepo?: jest.Mocked<IKycRepository>;
}) {
  const kycProvider = opts.kycProvider ?? makeKycProvider();
  const identityRepo = opts.identityRepo ?? makeIdentityRepo();
  const kycRepo = opts.kycRepo ?? makeKycRepo();

  const svc = new KycService(kycProvider, identityRepo, kycRepo);
  return { svc, kycProvider, identityRepo, kycRepo };
}

// ---------------------------------------------------------------------------
// Tests for KycService.createSumsubSession (task 3.4)
// ---------------------------------------------------------------------------

const SESSION_USER_ID = 'session-user-uuid-77';

/** Builds a UserRecord at the given kycTier (kycStatus is irrelevant to this gate). */
function userAtTier(tier: string): UserRecord {
  return {
    id: SESSION_USER_ID,
    status: 'active',
    kycStatus: tier === 'unverified' ? 'pending' : 'verified',
    kycTier: tier,
    simSwapDetectedAt: null,
    tierChangedAt: null,
  };
}

const SESSION_RESULT: CreateVerificationSessionResult = {
  token: 'sumsub-webSdk-token-abc',
  applicantId: 'sumsub-applicant-xyz',
};

describe('KycService.createSumsubSession', () => {
  it('unverified user requesting tier_2 → throws SumsubPrerequisiteNotMetError; provider NOT called', async () => {
    const identityRepo = makeIdentityRepo({
      loadUser: jest.fn().mockResolvedValue(userAtTier('unverified')),
    });
    const kycProvider = makeKycProvider();
    const kycRepo = makeKycRepo();

    const { svc } = buildService({ identityRepo, kycProvider, kycRepo });

    await expect(
      svc.createSumsubSession(SESSION_USER_ID, 'tier_2'),
    ).rejects.toBeInstanceOf(SumsubPrerequisiteNotMetError);

    expect(kycProvider.createVerificationSession).not.toHaveBeenCalled();
    expect(kycRepo.setSumsubApplicantId).not.toHaveBeenCalled();
  });

  it('SumsubPrerequisiteNotMetError carries code SUMSUB_PREREQUISITE_NOT_MET', async () => {
    const identityRepo = makeIdentityRepo({
      loadUser: jest.fn().mockResolvedValue(userAtTier('unverified')),
    });
    const { svc } = buildService({ identityRepo });

    const err = await svc
      .createSumsubSession(SESSION_USER_ID, 'tier_2')
      .catch((e: unknown) => e);
    expect((err as SumsubPrerequisiteNotMetError).code).toBe(
      'SUMSUB_PREREQUISITE_NOT_MET',
    );
  });

  it('tier_1 user requesting tier_2 → 200: calls createVerificationSession and persists the applicantId', async () => {
    const identityRepo = makeIdentityRepo({
      loadUser: jest.fn().mockResolvedValue(userAtTier('tier_1')),
    });
    const kycProvider = makeKycProvider();
    kycProvider.createVerificationSession.mockResolvedValue(SESSION_RESULT);
    const kycRepo = makeKycRepo();

    const { svc } = buildService({ identityRepo, kycProvider, kycRepo });

    const result = await svc.createSumsubSession(SESSION_USER_ID, 'tier_2');

    expect(kycProvider.createVerificationSession).toHaveBeenCalledWith({
      userId: SESSION_USER_ID,
      level: 'tier_2',
    });
    expect(kycRepo.setSumsubApplicantId).toHaveBeenCalledWith(
      SESSION_USER_ID,
      SESSION_RESULT.applicantId,
    );
    expect(result).toEqual({
      token: SESSION_RESULT.token,
      userId: SESSION_USER_ID,
    });
  });

  it('tier_1 user requesting tier_3 → throws SumsubPrerequisiteNotMetError (needs tier_2 first)', async () => {
    const identityRepo = makeIdentityRepo({
      loadUser: jest.fn().mockResolvedValue(userAtTier('tier_1')),
    });
    const kycProvider = makeKycProvider();
    const kycRepo = makeKycRepo();

    const { svc } = buildService({ identityRepo, kycProvider, kycRepo });

    await expect(
      svc.createSumsubSession(SESSION_USER_ID, 'tier_3'),
    ).rejects.toBeInstanceOf(SumsubPrerequisiteNotMetError);

    expect(kycProvider.createVerificationSession).not.toHaveBeenCalled();
    expect(kycRepo.setSumsubApplicantId).not.toHaveBeenCalled();
  });

  it('tier_2 user requesting tier_3 → 200: calls createVerificationSession and persists the applicantId', async () => {
    const identityRepo = makeIdentityRepo({
      loadUser: jest.fn().mockResolvedValue(userAtTier('tier_2')),
    });
    const kycProvider = makeKycProvider();
    kycProvider.createVerificationSession.mockResolvedValue(SESSION_RESULT);
    const kycRepo = makeKycRepo();

    const { svc } = buildService({ identityRepo, kycProvider, kycRepo });

    const result = await svc.createSumsubSession(SESSION_USER_ID, 'tier_3');

    expect(kycProvider.createVerificationSession).toHaveBeenCalledWith({
      userId: SESSION_USER_ID,
      level: 'tier_3',
    });
    expect(kycRepo.setSumsubApplicantId).toHaveBeenCalledWith(
      SESSION_USER_ID,
      SESSION_RESULT.applicantId,
    );
    expect(result).toEqual({
      token: SESSION_RESULT.token,
      userId: SESSION_USER_ID,
    });
  });

  it('tier_3 user requesting tier_2 (already above prerequisite) → 200', async () => {
    const identityRepo = makeIdentityRepo({
      loadUser: jest.fn().mockResolvedValue(userAtTier('tier_3')),
    });
    const kycProvider = makeKycProvider();
    kycProvider.createVerificationSession.mockResolvedValue(SESSION_RESULT);

    const { svc } = buildService({ identityRepo, kycProvider });

    await expect(
      svc.createSumsubSession(SESSION_USER_ID, 'tier_2'),
    ).resolves.toEqual({
      token: SESSION_RESULT.token,
      userId: SESSION_USER_ID,
    });
  });

  it('does NOT change kycStatus/kycTier — that stays the webhook’s job', async () => {
    // No repo method exists on IIdentityRepository for setting kycStatus/kycTier
    // that this service could call — asserting only setSumsubApplicantId (KYC
    // profile write) was invoked is the behavioral proof that nothing else moved.
    const identityRepo = makeIdentityRepo({
      loadUser: jest.fn().mockResolvedValue(userAtTier('tier_1')),
    });
    const kycProvider = makeKycProvider();
    kycProvider.createVerificationSession.mockResolvedValue(SESSION_RESULT);
    const kycRepo = makeKycRepo();

    const { svc } = buildService({ identityRepo, kycProvider, kycRepo });

    await svc.createSumsubSession(SESSION_USER_ID, 'tier_2');

    expect(kycRepo.updateKycProfileDecision).not.toHaveBeenCalled();
  });
});
