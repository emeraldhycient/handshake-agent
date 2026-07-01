import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  AdminEndUserDetail,
  AdminEndUserDevice,
  AdminEndUserLedgerEntry,
  AdminEndUserListItem,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import {
  PIN_REPOSITORY,
  type IPinRepository,
} from '../../../core/auth/ports/pin.repository.port';
import {
  IDENTITY_REPOSITORY,
  type AdminUserListRecord,
  type DeviceRecord,
  type IIdentityRepository,
} from '../../identity/application/ports/identity.repository.port';
import {
  LEDGER_REPOSITORY,
  type ILedgerRepository,
} from '../../transactions/application/ports/ledger.repository.port';
import {
  TRANSACTION_READ_REPOSITORY,
  type ITransactionReadRepository,
} from '../../transactions/application/ports/transaction-read.repository.port';
import {
  WALLET_REPOSITORY,
  type IWalletRepository,
} from '../../wallets/application/ports/wallet.repository.port';
import { WalletBalanceService } from '../../wallets/application/wallet-balance.service';
import { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import { AdminNotFoundError } from '../domain/admin-errors';

/** Ledger account type for a user's custodial wallet (mirrors LedgerAccountType.user_wallet). */
const USER_WALLET_ACCOUNT = 'user_wallet';

/** Default page size for the admin end-user list when the caller omits a limit. */
const DEFAULT_LIST_LIMIT = 20;

/** How many recent transactions to surface on the user-detail aggregate. */
const RECENT_TRANSACTIONS_LIMIT = 10;

/** How many recent ledger entries to read per user wallet (reserved for future detail growth). */
const RECENT_LEDGER_LIMIT = 10;

export type AdminEndUserStatusChange = 'active' | 'suspended' | 'deactivated';
export type AdminEndUserKycTier = 'unverified' | 'tier_1' | 'tier_2' | 'tier_3';

export interface AdminEndUserListQuery {
  query?: string;
  status?: string;
  kycStatus?: string;
  kycTier?: string;
  cursor?: string;
  limit?: number;
}

/**
 * ADM-02 platform end-user management. Read aggregates and audited mutations for
 * the admin console. This service NEVER moves money (§3.1) and never reveals a
 * PIN: a force-reset clears the PIN; the user re-establishes one via re-verify.
 *
 * Sensitive identifiers (nin/bvn, pinHash, token hashes) never leave the backend
 * through this service — the detail projection omits them entirely (KYC last-4
 * truncation lives in AdminKycReviewService, the compliance-review surface).
 */
@Injectable()
export class AdminEndUserService {
  constructor(
    @Inject(IDENTITY_REPOSITORY)
    private readonly identity: IIdentityRepository,
    private readonly walletBalance: WalletBalanceService,
    @Inject(WALLET_REPOSITORY)
    private readonly wallets: IWalletRepository,
    @Inject(LEDGER_REPOSITORY)
    private readonly ledger: ILedgerRepository,
    @Inject(TRANSACTION_READ_REPOSITORY)
    private readonly transactions: ITransactionReadRepository,
    private readonly beneficiaries: BeneficiaryService,
    @Inject(PIN_REPOSITORY)
    private readonly pin: IPinRepository,
    private readonly audit: AuditService,
  ) {}

  // ── list ───────────────────────────────────────────────────────────────────

  async list(query: AdminEndUserListQuery): Promise<{
    items: AdminEndUserListItem[];
    nextCursor: string | null;
    total: number;
  }> {
    const result = await this.identity.listUsers(
      {
        query: query.query,
        status: query.status,
        kycStatus: query.kycStatus,
        kycTier: query.kycTier,
      },
      { cursor: query.cursor, limit: query.limit ?? DEFAULT_LIST_LIMIT },
    );
    return {
      items: result.items.map((u) => this.toListItem(u)),
      nextCursor: result.nextCursor,
      total: result.total,
    };
  }

  // ── getDetail ──────────────────────────────────────────────────────────────

  async getDetail(userId: string): Promise<AdminEndUserDetail> {
    const detail = await this.identity.loadUserWithKycAndDevices(userId);
    if (!detail) throw new AdminNotFoundError('User');

    const [
      balances,
      recentTransactions,
      bankBeneficiaries,
      cryptoBeneficiaries,
      userWallets,
      phone,
    ] = await Promise.all([
      this.walletBalance.getBalances(userId),
      this.transactions.listForUser(userId, RECENT_TRANSACTIONS_LIMIT),
      this.beneficiaries.listForUser(userId, 'bank_account'),
      this.beneficiaries.listForUser(userId, 'crypto_address'),
      // Provisioned per-network child wallets — surface their deposit addresses.
      this.wallets.findByUser(userId),
      // Routing phone from the active WhatsApp channel identity (a routing key
      // only, never the identity anchor — §3.4). Null when no phone channel.
      this.identity.findWhatsAppAddressByUserId(userId),
    ]);

    // Recent double-entry ledger lines for the user's wallet account.
    const recentLedger = await this.readRecentLedger(userId);

    return {
      id: detail.id,
      email: detail.email,
      status: detail.status as AdminEndUserDetail['status'],
      kycStatus: detail.kycStatus as AdminEndUserDetail['kycStatus'],
      kycTier: detail.kycTier as AdminEndUserDetail['kycTier'],
      simSwapDetectedAt: toIso(detail.simSwapDetectedAt),
      phone,
      createdAt: detail.createdAt.toISOString(),
      devices: detail.devices.map((d) =>
        this.toDevice(d, detail.pinnedDeviceId),
      ),
      balances: balances.assets.map((a) => ({
        asset: a.symbol,
        network: a.network,
        amount: a.amount,
        // Pending (unconfirmed inbound) balance is not surfaced by the ledger
        // read yet — null until a pending-deposit projection is added.
        pending: null,
      })),
      depositAddresses: userWallets.map((w) => ({
        network: w.network,
        address: w.address,
        status: w.status,
      })),
      recentTransactions: recentTransactions.map((t) => ({
        id: t.id,
        type: t.type,
        status: t.status,
        asset: t.asset,
        amount: t.amount,
        fiatAmount: t.fiatAmount,
        fiatCurrency: t.fiatCurrency,
        createdAt: t.createdAt.toISOString(),
      })),
      recentLedger,
      beneficiaries: [...bankBeneficiaries, ...cryptoBeneficiaries].map(
        (b) => ({
          id: b.id,
          type: b.type,
          label: b.label,
          verificationStatus: b.verificationStatus,
        }),
      ),
    };
  }

  // ── adjustTier ─────────────────────────────────────────────────────────────

  async adjustTier(
    userId: string,
    tier: AdminEndUserKycTier,
    adminId: string,
  ): Promise<void> {
    const before = await this.identity.loadUserWithKycAndDevices(userId);
    await this.identity.setKycTier(userId, tier);
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `User:${userId}`,
      action: 'kyc_state_change',
      before: before ? { tier: before.kycTier } : null,
      after: { tier },
    });
  }

  // ── setStatus ──────────────────────────────────────────────────────────────

  async setStatus(
    userId: string,
    status: AdminEndUserStatusChange,
    adminId: string,
  ): Promise<void> {
    await this.identity.setUserStatus(userId, status);
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `User:${userId}`,
      action: 'admin_update',
      after: { status },
    });
  }

  // ── forcePinReset ──────────────────────────────────────────────────────────

  /**
   * Clears the user's PIN and unpins the bound device. Never sets or reveals a
   * PIN — the user must re-establish one via re-verification (§3.4).
   */
  async forcePinReset(userId: string, adminId: string): Promise<void> {
    await this.pin.clearPin(userId);
    await this.identity.unpinDevice(userId);
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `User:${userId}`,
      action: 'pin_reset',
    });
  }

  // ── listDevices ────────────────────────────────────────────────────────────

  async listDevices(userId: string): Promise<AdminEndUserDevice[]> {
    const detail = await this.identity.loadUserWithKycAndDevices(userId);
    if (!detail) throw new AdminNotFoundError('User');
    const devices = await this.identity.listDevicesForUser(userId);
    return devices.map((d) => this.toDevice(d, detail.pinnedDeviceId));
  }

  // ── revokeDevice ───────────────────────────────────────────────────────────

  async revokeDevice(
    userId: string,
    deviceId: string,
    adminId: string,
  ): Promise<void> {
    await this.identity.revokeDevice(deviceId);
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Device:${deviceId}`,
      action: 'device_bind',
      details: { userId, revoked: true },
    });
  }

  // ── triggerSimSwapReverify ───────────────────────────────────────────────────

  /**
   * Flags a SIM-swap so the user's transactions are gated until re-verification
   * (§3.4). Audited as an admin override.
   */
  async triggerSimSwapReverify(
    userId: string,
    adminId: string,
    now: Date,
  ): Promise<void> {
    await this.identity.setSimSwapDetectedAt(userId, now);
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `User:${userId}`,
      action: 'admin_override',
      details: { simSwapDetectedAt: now.toISOString() },
    });
  }

  // ── private mappers ──────────────────────────────────────────────────────────

  private toListItem(u: AdminUserListRecord): AdminEndUserListItem {
    return {
      id: u.id,
      email: u.email,
      displayName: deriveDisplayName(u.firstName, u.lastName, u.email),
      status: u.status as AdminEndUserListItem['status'],
      kycStatus: u.kycStatus as AdminEndUserListItem['kycStatus'],
      kycTier: u.kycTier as AdminEndUserListItem['kycTier'],
      simSwapFlagged: u.simSwapDetectedAt !== null,
      sanctionsFlagged: u.sanctionsFlagged,
      balances: u.balances.map((b) => ({ asset: b.asset, amount: b.amount })),
      lastActiveAt: toIso(u.lastActiveAt),
      createdAt: u.createdAt.toISOString(),
    };
  }

  private toDevice(
    d: DeviceRecord,
    pinnedDeviceId: string | null,
  ): AdminEndUserDevice {
    return {
      id: d.id,
      trustState: d.trustState as AdminEndUserDevice['trustState'],
      isPinned: d.id === pinnedDeviceId,
      lastUsedAt: toIso(d.lastUsedAt),
      boundAt: toIso(d.boundAt),
    };
  }

  private async readRecentLedger(
    userId: string,
  ): Promise<AdminEndUserLedgerEntry[]> {
    const wallets = await this.wallets.findByUser(userId);
    const perWallet = await Promise.all(
      wallets.map((w) =>
        this.ledger.listLedgerEntries(
          USER_WALLET_ACCOUNT,
          w.id,
          RECENT_LEDGER_LIMIT,
        ),
      ),
    );
    return perWallet
      .flat()
      .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime())
      .slice(0, RECENT_LEDGER_LIMIT)
      .map((e) => ({
        id: e.id,
        transactionId: e.transactionId,
        currency: e.currency,
        amount: e.amount,
        direction: e.direction as 'debit' | 'credit',
        balanceAfter: e.balanceAfter,
        postedAt: e.postedAt.toISOString(),
      }));
  }
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Human display name for the admin list: KYC first/last name, else the email
 * local-part, else a generic label. Never exposes a raw PII identifier (§3.4).
 */
function deriveDisplayName(
  firstName: string | null,
  lastName: string | null,
  email: string | null,
): string {
  const kycName = [firstName, lastName]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .join(' ');
  if (kycName) return kycName;

  const local = email?.split('@')[0]?.trim();
  if (local) return local;

  return 'Unnamed user';
}
