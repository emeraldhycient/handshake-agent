import { AdminNotFoundError } from '../domain/admin-errors';
import { AdminEndUserService } from './admin-end-user.service';
import type {
  AuditService,
  RecordAuditInput,
} from '../../../core/audit/application/audit.service';
import type {
  AdminUserListResult,
  DeviceRecord,
  IIdentityRepository,
  UserAdminDetailRecord,
} from '../../identity/application/ports/identity.repository.port';
import type { IPinRepository } from '../../../core/auth/ports/pin.repository.port';
import type {
  ILedgerRepository,
  LedgerEntryRecord,
} from '../../transactions/application/ports/ledger.repository.port';
import type {
  ITransactionReadRepository,
  TransactionListRecord,
} from '../../transactions/application/ports/transaction-read.repository.port';
import type {
  IWalletRepository,
  WalletRecord,
} from '../../wallets/application/ports/wallet.repository.port';
import type { WalletBalanceService } from '../../wallets/application/wallet-balance.service';
import type { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import type { BeneficiaryRecord } from '../../beneficiaries/application/ports/beneficiary.repository.port';

const NOW = new Date('2026-06-30T12:00:00.000Z');
const USER_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_ID = '99999999-9999-9999-9999-999999999999';

// ── Builders ───────────────────────────────────────────────────────────────

function makeDetail(
  over?: Partial<UserAdminDetailRecord>,
): UserAdminDetailRecord {
  return {
    id: USER_ID,
    email: 'user@example.com',
    status: 'active',
    kycStatus: 'verified',
    kycTier: 'tier_2',
    simSwapDetectedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    pinnedDeviceId: 'device-pinned',
    kyc: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: new Date('1990-12-10T00:00:00.000Z'),
      nin: '12345678901',
      bvn: '22345678901',
      idDocumentType: 'passport',
      livenessCheckResult: 'pass',
      status: 'verified',
      tier: 'tier_2',
      rejectionReason: null,
    },
    devices: [
      {
        id: 'device-pinned',
        trustState: 'bound',
        lastUsedAt: new Date('2026-06-29T00:00:00.000Z'),
        boundAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        id: 'device-other',
        trustState: 'revoked',
        lastUsedAt: null,
        boundAt: null,
      },
    ],
    ...over,
  };
}

function makeWallet(over?: Partial<WalletRecord>): WalletRecord {
  return {
    id: 'wallet-tron',
    userId: USER_ID,
    network: 'TRON',
    address: 'TXyz...',
    providerReference: 'br-child-1',
    status: 'active',
    ...over,
  };
}

function makeLedgerEntry(over?: Partial<LedgerEntryRecord>): LedgerEntryRecord {
  return {
    id: 'ledger-1',
    transactionId: 'txn-1',
    accountType: 'user_wallet',
    accountId: 'wallet-tron',
    currency: 'USDT',
    amount: '10.00',
    direction: 'credit',
    balanceAfter: '10.00',
    postedAt: new Date('2026-06-28T00:00:00.000Z'),
    ...over,
  };
}

function makeTxn(over?: Partial<TransactionListRecord>): TransactionListRecord {
  return {
    id: 'txn-1',
    type: 'buy',
    status: 'completed',
    createdAt: new Date('2026-06-28T00:00:00.000Z'),
    ...over,
  };
}

function makeBeneficiary(over?: Partial<BeneficiaryRecord>): BeneficiaryRecord {
  return {
    id: 'ben-1',
    userId: USER_ID,
    type: 'bank_account',
    label: 'My GTB',
    accountNumber: '0123456789',
    accountHolderName: 'Ada Lovelace',
    bankCode: '058',
    cryptoAddress: null,
    cryptoAsset: null,
    cryptoNetwork: null,
    verificationStatus: 'verified',
    firstUseLockedUntil: null,
    verifiedAt: NOW,
    isDefault: true,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...over,
  };
}

// ── Mock factory ─────────────────────────────────────────────────────────────

interface Mocks {
  identity: jest.Mocked<IIdentityRepository>;
  walletBalance: jest.Mocked<Pick<WalletBalanceService, 'getBalances'>>;
  walletRepo: jest.Mocked<Pick<IWalletRepository, 'findByUser'>>;
  ledger: jest.Mocked<Pick<ILedgerRepository, 'listLedgerEntries'>>;
  txnRead: jest.Mocked<ITransactionReadRepository>;
  beneficiaries: jest.Mocked<Pick<BeneficiaryService, 'listForUser'>>;
  pin: jest.Mocked<IPinRepository>;
  audit: jest.Mocked<Pick<AuditService, 'record'>>;
  auditCalls: RecordAuditInput[];
}

function makeMocks(): { service: AdminEndUserService; m: Mocks } {
  const auditCalls: RecordAuditInput[] = [];

  const identity = {
    listUsers: jest.fn(),
    listUsersPendingKycReview: jest.fn(),
    loadUserWithKycAndDevices: jest.fn(),
    listDevicesForUser: jest.fn(),
    setUserStatus: jest.fn().mockResolvedValue(undefined),
    setKycTier: jest.fn().mockResolvedValue(undefined),
    setSimSwapDetectedAt: jest.fn().mockResolvedValue(undefined),
    revokeDevice: jest.fn().mockResolvedValue(undefined),
    unpinDevice: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<IIdentityRepository>;

  const walletBalance = {
    getBalances: jest.fn(),
  } as unknown as jest.Mocked<Pick<WalletBalanceService, 'getBalances'>>;

  const walletRepo = {
    findByUser: jest.fn(),
  } as unknown as jest.Mocked<Pick<IWalletRepository, 'findByUser'>>;

  const ledger = {
    listLedgerEntries: jest.fn(),
  } as unknown as jest.Mocked<Pick<ILedgerRepository, 'listLedgerEntries'>>;

  const txnRead = {
    listForUser: jest.fn(),
  } as unknown as jest.Mocked<ITransactionReadRepository>;

  const beneficiaries = {
    listForUser: jest.fn(),
  } as unknown as jest.Mocked<Pick<BeneficiaryService, 'listForUser'>>;

  const pin = {
    getPinState: jest.fn(),
    setPinHash: jest.fn(),
    recordFailure: jest.fn(),
    resetFailures: jest.fn(),
    clearPin: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<IPinRepository>;

  const audit = {
    record: jest.fn().mockImplementation((input: RecordAuditInput) => {
      auditCalls.push(input);
      return Promise.resolve();
    }),
  } as unknown as jest.Mocked<Pick<AuditService, 'record'>>;

  const service = new AdminEndUserService(
    identity,
    walletBalance as unknown as WalletBalanceService,
    walletRepo as unknown as IWalletRepository,
    ledger as unknown as ILedgerRepository,
    txnRead,
    beneficiaries as unknown as BeneficiaryService,
    pin,
    audit as unknown as AuditService,
  );

  return {
    service,
    m: {
      identity,
      walletBalance,
      walletRepo,
      ledger,
      txnRead,
      beneficiaries,
      pin,
      audit,
      auditCalls,
    },
  };
}

// ── list ─────────────────────────────────────────────────────────────────────

describe('AdminEndUserService.list', () => {
  it('maps records to list items (ISO dates, simSwapFlagged) and forwards cursor', async () => {
    const { service, m } = makeMocks();
    const result: AdminUserListResult = {
      items: [
        {
          id: USER_ID,
          email: 'user@example.com',
          status: 'active',
          kycStatus: 'verified',
          kycTier: 'tier_2',
          simSwapDetectedAt: new Date('2026-06-01T00:00:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      nextCursor: 'cursor-2',
    };
    m.identity.listUsers.mockResolvedValue(result);

    const out = await service.list({
      query: 'ada',
      status: 'active',
      kycTier: 'tier_2',
      cursor: 'cursor-1',
      limit: 25,
    });

    expect(m.identity.listUsers).toHaveBeenCalledWith(
      { query: 'ada', status: 'active', kycTier: 'tier_2' },
      { cursor: 'cursor-1', limit: 25 },
    );
    expect(out.nextCursor).toBe('cursor-2');
    expect(out.items).toEqual([
      {
        id: USER_ID,
        email: 'user@example.com',
        status: 'active',
        kycStatus: 'verified',
        kycTier: 'tier_2',
        simSwapFlagged: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('defaults the limit when not supplied and sets simSwapFlagged false when null', async () => {
    const { service, m } = makeMocks();
    m.identity.listUsers.mockResolvedValue({
      items: [
        {
          id: USER_ID,
          email: null,
          status: 'provisional',
          kycStatus: 'not_started',
          kycTier: 'unverified',
          simSwapDetectedAt: null,
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      ],
      nextCursor: null,
    });

    const out = await service.list({});

    const [, page] = m.identity.listUsers.mock.calls[0];
    expect(page.limit).toBeGreaterThan(0);
    expect(out.items[0].simSwapFlagged).toBe(false);
    expect(out.items[0].email).toBeNull();
    expect(out.nextCursor).toBeNull();
  });
});

// ── getDetail ──────────────────────────────────────────────────────────────

describe('AdminEndUserService.getDetail', () => {
  function primeDetailMocks(m: Mocks): void {
    m.identity.loadUserWithKycAndDevices.mockResolvedValue(makeDetail());
    m.walletBalance.getBalances.mockResolvedValue({
      fiatCurrency: 'NGN',
      fiatSymbol: '₦',
      totalFiatValue: '15000.00',
      assets: [
        {
          symbol: 'USDT',
          displayName: 'Tether',
          network: 'TRON',
          amount: '10.00',
          decimals: 6,
          fiatValue: '15000.00',
        },
      ],
    } as never);
    m.walletRepo.findByUser.mockResolvedValue([makeWallet()]);
    m.ledger.listLedgerEntries.mockResolvedValue([makeLedgerEntry()]);
    m.txnRead.listForUser.mockResolvedValue([makeTxn()]);
    m.beneficiaries.listForUser.mockImplementation((_uid, type) =>
      Promise.resolve(
        type === 'bank_account'
          ? [makeBeneficiary()]
          : [
              makeBeneficiary({
                id: 'ben-2',
                type: 'crypto_address',
                label: 'My TRON',
                accountNumber: null,
                accountHolderName: null,
                bankCode: null,
                cryptoAddress: 'TXyz...',
                cryptoAsset: 'USDT',
                cryptoNetwork: 'TRON',
              }),
            ],
      ),
    );
  }

  it('throws AdminNotFoundError when the user does not exist', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUserWithKycAndDevices.mockResolvedValue(null);

    await expect(service.getDetail(USER_ID)).rejects.toBeInstanceOf(
      AdminNotFoundError,
    );
    expect(m.walletBalance.getBalances).not.toHaveBeenCalled();
  });

  it('composes user + balances + transactions + beneficiaries + devices', async () => {
    const { service, m } = makeMocks();
    primeDetailMocks(m);

    const detail = await service.getDetail(USER_ID);

    expect(detail.id).toBe(USER_ID);
    expect(detail.email).toBe('user@example.com');
    expect(detail.status).toBe('active');
    expect(detail.kycStatus).toBe('verified');
    expect(detail.kycTier).toBe('tier_2');
    expect(detail.simSwapDetectedAt).toBeNull();
    expect(detail.createdAt).toBe('2026-01-01T00:00:00.000Z');

    // balances mapped from WalletBalanceService assets
    expect(detail.balances).toEqual([
      { asset: 'USDT', network: 'TRON', amount: '10.00' },
    ]);

    // recent transactions
    expect(detail.recentTransactions).toEqual([
      {
        id: 'txn-1',
        type: 'buy',
        status: 'completed',
        createdAt: '2026-06-28T00:00:00.000Z',
      },
    ]);

    // beneficiaries from both types
    expect(detail.beneficiaries).toEqual([
      {
        id: 'ben-1',
        type: 'bank_account',
        label: 'My GTB',
        verificationStatus: 'verified',
      },
      {
        id: 'ben-2',
        type: 'crypto_address',
        label: 'My TRON',
        verificationStatus: 'verified',
      },
    ]);

    // both beneficiary types queried
    expect(m.beneficiaries.listForUser).toHaveBeenCalledWith(
      USER_ID,
      'bank_account',
    );
    expect(m.beneficiaries.listForUser).toHaveBeenCalledWith(
      USER_ID,
      'crypto_address',
    );

    // ledger queried for the user's wallet under user_wallet account
    expect(m.ledger.listLedgerEntries).toHaveBeenCalledWith(
      'user_wallet',
      'wallet-tron',
      expect.any(Number),
    );
  });

  it('maps devices with isPinned from pinnedDeviceId and ISO dates', async () => {
    const { service, m } = makeMocks();
    primeDetailMocks(m);

    const detail = await service.getDetail(USER_ID);

    expect(detail.devices).toEqual([
      {
        id: 'device-pinned',
        trustState: 'bound',
        isPinned: true,
        lastUsedAt: '2026-06-29T00:00:00.000Z',
        boundAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'device-other',
        trustState: 'revoked',
        isPinned: false,
        lastUsedAt: null,
        boundAt: null,
      },
    ]);
  });

  it('never exposes pinHash, nin, or bvn in the detail payload', async () => {
    const { service, m } = makeMocks();
    primeDetailMocks(m);

    const detail = await service.getDetail(USER_ID);
    const serialized = JSON.stringify(detail);

    expect(serialized).not.toContain('12345678901'); // nin
    expect(serialized).not.toContain('22345678901'); // bvn
    expect(serialized).not.toContain('pinHash');
  });
});

// ── adjustTier ───────────────────────────────────────────────────────────────

describe('AdminEndUserService.adjustTier', () => {
  it('sets the tier and audits kyc_state_change with before/after', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUserWithKycAndDevices.mockResolvedValue(makeDetail());

    await service.adjustTier(USER_ID, 'tier_3', ADMIN_ID);

    expect(m.identity.setKycTier).toHaveBeenCalledWith(USER_ID, 'tier_3');
    expect(m.auditCalls).toHaveLength(1);
    const a = m.auditCalls[0];
    expect(a.action).toBe('kyc_state_change');
    expect(a.actorAdminId).toBe(ADMIN_ID);
    expect(a.subject).toContain(USER_ID);
    expect(a.before).toEqual({ tier: 'tier_2' });
    expect(a.after).toEqual({ tier: 'tier_3' });
  });
});

// ── setStatus ────────────────────────────────────────────────────────────────

describe('AdminEndUserService.setStatus', () => {
  it('sets the status and audits admin_update', async () => {
    const { service, m } = makeMocks();

    await service.setStatus(USER_ID, 'suspended', ADMIN_ID);

    expect(m.identity.setUserStatus).toHaveBeenCalledWith(USER_ID, 'suspended');
    expect(m.auditCalls).toHaveLength(1);
    const a = m.auditCalls[0];
    expect(a.action).toBe('admin_update');
    expect(a.actorAdminId).toBe(ADMIN_ID);
    expect(a.after).toEqual({ status: 'suspended' });
  });
});

// ── forcePinReset ────────────────────────────────────────────────────────────

describe('AdminEndUserService.forcePinReset', () => {
  it('clears the pin, unpins the device, and audits pin_reset', async () => {
    const { service, m } = makeMocks();

    await service.forcePinReset(USER_ID, ADMIN_ID);

    expect(m.pin.clearPin).toHaveBeenCalledWith(USER_ID);
    expect(m.identity.unpinDevice).toHaveBeenCalledWith(USER_ID);
    expect(m.auditCalls).toHaveLength(1);
    expect(m.auditCalls[0].action).toBe('pin_reset');
    expect(m.auditCalls[0].actorAdminId).toBe(ADMIN_ID);
  });

  it('never sets or reveals a pin (setPinHash is not called)', async () => {
    const { service, m } = makeMocks();

    await service.forcePinReset(USER_ID, ADMIN_ID);

    expect(m.pin.setPinHash).not.toHaveBeenCalled();
  });
});

// ── listDevices ──────────────────────────────────────────────────────────────

describe('AdminEndUserService.listDevices', () => {
  it('marks the pinned device via pinnedDeviceId and maps ISO dates', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUserWithKycAndDevices.mockResolvedValue(makeDetail());
    const devices: DeviceRecord[] = [
      {
        id: 'device-pinned',
        trustState: 'bound',
        lastUsedAt: new Date('2026-06-29T00:00:00.000Z'),
        boundAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        id: 'device-other',
        trustState: 'bound',
        lastUsedAt: null,
        boundAt: null,
      },
    ];
    m.identity.listDevicesForUser.mockResolvedValue(devices);

    const out = await service.listDevices(USER_ID);

    expect(out).toEqual([
      {
        id: 'device-pinned',
        trustState: 'bound',
        isPinned: true,
        lastUsedAt: '2026-06-29T00:00:00.000Z',
        boundAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'device-other',
        trustState: 'bound',
        isPinned: false,
        lastUsedAt: null,
        boundAt: null,
      },
    ]);
  });
});

// ── revokeDevice ─────────────────────────────────────────────────────────────

describe('AdminEndUserService.revokeDevice', () => {
  it('revokes the device and audits device_bind with the device subject', async () => {
    const { service, m } = makeMocks();

    await service.revokeDevice(USER_ID, 'device-other', ADMIN_ID);

    expect(m.identity.revokeDevice).toHaveBeenCalledWith('device-other');
    expect(m.auditCalls).toHaveLength(1);
    const a = m.auditCalls[0];
    expect(a.action).toBe('device_bind');
    expect(a.subject).toContain('device-other');
    expect(a.actorAdminId).toBe(ADMIN_ID);
  });
});

// ── triggerSimSwapReverify ───────────────────────────────────────────────────

describe('AdminEndUserService.triggerSimSwapReverify', () => {
  it('sets simSwapDetectedAt to now and audits admin_override', async () => {
    const { service, m } = makeMocks();

    await service.triggerSimSwapReverify(USER_ID, ADMIN_ID, NOW);

    expect(m.identity.setSimSwapDetectedAt).toHaveBeenCalledWith(USER_ID, NOW);
    expect(m.auditCalls).toHaveLength(1);
    const a = m.auditCalls[0];
    expect(a.action).toBe('admin_override');
    expect(a.actorAdminId).toBe(ADMIN_ID);
    expect(a.subject).toContain(USER_ID);
  });
});
