import { AdminManualCreditService } from './admin-manual-credit.service';
import {
  AdminNotFoundError,
  ManualCreditNotAllowedError,
} from '../domain/admin-errors';
import type { ISettlementRepository } from '../../transactions/application/ports/settlement.repository.port';
import type { IIdentityRepository } from '../../identity/application/ports/identity.repository.port';
import type { IWalletRepository } from '../../wallets/application/ports/wallet.repository.port';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { AuditService } from '../../../core/audit/application/audit.service';
import type { Clock } from '../../../core/common/clock';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const NOW = new Date('2026-07-01T12:00:00.000Z');
const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CR_ID = '33333333-3333-3333-3333-333333333333';

function makeSettlementRepo(): jest.Mocked<ISettlementRepository> {
  // Every method is a jest.fn so the spec can assert the service ONLY ever calls
  // settleManualCreditAtomic (never a raw ledger write, never another atomic).
  return {
    settleBuyAtomic: jest.fn(),
    createSellSettlingWithReserveAtomic: jest.fn(),
    findReceiptNumber: jest.fn(),
    postSellReserveAtomic: jest.fn(),
    settleSellFinalizeAtomic: jest.fn(),
    settleSellRefundAtomic: jest.fn(),
    createSendSettlingWithReserveAtomic: jest.fn(),
    settleSendFinalizeAtomic: jest.fn(),
    settleSendRefundAtomic: jest.fn(),
    createSwapSettlingWithReserveAtomic: jest.fn(),
    settleSwapFinalizeAtomic: jest.fn(),
    settleSwapRefundAtomic: jest.fn(),
    settleManualCreditAtomic: jest.fn().mockResolvedValue({
      credited: true,
      newBalance: '125.5',
      receiptNumber: 'HS-2026-000042',
    }),
    settleInternalTransferAtomic: jest.fn(),
  };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: 'u@x.io',
    status: 'active',
    kycStatus: 'verified',
    kycTier: 'tier_2',
    simSwapDetectedAt: null,
    createdAt: NOW,
    pinnedDeviceId: null,
    kyc: null,
    devices: [],
    ...overrides,
  };
}

type IdentityDouble = jest.Mocked<
  Pick<IIdentityRepository, 'loadUserWithKycAndDevices' | 'hasSanctionsHit'>
>;

function makeIdentity(
  user: Record<string, unknown> | null = makeUser(),
  sanctionsHit = false,
): IdentityDouble {
  return {
    loadUserWithKycAndDevices: jest.fn().mockResolvedValue(user),
    hasSanctionsHit: jest.fn().mockResolvedValue(sanctionsHit),
  };
}

function makeWallets(
  wallets: Array<{ id: string; network: string }> = [
    { id: 'wallet-tron-1', network: 'TRON' },
  ],
): jest.Mocked<Pick<IWalletRepository, 'findByUser'>> {
  return {
    findByUser: jest.fn().mockResolvedValue(wallets),
  };
}

function makeAssetRegistry(): jest.Mocked<
  Pick<AssetRegistry, 'asset' | 'defaultNetworkFor'>
> {
  return {
    asset: jest.fn().mockReturnValue({ decimals: 6 }),
    defaultNetworkFor: jest.fn().mockReturnValue('TRON'),
  };
}

function makeAudit(): jest.Mocked<AuditService> {
  return {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;
}

const CLOCK: Clock = { now: () => NOW };

function build(
  overrides: {
    settlement?: jest.Mocked<ISettlementRepository>;
    identity?: IdentityDouble;
    wallets?: ReturnType<typeof makeWallets>;
    assetRegistry?: ReturnType<typeof makeAssetRegistry>;
    audit?: jest.Mocked<AuditService>;
  } = {},
) {
  const settlement = overrides.settlement ?? makeSettlementRepo();
  const identity = overrides.identity ?? makeIdentity();
  const wallets = overrides.wallets ?? makeWallets();
  const assetRegistry = overrides.assetRegistry ?? makeAssetRegistry();
  const audit = overrides.audit ?? makeAudit();
  const service = new AdminManualCreditService(
    settlement,
    identity as unknown as IIdentityRepository,
    wallets as unknown as IWalletRepository,
    assetRegistry as unknown as AssetRegistry,
    audit,
    CLOCK,
  );
  return { service, settlement, identity, wallets, assetRegistry, audit };
}

const INPUT = {
  userId: USER_ID,
  asset: 'USDT',
  amount: '25.5',
  reason: 'goodwill credit for support incident',
  idempotencyKey: CR_ID,
  approvedByAdminId: ADMIN_ID,
};

// ---------------------------------------------------------------------------
// Happy path — engine-brokered, audited, idempotency-keyed
// ---------------------------------------------------------------------------

describe('AdminManualCreditService.creditUser — happy path', () => {
  it('credits via the engine atomic with the resolved wallet/decimals/idempotency', async () => {
    const { service, settlement } = build();

    const result = await service.creditUser(INPUT);

    expect(settlement.settleManualCreditAtomic).toHaveBeenCalledTimes(1);
    expect(settlement.settleManualCreditAtomic).toHaveBeenCalledWith({
      userId: USER_ID,
      walletId: 'wallet-tron-1',
      cryptoAmount: '25.5',
      asset: 'USDT',
      assetDecimals: 6,
      idempotencyKey: CR_ID,
      approvedByAdminId: ADMIN_ID,
      reason: 'goodwill credit for support incident',
      now: NOW,
      year: '2026',
    });
    expect(result).toEqual({
      userId: USER_ID,
      asset: 'USDT',
      amount: '25.5',
      credited: true,
      newBalance: '125.5',
      receiptNumber: 'HS-2026-000042',
    });
  });

  it('NEVER calls any settlement method other than settleManualCreditAtomic (§3.1)', async () => {
    const { service, settlement } = build();

    await service.creditUser(INPUT);

    for (const [name, fn] of Object.entries(settlement)) {
      if (name === 'settleManualCreditAtomic') continue;
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('records an immutable admin_override audit keyed by the idempotency key', async () => {
    const { service, audit } = build();

    await service.creditUser(INPUT);

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: CR_ID,
        actorAdminId: ADMIN_ID,
        subject: `User:${USER_ID}`,
        action: 'admin_override',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest expect.objectContaining is typed `any`
        after: expect.objectContaining({
          action: 'manual_credit',
          asset: 'USDT',
          amount: '25.5',
          credited: true,
          receiptNumber: 'HS-2026-000042',
        }),
      }),
    );
  });

  it('propagates the engine idempotent no-op (credited=false) without erroring', async () => {
    const settlement = makeSettlementRepo();
    settlement.settleManualCreditAtomic.mockResolvedValue({
      credited: false,
      newBalance: '100',
      receiptNumber: 'HS-2026-000001',
    });
    const { service } = build({ settlement });

    const result = await service.creditUser(INPUT);

    expect(result.credited).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Server-side re-check (§3.3) — money never moves on a forbidden state
// ---------------------------------------------------------------------------

describe('AdminManualCreditService.creditUser — server-side gate', () => {
  it('throws AdminNotFoundError and never credits when the user is missing', async () => {
    const { service, settlement } = build({ identity: makeIdentity(null) });

    await expect(service.creditUser(INPUT)).rejects.toBeInstanceOf(
      AdminNotFoundError,
    );
    expect(settlement.settleManualCreditAtomic).not.toHaveBeenCalled();
  });

  it('refuses a credit to a deactivated account (no money moves)', async () => {
    const { service, settlement } = build({
      identity: makeIdentity(makeUser({ status: 'deactivated' })),
    });

    await expect(service.creditUser(INPUT)).rejects.toBeInstanceOf(
      ManualCreditNotAllowedError,
    );
    expect(settlement.settleManualCreditAtomic).not.toHaveBeenCalled();
  });

  it('refuses a credit to a sanctions-flagged user (no money moves)', async () => {
    const { service, settlement } = build({
      identity: makeIdentity(makeUser(), true),
    });

    await expect(service.creditUser(INPUT)).rejects.toBeInstanceOf(
      ManualCreditNotAllowedError,
    );
    expect(settlement.settleManualCreditAtomic).not.toHaveBeenCalled();
  });

  it('refuses a credit for an unregistered/disabled asset (registry throws)', async () => {
    const assetRegistry = makeAssetRegistry();
    assetRegistry.asset.mockImplementation(() => {
      throw new Error('UnsupportedAssetError');
    });
    const { service, settlement } = build({ assetRegistry });

    await expect(service.creditUser(INPUT)).rejects.toThrow();
    expect(settlement.settleManualCreditAtomic).not.toHaveBeenCalled();
  });

  it('refuses a credit when the user has no wallet on the asset network', async () => {
    const { service, settlement } = build({
      wallets: makeWallets([{ id: 'w-eth', network: 'ETHEREUM' }]),
    });

    await expect(service.creditUser(INPUT)).rejects.toBeInstanceOf(
      ManualCreditNotAllowedError,
    );
    expect(settlement.settleManualCreditAtomic).not.toHaveBeenCalled();
  });

  it('does not audit when the gate rejects (no money moved, nothing to record)', async () => {
    const { service, audit } = build({
      identity: makeIdentity(makeUser(), true),
    });

    await expect(service.creditUser(INPUT)).rejects.toBeInstanceOf(
      ManualCreditNotAllowedError,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });
});
