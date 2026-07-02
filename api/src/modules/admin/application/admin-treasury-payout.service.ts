import { Inject, Injectable } from '@nestjs/common';

import type { TreasuryPayoutApproveResponse } from '@handshake-agent/contracts';

import {
  TREASURY_READ_REPOSITORY,
  type ITreasuryReadRepository,
} from '../../treasury/application/ports/treasury-read.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';
import { AdminApprovalsService } from './admin-approvals.service';

/**
 * ADM Phase 7 (WRITE — maker-checker) — approving a queued payout / withdrawal for
 * release. FUNDS-SAFETY-CRITICAL: this NEVER releases money directly. It raises a
 * pending `payout_release` CHANGE REQUEST (the maker) that a DIFFERENT admin must
 * confirm (four-eyes) before the release is applied — and even then the apply routes
 * through the engine's atomic settlement re-drive, never a raw ledger write (§3.1).
 *
 * The payout is looked up SERVER-SIDE by its opaque id so the change-request payload
 * carries the real offending transaction — a client can never point the release at a
 * different transaction. An unknown / no-longer-pending payout fails closed (§3.6).
 *
 * It holds no Prisma import — it reaches data through the injected treasury read port
 * and raises the request through the approvals service (§3.2).
 */
@Injectable()
export class AdminTreasuryPayoutService {
  constructor(
    @Inject(TREASURY_READ_REPOSITORY)
    private readonly treasury: ITreasuryReadRepository,
    private readonly approvals: AdminApprovalsService,
  ) {}

  /**
   * Raise a maker-checker approval for a queued payout. APPLIES NOTHING — it enters
   * the four-eyes inbox for a second admin to confirm. Returns the pending
   * change-request id; `released` is always false (no money moves here, §3.1).
   */
  async approve(
    payoutId: string,
    reason: string,
    adminId: string,
  ): Promise<TreasuryPayoutApproveResponse> {
    const payout = await this.treasury.findPayoutQueueItem(payoutId);
    if (payout === null) throw new AdminNotFoundError('Payout');

    const changeRequest = await this.approvals.create(
      {
        kind: 'payout_release',
        // A stable, human-readable target the inbox renders verbatim.
        resource: `Payout:${payout.id} (${payout.reference})`,
        // Only the SERVER-derived transactionId — the applier re-validates it and
        // re-drives its settlement via the engine (never a client-supplied txn).
        payload: { transactionId: payout.transactionId },
        reason,
      },
      adminId,
    );

    return {
      payoutId: payout.id,
      changeRequestId: changeRequest.id,
      status: 'pending',
      released: false,
    };
  }
}
