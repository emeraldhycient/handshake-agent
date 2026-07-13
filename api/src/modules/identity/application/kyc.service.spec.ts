/**
 * Unit tests for KycService.completeVerification (K2).
 *
 * TDD: tests were written RED first, then implementation made them GREEN.
 *
 * Mocked: KYC_PROVIDER, PinService.hashPin, IKycRepository,
 *         IIdentityRepository.findActiveChannelIdentity + loadContact.
 * No Nest TestingModule — KycService is constructed directly.
 */

import type {
  CreateVerificationSessionResult,
  IKycProvider,
  KycVerifyResult,
} from './ports/kyc-provider.port';
import type {
  IIdentityRepository,
  UserRecord,
} from './ports/identity.repository.port';
import type { IKycRepository } from './ports/kyc.repository.port';
import type { PinService } from '../../../core/auth/pin.service';
import {
  ContactNotFoundError,
  KycRejectedError,
  SumsubPrerequisiteNotMetError,
} from '../domain/kyc-errors';
import { KycService } from './kyc.service';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const CHANNEL_ADDRESS = '+2348099990001';
const CI_ID = 'ci-uuid-1';
const CONTACT_ID = 'contact-uuid-1';
const USER_ID = 'user-uuid-1';
const PIN_HASH = 'aabbcc:ddeeff11223344';

const VALID_INPUT = {
  channelAddress: CHANNEL_ADDRESS,
  nin: '12345678901',
  bvn: undefined,
  firstName: 'Amaka',
  lastName: 'Okafor',
  dateOfBirth: '1992-07-14',
  pin: '1357',
};

/** Creates a mock IKycProvider. */
function makeKycProvider(result: KycVerifyResult): jest.Mocked<IKycProvider> {
  return {
    verify: jest.fn().mockResolvedValue(result),
    // Not exercised by KycService.completeVerification (legacy sync path) —
    // stubbed only to satisfy the IKycProvider shape (task 3.3).
    createVerificationSession: jest.fn(),
  };
}

/** Creates a stub PinService with only hashPin mocked. */
function makePinService(hash: string = PIN_HASH): jest.Mocked<PinService> {
  return {
    hashPin: jest.fn().mockResolvedValue(hash),
    // PinService.verifyPin and setPin are not called by KycService
    verifyPin: jest.fn(),
    setPin: jest.fn(),
  } as unknown as jest.Mocked<PinService>;
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
    completeVerificationAtomic: jest
      .fn()
      .mockResolvedValue({ userId: USER_ID }),
    completeVerificationForUserAtomic: jest
      .fn()
      .mockResolvedValue({ userId: USER_ID }),
    updateKycProfileDecision: jest.fn().mockResolvedValue(undefined),
    markKycNeedsInfo: jest.fn().mockResolvedValue(undefined),
    setSumsubApplicantId: jest.fn().mockResolvedValue(undefined),
  };
}

/** Builds a KycService with default mocks (approved provider). */
function buildService(opts: {
  kycProvider?: jest.Mocked<IKycProvider>;
  pinService?: jest.Mocked<PinService>;
  identityRepo?: jest.Mocked<IIdentityRepository>;
  kycRepo?: jest.Mocked<IKycRepository>;
}) {
  const kycProvider =
    opts.kycProvider ??
    makeKycProvider({ approved: true, tier: 'tier_1', reference: 'ref-1' });
  const pinService = opts.pinService ?? makePinService();
  const identityRepo = opts.identityRepo ?? makeIdentityRepo();
  const kycRepo = opts.kycRepo ?? makeKycRepo();

  const svc = new KycService(kycProvider, pinService, identityRepo, kycRepo);
  return { svc, kycProvider, pinService, identityRepo, kycRepo };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KycService.completeVerification', () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it('approved provider → calls completeVerificationAtomic with the hashed PIN and returns userId', async () => {
    const { svc, pinService, identityRepo, kycProvider, kycRepo } =
      buildService({});

    const result = await svc.completeVerification(VALID_INPUT);

    // Provider was called with the identity fields
    expect(kycProvider.verify).toHaveBeenCalledWith({
      nin: VALID_INPUT.nin,
      bvn: VALID_INPUT.bvn,
      firstName: VALID_INPUT.firstName,
      lastName: VALID_INPUT.lastName,
      dateOfBirth: VALID_INPUT.dateOfBirth,
    });

    // Identity repo resolved the contact
    expect(identityRepo.findActiveChannelIdentity).toHaveBeenCalledWith(
      expect.any(String),
      CHANNEL_ADDRESS,
    );

    // hashPin was called with the raw PIN (never stored plaintext)
    expect(pinService.hashPin).toHaveBeenCalledWith(VALID_INPUT.pin);

    // Atomic repo was called with the hashed PIN + correct fields
    expect(kycRepo.completeVerificationAtomic).toHaveBeenCalledWith(
      expect.objectContaining<{
        channelIdentityId: string;
        contactId: string;
        nin: string | undefined;
        bvn: string | undefined;
        firstName: string;
        lastName: string;
        dateOfBirth: string | undefined;
        pinHash: string;
        now: Date;
      }>({
        channelIdentityId: CI_ID,
        contactId: CONTACT_ID,
        nin: VALID_INPUT.nin,
        bvn: VALID_INPUT.bvn,
        firstName: VALID_INPUT.firstName,
        lastName: VALID_INPUT.lastName,
        dateOfBirth: VALID_INPUT.dateOfBirth,
        pinHash: PIN_HASH,
        now: expect.any(Date) as Date,
      }),
    );

    // Returns the userId from the atomic operation
    expect(result).toEqual({ userId: USER_ID });
  });

  // ── Provider rejected ─────────────────────────────────────────────────────

  it('provider rejects → throws KycRejectedError and atomic repo is NOT called', async () => {
    const rejectedProvider = makeKycProvider({
      approved: false,
      tier: 'unverified',
      reference: 'ref-rejected',
      reason: 'NIN mismatch',
    });

    const { svc, kycRepo } = buildService({ kycProvider: rejectedProvider });

    await expect(svc.completeVerification(VALID_INPUT)).rejects.toBeInstanceOf(
      KycRejectedError,
    );

    // Must NOT persist anything on rejection
    expect(kycRepo.completeVerificationAtomic).not.toHaveBeenCalled();
  });

  it('KycRejectedError carries the rejection reason from the provider', async () => {
    const rejectedProvider = makeKycProvider({
      approved: false,
      tier: 'unverified',
      reference: 'ref-x',
      reason: 'BVN liveness failed',
    });

    const { svc } = buildService({ kycProvider: rejectedProvider });

    const err = await svc
      .completeVerification(VALID_INPUT)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KycRejectedError);
    expect((err as KycRejectedError).reason).toBe('BVN liveness failed');
    expect((err as KycRejectedError).code).toBe('KYC_REJECTED');
  });

  // ── Contact not found ─────────────────────────────────────────────────────

  it('unknown channelAddress → throws ContactNotFoundError', async () => {
    const identityRepo = makeIdentityRepo({
      findActiveChannelIdentity: jest.fn().mockResolvedValue(null),
    });

    const { svc } = buildService({ identityRepo });

    await expect(svc.completeVerification(VALID_INPUT)).rejects.toBeInstanceOf(
      ContactNotFoundError,
    );
  });

  it('ContactNotFoundError has code CONTACT_NOT_FOUND', async () => {
    const identityRepo = makeIdentityRepo({
      findActiveChannelIdentity: jest.fn().mockResolvedValue(null),
    });

    const { svc } = buildService({ identityRepo });

    const err = await svc
      .completeVerification(VALID_INPUT)
      .catch((e: unknown) => e);
    expect((err as ContactNotFoundError).code).toBe('CONTACT_NOT_FOUND');
  });

  // ── CI found but no contactId (CI points to nothing) → ContactNotFoundError ──

  it('CI found but contactId is null → throws ContactNotFoundError (no unlinked contact to upgrade)', async () => {
    const identityRepo = makeIdentityRepo({
      findActiveChannelIdentity: jest.fn().mockResolvedValue({
        id: CI_ID,
        channel: 'whatsapp',
        channelAddress: CHANNEL_ADDRESS,
        contactId: null,
        userId: null,
        simSwapDetectedAt: null,
      }),
    });

    const { svc } = buildService({ identityRepo });

    await expect(svc.completeVerification(VALID_INPUT)).rejects.toBeInstanceOf(
      ContactNotFoundError,
    );
  });

  // ── Already-verified Contact (Contact already has a linkedUserId) ──────────

  it('Contact already linked to a verified user → idempotent return of existing userId (no re-verification)', async () => {
    const EXISTING_USER_ID = 'existing-user-uuid-99';
    const identityRepo = makeIdentityRepo({
      findActiveChannelIdentity: jest.fn().mockResolvedValue({
        id: CI_ID,
        channel: 'whatsapp',
        channelAddress: CHANNEL_ADDRESS,
        contactId: CONTACT_ID,
        userId: EXISTING_USER_ID, // CI is already linked to a User
        simSwapDetectedAt: null,
      }),
    });

    const { svc, kycRepo } = buildService({ identityRepo });

    const result = await svc.completeVerification(VALID_INPUT);

    // Idempotent: returns the existing userId
    expect(result).toEqual({ userId: EXISTING_USER_ID });

    // No new User or KycProfile created
    expect(kycRepo.completeVerificationAtomic).not.toHaveBeenCalled();
  });

  // ── Raw PIN is never persisted — only the hash ────────────────────────────

  it('completeVerificationAtomic is never called with the raw PIN — only the hash', async () => {
    const { svc, kycRepo } = buildService({});

    await svc.completeVerification(VALID_INPUT);

    const mockCalls = (
      kycRepo.completeVerificationAtomic as jest.MockedFunction<
        IKycRepository['completeVerificationAtomic']
      >
    ).mock.calls;
    const call = mockCalls[0][0];

    // The atomic input must NOT contain a 'pin' key (raw PIN is never a field)
    expect(Object.keys(call)).not.toContain('pin');
    // The hashed form must be present under 'pinHash'
    expect(call.pinHash).toBe(PIN_HASH);
  });

  // ── Granted tier is threaded through, not hardcoded (Task 1.1) ───────────

  it('provider approves at tier_2 → completeVerificationAtomic is called with tier: tier_2', async () => {
    const tier2Provider = makeKycProvider({
      approved: true,
      tier: 'tier_2',
      reference: 'ref-tier2',
    });

    const { svc, kycRepo } = buildService({ kycProvider: tier2Provider });

    await svc.completeVerification(VALID_INPUT);

    expect(kycRepo.completeVerificationAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'tier_2' }),
    );
  });

  it('provider approves at tier_1 (mock default) → completeVerificationAtomic is still called with tier: tier_1 (behavior preservation)', async () => {
    const tier1Provider = makeKycProvider({
      approved: true,
      tier: 'tier_1',
      reference: 'ref-tier1',
    });

    const { svc, kycRepo } = buildService({ kycProvider: tier1Provider });

    await svc.completeVerification(VALID_INPUT);

    expect(kycRepo.completeVerificationAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'tier_1' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests for KycService.completeVerificationForUser (web-native user path)
// ---------------------------------------------------------------------------

const WEB_USER_ID = 'web-user-uuid-42';

const VALID_WEB_INPUT = {
  userId: WEB_USER_ID,
  nin: '11223344556',
  bvn: undefined,
  firstName: 'Chidi',
  lastName: 'Okeke',
  dateOfBirth: '1992-07-14',
  pin: '5681',
};

/** Unverified user record (kycStatus != 'verified') returned by loadUser. */
const UNVERIFIED_USER: UserRecord = {
  id: WEB_USER_ID,
  status: 'pending',
  kycStatus: 'pending',
  kycTier: 'unverified',
  simSwapDetectedAt: null,
  tierChangedAt: null,
};

/** Already-verified user record returned by loadUser. */
const VERIFIED_USER: UserRecord = {
  id: WEB_USER_ID,
  status: 'active',
  kycStatus: 'verified',
  kycTier: 'tier_1',
  simSwapDetectedAt: null,
  tierChangedAt: null,
};

describe('KycService.completeVerificationForUser', () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it('approved provider + unverified user → calls completeVerificationForUserAtomic with hashed PIN; returns userId', async () => {
    const identityRepo = makeIdentityRepo({
      loadUser: jest.fn().mockResolvedValue(UNVERIFIED_USER),
    });
    const kycRepo = makeKycRepo();
    const pinService = makePinService();

    const { svc, kycProvider } = buildService({
      identityRepo,
      kycRepo,
      pinService,
    });

    const result = await svc.completeVerificationForUser(VALID_WEB_INPUT);

    // Provider called with identity fields
    expect(kycProvider.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        nin: VALID_WEB_INPUT.nin,
        firstName: VALID_WEB_INPUT.firstName,
        lastName: VALID_WEB_INPUT.lastName,
      }),
    );

    // hashPin was called with the raw PIN
    expect(pinService.hashPin).toHaveBeenCalledWith(VALID_WEB_INPUT.pin);

    // Atomic repo was called with hashed PIN and correct fields
    expect(kycRepo.completeVerificationForUserAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: WEB_USER_ID,
        nin: VALID_WEB_INPUT.nin,
        firstName: VALID_WEB_INPUT.firstName,
        lastName: VALID_WEB_INPUT.lastName,
        pinHash: PIN_HASH,
        now: expect.any(Date) as Date,
      }),
    );

    expect(result).toEqual({ userId: USER_ID });
  });

  // ── Raw PIN is never persisted — only the hash ────────────────────────────

  it('completeVerificationForUserAtomic is never called with the raw PIN — only the hash', async () => {
    const identityRepo = makeIdentityRepo({
      loadUser: jest.fn().mockResolvedValue(UNVERIFIED_USER),
    });
    const kycRepo = makeKycRepo();

    const { svc } = buildService({ identityRepo, kycRepo });

    await svc.completeVerificationForUser(VALID_WEB_INPUT);

    const mockCalls = (
      kycRepo.completeVerificationForUserAtomic as jest.MockedFunction<
        IKycRepository['completeVerificationForUserAtomic']
      >
    ).mock.calls;
    const call = mockCalls[0][0];

    // The atomic input must NOT contain a 'pin' key
    expect(Object.keys(call)).not.toContain('pin');
    // The hashed form must be present under 'pinHash'
    expect(call.pinHash).toBe(PIN_HASH);
  });

  // ── Idempotent when already verified ─────────────────────────────────────

  it('user already verified → returns userId immediately without calling provider or atomic repo', async () => {
    const identityRepo = makeIdentityRepo({
      loadUser: jest.fn().mockResolvedValue(VERIFIED_USER),
    });
    const kycProvider = makeKycProvider({
      approved: true,
      tier: 'tier_1',
      reference: 'ref-1',
    });
    const kycRepo = makeKycRepo();

    const { svc } = buildService({ identityRepo, kycProvider, kycRepo });

    const result = await svc.completeVerificationForUser(VALID_WEB_INPUT);

    // Returns the userId from the loaded user
    expect(result).toEqual({ userId: WEB_USER_ID });

    // Provider must NOT have been called
    expect(kycProvider.verify).not.toHaveBeenCalled();

    // Atomic repo must NOT have been called
    expect(kycRepo.completeVerificationForUserAtomic).not.toHaveBeenCalled();
  });

  // ── KycRejectedError ──────────────────────────────────────────────────────

  it('provider rejected → throws KycRejectedError; atomic repo NOT called', async () => {
    const identityRepo = makeIdentityRepo({
      loadUser: jest.fn().mockResolvedValue(UNVERIFIED_USER),
    });
    const rejectedProvider = makeKycProvider({
      approved: false,
      tier: 'unverified',
      reference: 'ref-rejected',
      reason: 'NIN mismatch',
    });
    const kycRepo = makeKycRepo();

    const { svc } = buildService({
      identityRepo,
      kycProvider: rejectedProvider,
      kycRepo,
    });

    await expect(
      svc.completeVerificationForUser(VALID_WEB_INPUT),
    ).rejects.toBeInstanceOf(KycRejectedError);

    expect(kycRepo.completeVerificationForUserAtomic).not.toHaveBeenCalled();
  });

  it('KycRejectedError carries the rejection reason from the provider', async () => {
    const identityRepo = makeIdentityRepo({
      loadUser: jest.fn().mockResolvedValue(UNVERIFIED_USER),
    });
    const rejectedProvider = makeKycProvider({
      approved: false,
      tier: 'unverified',
      reference: 'ref-x',
      reason: 'BVN liveness failed',
    });

    const { svc } = buildService({
      identityRepo,
      kycProvider: rejectedProvider,
    });

    const err = await svc
      .completeVerificationForUser(VALID_WEB_INPUT)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KycRejectedError);
    expect((err as KycRejectedError).reason).toBe('BVN liveness failed');
    expect((err as KycRejectedError).code).toBe('KYC_REJECTED');
  });

  // ── Granted tier is threaded through, not hardcoded (Task 1.1) ───────────

  it('provider approves at tier_2 → completeVerificationForUserAtomic is called with tier: tier_2', async () => {
    const identityRepo = makeIdentityRepo({
      loadUser: jest.fn().mockResolvedValue(UNVERIFIED_USER),
    });
    const tier2Provider = makeKycProvider({
      approved: true,
      tier: 'tier_2',
      reference: 'ref-tier2',
    });
    const kycRepo = makeKycRepo();

    const { svc } = buildService({
      identityRepo,
      kycProvider: tier2Provider,
      kycRepo,
    });

    await svc.completeVerificationForUser(VALID_WEB_INPUT);

    expect(kycRepo.completeVerificationForUserAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'tier_2' }),
    );
  });

  it('provider approves at tier_1 (mock default) → completeVerificationForUserAtomic is still called with tier: tier_1 (behavior preservation)', async () => {
    const identityRepo = makeIdentityRepo({
      loadUser: jest.fn().mockResolvedValue(UNVERIFIED_USER),
    });
    const tier1Provider = makeKycProvider({
      approved: true,
      tier: 'tier_1',
      reference: 'ref-tier1',
    });
    const kycRepo = makeKycRepo();

    const { svc } = buildService({
      identityRepo,
      kycProvider: tier1Provider,
      kycRepo,
    });

    await svc.completeVerificationForUser(VALID_WEB_INPUT);

    expect(kycRepo.completeVerificationForUserAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'tier_1' }),
    );
  });
});

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
    const kycProvider = makeKycProvider({
      approved: true,
      tier: 'tier_1',
      reference: 'unused',
    });
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
    const kycProvider = makeKycProvider({
      approved: true,
      tier: 'tier_1',
      reference: 'unused',
    });
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
    const kycProvider = makeKycProvider({
      approved: true,
      tier: 'tier_1',
      reference: 'unused',
    });
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
    const kycProvider = makeKycProvider({
      approved: true,
      tier: 'tier_2',
      reference: 'unused',
    });
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
    const kycProvider = makeKycProvider({
      approved: true,
      tier: 'tier_3',
      reference: 'unused',
    });
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
    const kycProvider = makeKycProvider({
      approved: true,
      tier: 'tier_1',
      reference: 'unused',
    });
    kycProvider.createVerificationSession.mockResolvedValue(SESSION_RESULT);
    const kycRepo = makeKycRepo();

    const { svc } = buildService({ identityRepo, kycProvider, kycRepo });

    await svc.createSumsubSession(SESSION_USER_ID, 'tier_2');

    expect(kycRepo.updateKycProfileDecision).not.toHaveBeenCalled();
    expect(kycRepo.completeVerificationAtomic).not.toHaveBeenCalled();
    expect(kycRepo.completeVerificationForUserAtomic).not.toHaveBeenCalled();
  });
});
