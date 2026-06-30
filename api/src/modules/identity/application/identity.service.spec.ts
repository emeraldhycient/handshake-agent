import type {
  ChannelIdentityRecord,
  ContactRecord,
  IIdentityRepository,
  UserRecord,
} from './ports/identity.repository.port';
import { IdentityService } from './identity.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseCI = (
  overrides: Partial<ChannelIdentityRecord> = {},
): ChannelIdentityRecord => ({
  id: 'ci-id-1',
  channel: 'whatsapp',
  channelAddress: '+2348000000001',
  contactId: null,
  userId: null,
  simSwapDetectedAt: null,
  ...overrides,
});

const baseUser = (overrides: Partial<UserRecord> = {}): UserRecord => ({
  id: 'user-id-1',
  status: 'active',
  kycStatus: 'verified',
  kycTier: 'tier_1',
  simSwapDetectedAt: null,
  ...overrides,
});

const baseContact = (
  overrides: Partial<ContactRecord> = {},
): ContactRecord => ({
  id: 'contact-id-1',
  primaryChannel: 'whatsapp',
  primaryAddress: '+2348000000001',
  status: 'active',
  linkedUserId: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Helper: build a mock repo
// ---------------------------------------------------------------------------

function makeRepo(
  overrides: Partial<IIdentityRepository> = {},
): IIdentityRepository {
  return {
    findActiveChannelIdentity: jest.fn().mockResolvedValue(null),
    findWhatsAppAddressByUserId: jest.fn().mockResolvedValue(null),
    loadUser: jest.fn().mockResolvedValue(null),
    loadContact: jest.fn().mockResolvedValue(null),
    // findKycProfile: not used by IdentityService.resolveByChannel; stub returns null.
    findKycProfile: jest.fn().mockResolvedValue(null),
    // findOriginatorIdentity: not used by IdentityService.resolveByChannel; stub returns null.
    findOriginatorIdentity: jest.fn().mockResolvedValue(null),
    createContactWithChannelIdentity: jest.fn().mockResolvedValue({
      contact: baseContact(),
      channelIdentity: baseCI({ contactId: 'contact-id-1' }),
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IdentityService.resolveByChannel', () => {
  const INPUT = {
    channel: 'whatsapp' as const,
    channelAddress: '+2348000000001',
    normalizedPhone: '+2348000000001',
  };

  it('linked CI → returns {kind:"user"} with the user; requiresReverification false when both clean', async () => {
    const user = baseUser();
    const repo = makeRepo({
      findActiveChannelIdentity: jest
        .fn()
        .mockResolvedValue(baseCI({ userId: 'user-id-1' })),
      loadUser: jest.fn().mockResolvedValue(user),
    });
    const svc = new IdentityService(repo);

    const result = await svc.resolveByChannel(INPUT);

    expect(result.kind).toBe('user');
    if (result.kind === 'user') {
      expect(result.user).toBe(user);
      expect(result.requiresReverification).toBe(false);
    }
  });

  it('linked CI → requiresReverification true when user.simSwapDetectedAt is set', async () => {
    const user = baseUser({ simSwapDetectedAt: new Date() });
    const repo = makeRepo({
      findActiveChannelIdentity: jest
        .fn()
        .mockResolvedValue(baseCI({ userId: 'user-id-1' })),
      loadUser: jest.fn().mockResolvedValue(user),
    });
    const svc = new IdentityService(repo);

    const result = await svc.resolveByChannel(INPUT);

    expect(result.kind).toBe('user');
    if (result.kind === 'user') {
      expect(result.requiresReverification).toBe(true);
    }
  });

  it('CI.simSwapDetectedAt set (user clean) → requiresReverification true', async () => {
    const user = baseUser({ simSwapDetectedAt: null });
    const repo = makeRepo({
      findActiveChannelIdentity: jest
        .fn()
        .mockResolvedValue(
          baseCI({ userId: 'user-id-1', simSwapDetectedAt: new Date() }),
        ),
      loadUser: jest.fn().mockResolvedValue(user),
    });
    const svc = new IdentityService(repo);

    const result = await svc.resolveByChannel(INPUT);

    expect(result.kind).toBe('user');
    if (result.kind === 'user') {
      expect(result.requiresReverification).toBe(true);
    }
  });

  it('unlinked CI (contactId set, no userId) → returns {kind:"contact"}', async () => {
    const contact = baseContact();
    const repo = makeRepo({
      findActiveChannelIdentity: jest
        .fn()
        .mockResolvedValue(baseCI({ contactId: 'contact-id-1' })),
      loadContact: jest.fn().mockResolvedValue(contact),
    });
    const svc = new IdentityService(repo);

    const result = await svc.resolveByChannel(INPUT);

    expect(result.kind).toBe('contact');
    if (result.kind === 'contact') {
      expect(result.contact).toBe(contact);
    }
  });

  it('no CI → calls createContactWithChannelIdentity and returns {kind:"contact"}', async () => {
    const contact = baseContact();
    const createFn = jest.fn().mockResolvedValue({
      contact,
      channelIdentity: baseCI({ contactId: 'contact-id-1' }),
    });
    const repo = makeRepo({
      findActiveChannelIdentity: jest.fn().mockResolvedValue(null),
      createContactWithChannelIdentity: createFn,
    });
    const svc = new IdentityService(repo);

    const result = await svc.resolveByChannel(INPUT);

    expect(createFn).toHaveBeenCalledWith({
      channel: 'whatsapp',
      channelAddress: '+2348000000001',
      normalizedPhone: '+2348000000001',
    });
    expect(result.kind).toBe('contact');
    if (result.kind === 'contact') {
      expect(result.contact).toBe(contact);
    }
  });

  // ── Dangling-FK defensive branches ────────────────────────────────────────

  it('CI with userId set but loadUser → null (dangling user FK) → creates new contact and returns {kind:"contact"}', async () => {
    // Simulates data inconsistency: ChannelIdentity.userId points to a deleted
    // User row. The service must NOT throw — it must fall back to contact
    // creation so the caller is not gated behind a corrupt FK.
    const newContact = baseContact({ id: 'contact-id-new' });
    const createFn = jest.fn().mockResolvedValue({
      contact: newContact,
      channelIdentity: baseCI({ contactId: 'contact-id-new' }),
    });
    const repo = makeRepo({
      findActiveChannelIdentity: jest
        .fn()
        .mockResolvedValue(baseCI({ userId: 'user-id-missing' })),
      loadUser: jest.fn().mockResolvedValue(null), // dangling FK
      createContactWithChannelIdentity: createFn,
    });
    const svc = new IdentityService(repo);

    const result = await svc.resolveByChannel(INPUT);

    expect(createFn).toHaveBeenCalledWith({
      channel: 'whatsapp',
      channelAddress: '+2348000000001',
      normalizedPhone: '+2348000000001',
    });
    expect(result.kind).toBe('contact');
    if (result.kind === 'contact') {
      expect(result.contact).toBe(newContact);
    }
  });

  it('CI with contactId set but loadContact → null (dangling contact FK) → creates new contact and returns {kind:"contact"}', async () => {
    // Simulates data inconsistency: ChannelIdentity.contactId points to a
    // deleted Contact row. Same safe-fallback path as the user FK case above.
    const newContact = baseContact({ id: 'contact-id-new' });
    const createFn = jest.fn().mockResolvedValue({
      contact: newContact,
      channelIdentity: baseCI({ contactId: 'contact-id-new' }),
    });
    const repo = makeRepo({
      findActiveChannelIdentity: jest
        .fn()
        .mockResolvedValue(baseCI({ contactId: 'contact-id-missing' })),
      loadContact: jest.fn().mockResolvedValue(null), // dangling FK
      createContactWithChannelIdentity: createFn,
    });
    const svc = new IdentityService(repo);

    const result = await svc.resolveByChannel(INPUT);

    expect(createFn).toHaveBeenCalledWith({
      channel: 'whatsapp',
      channelAddress: '+2348000000001',
      normalizedPhone: '+2348000000001',
    });
    expect(result.kind).toBe('contact');
    if (result.kind === 'contact') {
      expect(result.contact).toBe(newContact);
    }
  });
});
