/**
 * Unit tests for KycService.completeVerification (K2).
 *
 * TDD: tests were written RED first, then implementation made them GREEN.
 *
 * Mocked: KYC_PROVIDER, PinService.hashPin, IKycRepository,
 *         IIdentityRepository.findActiveChannelIdentity + loadContact.
 * No Nest TestingModule — KycService is constructed directly.
 */

import type { IKycProvider, KycVerifyResult } from './ports/kyc-provider.port';
import type { IIdentityRepository } from './ports/identity.repository.port';
import type { IKycRepository } from './ports/kyc.repository.port';
import type { PinService } from '../../../core/auth/pin.service';
import { ContactNotFoundError, KycRejectedError } from '../domain/kyc-errors';
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
  pin: '1234',
};

/** Creates a mock IKycProvider. */
function makeKycProvider(result: KycVerifyResult): jest.Mocked<IKycProvider> {
  return { verify: jest.fn().mockResolvedValue(result) };
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
});
