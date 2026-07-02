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

/** Page size used to DRAIN the full result set for a CSV export (keyset walk). */
const EXPORT_PAGE_SIZE = 200;

/**
 * Hard safety cap on export pages, so a malformed cursor loop can never hang the
 * request. At {@link EXPORT_PAGE_SIZE} rows/page this bounds an export to 100k
 * rows — far beyond any realistic filtered admin export.
 */
const EXPORT_MAX_PAGES = 500;

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

/** Filters for a CSV export — the list filters plus an optional id allow-list. */
export interface AdminEndUserExportQuery {
  query?: string;
  status?: string;
  kycStatus?: string;
  kycTier?: string;
  /** When present, export only these hand-picked user ids from the matched set. */
  includedIds?: string[];
}

/**
 * One PII-minimised CSV export row for an end user. Balances are pre-joined to a
 * single cell and NIN/BVN are last-4 only — the full identifier NEVER leaves the
 * backend (§3.4).
 */
export interface AdminEndUserExportRow {
  id: string;
  email: string | null;
  displayName: string;
  status: string;
  kycStatus: string;
  kycTier: string;
  simSwapFlagged: boolean;
  sanctionsFlagged: boolean;
  /** e.g. "USDT:100.50 NGN:5000" — one CSV cell (empty when no balances). */
  balances: string;
  ninLast4: string | null;
  bvnLast4: string | null;
  lastActiveAt: string | null;
  createdAt: string;
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

  // ── exportRows ─────────────────────────────────────────────────────────────

  /**
   * Build the FULL set of export rows for the CSV download — the SAME filter
   * pipeline as {@link list}, but with no caller cursor/limit: every matching
   * row is drained by walking the keyset pages. An optional `includedIds`
   * allow-list narrows the matched set to the operator's hand-picked rows.
   *
   * PII-minimised (§3.4): NIN/BVN are truncated to last-4 via the KYC detail —
   * the full identifier never leaves the backend. The controller records the
   * `admin_export` audit event with the resulting rowCount; this method moves no
   * money and mutates nothing.
   */
  async exportRows(
    query: AdminEndUserExportQuery,
  ): Promise<AdminEndUserExportRow[]> {
    const included = query.includedIds ? new Set(query.includedIds) : null;
    const matched: AdminUserListRecord[] = [];

    let cursor: string | undefined;
    for (let page = 0; page < EXPORT_MAX_PAGES; page += 1) {
      const result = await this.identity.listUsers(
        {
          query: query.query,
          status: query.status,
          kycStatus: query.kycStatus,
          kycTier: query.kycTier,
        },
        { cursor, limit: EXPORT_PAGE_SIZE },
      );
      for (const record of result.items) {
        if (!included || included.has(record.id)) matched.push(record);
      }
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    return Promise.all(matched.map((record) => this.toExportRow(record)));
  }

  private async toExportRow(
    record: AdminUserListRecord,
  ): Promise<AdminEndUserExportRow> {
    // Load the KYC detail so NIN/BVN can be surfaced as last-4 only (§3.4). The
    // list projection deliberately omits raw PII, so the detail is the source.
    const detail = await this.identity.loadUserWithKycAndDevices(record.id);
    return {
      id: record.id,
      email: record.email,
      displayName: deriveDisplayName(
        record.firstName,
        record.lastName,
        record.email,
      ),
      status: record.status,
      kycStatus: record.kycStatus,
      kycTier: record.kycTier,
      simSwapFlagged: record.simSwapDetectedAt !== null,
      sanctionsFlagged: record.sanctionsFlagged,
      balances: record.balances.map((b) => `${b.asset}:${b.amount}`).join(' '),
      ninLast4: last4(detail?.kyc?.nin ?? null),
      bvnLast4: last4(detail?.kyc?.bvn ?? null),
      lastActiveAt: toIso(record.lastActiveAt),
      createdAt: record.createdAt.toISOString(),
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
 * Truncate a sensitive identifier (NIN/BVN) to its last 4 digits — the same
 * masking the KYC-review surface uses. The full value NEVER leaves the backend
 * (§3.4). Null in → null out.
 */
function last4(value: string | null): string | null {
  return value ? value.slice(-4) : null;
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
