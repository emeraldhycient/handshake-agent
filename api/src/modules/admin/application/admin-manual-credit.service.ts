import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../../../core/audit/application/audit.service';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { CLOCK, type Clock } from '../../../core/common/clock';
import {
  IDENTITY_REPOSITORY,
  type IIdentityRepository,
} from '../../identity/application/ports/identity.repository.port';
import {
  WALLET_REPOSITORY,
  type IWalletRepository,
} from '../../wallets/application/ports/wallet.repository.port';
import {
  SETTLEMENT_REPOSITORY,
  type ISettlementRepository,
} from '../../transactions/application/ports/settlement.repository.port';
import {
  AdminNotFoundError,
  ManualCreditNotAllowedError,
} from '../domain/admin-errors';

/** Outcome of an engine-brokered manual credit. */
export interface AdminManualCreditResult {
  userId: string;
  asset: string;
  amount: string;
  /** True on a fresh credit; false when the idempotency key already settled. */
  credited: boolean;
  /** The user_wallet running balance after the credit (decimal string). */
  newBalance: string;
  /** The minted receipt number, e.g. "HS-2026-000001". */
  receiptNumber: string;
}

export interface CreditUserInput {
  userId: string;
  asset: string;
  amount: string;
  /** The maker's justification (audited). */
  reason: string;
  /**
   * Stable idempotency key for the credit — the approved ChangeRequest id. A
   * replayed apply with the same key is a no-op (the engine short-circuits).
   */
  idempotencyKey: string;
  /** The admin id that approved the credit (the checker). */
  approvedByAdminId: string;
}

/**
 * ADM Phase 7 (WRITES) — engine-brokered, audited, idempotent admin MANUAL CREDIT.
 * This is the MONEY PATH, so it upholds §3.1 absolutely: it NEVER constructs a
 * ledger entry or WalletBalance row directly. The credit routes through the
 * deterministic engine's atomic `settleManualCreditAtomic`, which posts a balanced
 * double-entry (user_wallet + treasury contra), snapshots the balance and mints a
 * signed receipt — atomically and idempotently on the `idempotencyKey`.
 *
 * Before the engine runs, the service RE-CHECKS the credited user's state
 * server-side (§3.3): a deactivated account, a sanctions-flagged user, an
 * unregistered/disabled asset, or a user with no custodial wallet on the asset's
 * network all fail closed — the money never moves. The service holds no Prisma
 * import; it reaches the DB only through injected ports (§3.2).
 *
 * This service is the APPLIER of an approved `manual_credit` ChangeRequest — it is
 * invoked by AdminApprovalsService.approve after four-eyes has been enforced. The
 * maker route (POST /admin/users/:id/credit) only RAISES the request; it never
 * calls this service directly (no single admin can self-credit).
 */
@Injectable()
export class AdminManualCreditService {
  constructor(
    @Inject(SETTLEMENT_REPOSITORY)
    private readonly settlement: ISettlementRepository,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identity: IIdentityRepository,
    @Inject(WALLET_REPOSITORY)
    private readonly wallets: IWalletRepository,
    private readonly assetRegistry: AssetRegistry,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Credits an end user's custodial wallet via the engine's atomic method, after
   * a server-side re-check of the user's status / KYC / sanctions and asset/wallet
   * validity. Returns the engine's outcome (credited flag + new balance + receipt).
   */
  async creditUser(input: CreditUserInput): Promise<AdminManualCreditResult> {
    const { userId, asset, amount, reason, idempotencyKey, approvedByAdminId } =
      input;

    // ── 1. Server-side re-check of the credited user (§3.3) ───────────────────
    // Never trust the maker's raise: re-load the user and refuse a credit to a
    // deactivated or sanctions-flagged account BEFORE any money moves. The
    // sanctions verdict is the authoritative persisted `hit` (not a stale flag).
    const user = await this.identity.loadUserWithKycAndDevices(userId);
    if (user === null) throw new AdminNotFoundError('User');
    if (user.status === 'deactivated') {
      throw new ManualCreditNotAllowedError('the account is deactivated');
    }
    if (await this.identity.hasSanctionsHit(userId)) {
      throw new ManualCreditNotAllowedError('the user is sanctions-flagged');
    }

    // ── 2. Validate the asset is catalog-live + resolve its decimals + network ─
    // asset() throws UnsupportedAssetError (→ 422) if the symbol is unknown or
    // disabled — the credit can only target a live asset (§7 catalog is truth).
    const assetMeta = this.assetRegistry.asset(asset);
    const network = this.assetRegistry.defaultNetworkFor(asset);

    // ── 3. Resolve the user's custodial wallet on the asset's network ─────────
    // One wallet per (user, network) — all assets on the network share it.
    const userWallets = await this.wallets.findByUser(userId);
    const wallet = userWallets.find((w) => w.network === network);
    if (wallet === undefined) {
      throw new ManualCreditNotAllowedError(
        `the user has no ${network} wallet to credit`,
      );
    }

    // ── 4. Engine-brokered atomic credit (the ONLY money write, §3.1) ─────────
    const now = this.clock.now();
    const result = await this.settlement.settleManualCreditAtomic({
      userId,
      walletId: wallet.id,
      cryptoAmount: amount,
      asset,
      assetDecimals: assetMeta.decimals,
      idempotencyKey,
      approvedByAdminId,
      reason,
      now,
      year: now.getUTCFullYear().toString(),
    });

    // ── 5. Immutable audit (hash-chained) ─────────────────────────────────────
    await this.audit.record({
      correlationId: idempotencyKey,
      actorAdminId: approvedByAdminId,
      subject: `User:${userId}`,
      action: 'admin_override',
      after: {
        action: 'manual_credit',
        asset,
        amount,
        reason,
        credited: result.credited,
        receiptNumber: result.receiptNumber,
      },
    });

    return {
      userId,
      asset,
      amount,
      credited: result.credited,
      newBalance: result.newBalance,
      receiptNumber: result.receiptNumber,
    };
  }
}
