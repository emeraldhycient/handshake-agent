import { Inject, Injectable } from '@nestjs/common';

import type {
  AdminTxnDetail,
  AdminTxnEconomics,
  AdminTxnListItem,
  AdminTxnLedgerLeg,
  AdminTxnProviderReference,
  AdminTxnStatus,
  AdminTxnTimelineEntry,
  AdminTxnViewCounts,
} from '@handshake-agent/contracts';

import {
  LEDGER_REPOSITORY,
  type ILedgerRepository,
  type LedgerEntryRecord,
} from '../../transactions/application/ports/ledger.repository.port';
import {
  TRANSACTION_REPOSITORY,
  type ITransactionRepository,
  type TransactionRecord,
} from '../../transactions/application/ports/transaction.repository.port';
import {
  ADMIN_TXN_READ_REPOSITORY,
  type AdminTxnReadRecord,
  type IAdminTxnReadRepository,
} from './ports/admin-txn-read.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';

/** Default page size for the admin transactions list when the caller omits one. */
const DEFAULT_LIST_LIMIT = 20;

export interface AdminTxnListQuery {
  status?: string;
  type?: string;
  userId?: string;
  q?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Phase 3 (sub-area A) + Phase 6b enrichment — READ-ONLY transactions oversight.
 *
 * This service NEVER moves money (§3.1): it only projects existing Transaction
 * rows, their double-entry ledger legs, and the type-specific economics the engine
 * persisted in `Transaction.metadata`. It holds no Prisma import — it reaches data
 * exclusively through injected repository ports (§3.2). The user display name is
 * derived FE-side from the joined login email (the User model has no name field,
 * §3.4); the operator-only internal margin is computed here and gated to this
 * operator surface (never surfaced to end users).
 */
@Injectable()
export class AdminTxnOversightService {
  constructor(
    @Inject(TRANSACTION_REPOSITORY)
    private readonly txns: ITransactionRepository,
    @Inject(LEDGER_REPOSITORY)
    private readonly ledger: ILedgerRepository,
    @Inject(ADMIN_TXN_READ_REPOSITORY)
    private readonly read: IAdminTxnReadRepository,
  ) {}

  // ── list ───────────────────────────────────────────────────────────────────

  async list(query: AdminTxnListQuery): Promise<{
    items: AdminTxnListItem[];
    nextCursor: string | null;
    counts: AdminTxnViewCounts;
  }> {
    const filter = {
      status: query.status,
      type: query.type,
      userId: query.userId,
      q: query.q,
      from: query.from !== undefined ? new Date(query.from) : undefined,
      to: query.to !== undefined ? new Date(query.to) : undefined,
    };

    const [page, counts] = await Promise.all([
      this.read.list(
        {
          status: filter.status,
          type: filter.type,
          userId: filter.userId,
          q: filter.q,
          from: filter.from,
          to: filter.to,
        },
        { cursor: query.cursor, limit: query.limit ?? DEFAULT_LIST_LIMIT },
      ),
      this.read.countViews({
        type: filter.type,
        userId: filter.userId,
        q: filter.q,
        from: filter.from,
        to: filter.to,
      }),
    ]);

    // One batch email join for the page's users (the FE derives the display name).
    const emails = await this.read.emailsByUserIds(
      page.items.map((t) => t.userId),
    );

    return {
      items: page.items.map((t) =>
        this.toListItem(t, emails.get(t.userId) ?? null),
      ),
      nextCursor: page.nextCursor,
      counts,
    };
  }

  // ── getDetail ──────────────────────────────────────────────────────────────

  async getDetail(id: string): Promise<AdminTxnDetail> {
    const txn = await this.txns.findById(id);
    if (txn === null) throw new AdminNotFoundError('Transaction');

    const [legs, userEmail] = await Promise.all([
      this.ledger.listByTransaction(id),
      this.read.emailByUserId(txn.userId),
    ]);

    return {
      id: txn.id,
      userId: txn.userId,
      userEmail,
      type: txn.type,
      status: txn.status as AdminTxnStatus,
      idempotencyKey: txn.idempotencyKey,
      processorTxRef: txn.processorTxRef,
      onChainTxHash: txn.onChainTxHash,
      failureReason: txn.failureReason,
      createdAt: txn.createdAt.toISOString(),
      executedAt: toIso(txn.executedAt),
      completedAt: toIso(txn.completedAt),
      failedAt: toIso(txn.failedAt),
      economics: this.deriveEconomics(txn.metadata),
      ledgerLegs: legs.map((l) => this.toLeg(l)),
      timeline: this.deriveTimeline(txn),
      providerReferences: this.deriveProviderReferences(txn),
    };
  }

  // ── private mappers ──────────────────────────────────────────────────────────

  private toListItem(
    t: AdminTxnReadRecord,
    userEmail: string | null,
  ): AdminTxnListItem {
    const meta = t.metadata;
    return {
      id: t.id,
      userId: t.userId,
      userEmail,
      type: t.type,
      status: t.status as AdminTxnStatus,
      asset: str(meta.asset),
      amount: cryptoAmount(meta),
      fiatAmount: str(meta.fiatAmount) ?? str(meta.netFiatAmount),
      fiatCurrency: str(meta.fiatCurrency),
      idempotencyKey: t.idempotencyKey,
      createdAt: t.createdAt.toISOString(),
    };
  }

  private toLeg(l: LedgerEntryRecord): AdminTxnLedgerLeg {
    return {
      accountType: l.accountType,
      accountId: l.accountId,
      currency: l.currency,
      amount: l.amount,
      direction: l.direction as 'debit' | 'credit',
      balanceAfter: l.balanceAfter,
      sequence: l.sequence,
      postedAt: l.postedAt.toISOString(),
    };
  }

  /**
   * Projects the itemized economics from the transaction metadata the engine
   * persisted (buy/sell store asset/fiatAmount/cryptoAmount/fxRate/baseRate/
   * spreadBps/processingFeeAmount; send/swap store asset/cryptoAmount only).
   * Absent values stay null — nothing is fabricated. The operator-only internal
   * margin is the (effective − base) rate delta applied to the crypto amount.
   */
  private deriveEconomics(meta: Record<string, unknown>): AdminTxnEconomics {
    const amount = cryptoAmount(meta);
    const rate = str(meta.fxRate);
    const baseRate = str(meta.baseRate);
    return {
      asset: str(meta.asset) ?? str(meta.fromAsset),
      amount,
      fiatAmount: str(meta.fiatAmount) ?? str(meta.netFiatAmount),
      fiatCurrency: str(meta.fiatCurrency),
      rate,
      processingFee: str(meta.processingFeeAmount),
      fxSpreadBps: str(meta.spreadBps),
      internalMargin: internalMargin(rate, baseRate, amount),
    };
  }

  /**
   * Labelled external references from the transaction's dedicated columns +
   * metadata: TRON on-chain hash, Flutterwave payout ref, Blockradar withdrawal
   * id / swap id. Absent refs are omitted (empty array when there are none).
   */
  private deriveProviderReferences(
    t: TransactionRecord,
  ): AdminTxnProviderReference[] {
    const refs: AdminTxnProviderReference[] = [];
    if (t.onChainTxHash)
      refs.push({ provider: 'tron', reference: t.onChainTxHash });
    if (t.processorTxRef)
      refs.push({ provider: 'flutterwave', reference: t.processorTxRef });

    const providerRef = str(t.metadata.providerRef);
    if (providerRef)
      refs.push({ provider: 'blockradar', reference: providerRef });
    const swapId = str(t.metadata.providerSwapId);
    if (swapId) refs.push({ provider: 'swap', reference: swapId });

    return refs;
  }

  /**
   * Derives a chronological lifecycle timeline from the transaction's non-null
   * timestamps (createdAt→created, executedAt→settling, completedAt→completed,
   * failedAt→failed). Only present timestamps are included; sorted ascending.
   */
  private deriveTimeline(t: TransactionRecord): AdminTxnTimelineEntry[] {
    const candidates: { status: string; at: Date | null }[] = [
      { status: 'created', at: t.createdAt },
      { status: 'settling', at: t.executedAt },
      { status: 'completed', at: t.completedAt },
      { status: 'failed', at: t.failedAt },
    ];

    return candidates
      .filter((c): c is { status: string; at: Date } => c.at !== null)
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((c) => ({ status: c.status, at: c.at.toISOString() }));
  }
}

function toIso(value: Date | null): string | null {
  return value !== null ? value.toISOString() : null;
}

/** Returns the value as a trimmed string when it is a non-empty string, else null. */
function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * The crypto amount for a transaction — buy/sell/send store `cryptoAmount`,
 * deposits store `amount`, swaps store `fromAmount`. Returns null when none set.
 */
function cryptoAmount(meta: Record<string, unknown>): string | null {
  return (
    str(meta.cryptoAmount) ?? str(meta.amount) ?? str(meta.fromAmount) ?? null
  );
}

/**
 * Operator-only internal margin = (effectiveRate − baseRate) × cryptoAmount,
 * computed decimal-safe via BigInt scaling (no float drift). Returns null when
 * any input is missing or non-numeric.
 */
function internalMargin(
  rate: string | null,
  baseRate: string | null,
  amount: string | null,
): string | null {
  if (rate === null || baseRate === null || amount === null) return null;
  const delta = subtractDecimal(rate, baseRate);
  if (delta === null) return null;
  return multiplyDecimal(delta, amount);
}

/** Splits a decimal string into { sign, digits (no dot), scale }; null if invalid. */
function parseDecimal(
  value: string,
): { negative: boolean; digits: bigint; scale: number } | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (m === null) return null;
  const negative = m[1] === '-';
  const frac = m[3] ?? '';
  const digits = BigInt((m[2] + frac).replace(/^0+(?=\d)/, ''));
  return { negative, digits, scale: frac.length };
}

/** Decimal-safe `a - b`; returns a canonical string or null on invalid input. */
function subtractDecimal(a: string, b: string): string | null {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  if (pa === null || pb === null) return null;
  const scale = Math.max(pa.scale, pb.scale);
  const av =
    (pa.negative ? -pa.digits : pa.digits) * 10n ** BigInt(scale - pa.scale);
  const bv =
    (pb.negative ? -pb.digits : pb.digits) * 10n ** BigInt(scale - pb.scale);
  return formatScaled(av - bv, scale);
}

/** Decimal-safe `a * b`; returns a canonical string or null on invalid input. */
function multiplyDecimal(a: string, b: string): string | null {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  if (pa === null || pb === null) return null;
  const sign = pa.negative !== pb.negative ? -1n : 1n;
  const product = sign * pa.digits * pb.digits;
  return formatScaled(product, pa.scale + pb.scale);
}

/** Renders a scaled BigInt (value × 10^-scale) as a canonical decimal string. */
function formatScaled(value: bigint, scale: number): string {
  if (scale === 0) return value.toString();
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(scale + 1, '0');
  const intPart = digits.slice(0, digits.length - scale);
  const fracPart = digits.slice(digits.length - scale).replace(/0+$/, '');
  const body = fracPart === '' ? intPart : `${intPart}.${fracPart}`;
  return negative && body !== '0' ? `-${body}` : body;
}
