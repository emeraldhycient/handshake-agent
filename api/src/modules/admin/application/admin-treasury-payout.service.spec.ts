import { AdminTreasuryPayoutService } from './admin-treasury-payout.service';
import { AdminNotFoundError } from '../domain/admin-errors';
import type {
  ITreasuryReadRepository,
  TreasuryPayoutQueueRecord,
} from '../../treasury/application/ports/treasury-read.repository.port';
import type { AdminApprovalsService } from './admin-approvals.service';

const ADMIN_ID = '99999999-9999-9999-9999-999999999999';
const OUTBOX_ID = '55555555-5555-5555-5555-555555555555';
const TXN_ID = '66666666-6666-6666-6666-666666666666';
const CR_ID = '77777777-7777-7777-7777-777777777777';

function makePayout(
  over?: Partial<TreasuryPayoutQueueRecord>,
): TreasuryPayoutQueueRecord {
  return {
    id: OUTBOX_ID,
    transactionId: TXN_ID,
    beneficiaryLabel: 'GTBank · 0123456789',
    reference: 'wd_66666666',
    method: 'NGN payout · Flutterwave',
    asset: 'NGN',
    amount: '1500000.00',
    fiatAmount: null,
    fiatCurrency: 'NGN',
    submittedAt: new Date('2026-06-30T12:00:00.000Z'),
    ...over,
  };
}

function makeReadRepo(): jest.Mocked<
  Pick<ITreasuryReadRepository, 'findPayoutQueueItem'>
> {
  return { findPayoutQueueItem: jest.fn() };
}

function makeApprovals(): jest.Mocked<Pick<AdminApprovalsService, 'create'>> {
  return {
    create: jest.fn().mockResolvedValue({ id: CR_ID }),
  };
}

describe('AdminTreasuryPayoutService', () => {
  let repo: ReturnType<typeof makeReadRepo>;
  let approvals: ReturnType<typeof makeApprovals>;
  let service: AdminTreasuryPayoutService;

  beforeEach(() => {
    repo = makeReadRepo();
    approvals = makeApprovals();
    service = new AdminTreasuryPayoutService(
      repo as unknown as ITreasuryReadRepository,
      approvals as unknown as AdminApprovalsService,
    );
  });

  it('raises a payout_release maker-checker request (never releases here)', async () => {
    repo.findPayoutQueueItem.mockResolvedValue(makePayout());

    const result = await service.approve(
      OUTBOX_ID,
      'Large payout verified against the source order.',
      ADMIN_ID,
    );

    // A maker-checker CHANGE REQUEST is raised — the release is NOT applied here.
    expect(approvals.create).toHaveBeenCalledTimes(1);
    const [input, maker] = approvals.create.mock.calls[0];
    expect(input.kind).toBe('payout_release');
    // The payload carries the SERVER-derived transactionId, never a client value.
    expect(input.payload).toMatchObject({ transactionId: TXN_ID });
    expect(maker).toBe(ADMIN_ID);

    expect(result).toEqual({
      payoutId: OUTBOX_ID,
      changeRequestId: CR_ID,
      status: 'pending',
      released: false,
    });
  });

  it('fails closed on an unknown / no-longer-pending payout', async () => {
    repo.findPayoutQueueItem.mockResolvedValue(null);

    await expect(
      service.approve(OUTBOX_ID, 'why', ADMIN_ID),
    ).rejects.toBeInstanceOf(AdminNotFoundError);
    expect(approvals.create).not.toHaveBeenCalled();
  });
});
