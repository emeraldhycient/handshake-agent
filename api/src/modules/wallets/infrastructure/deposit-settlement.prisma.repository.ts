/**
 * Prisma adapter for the DepositSettlementRepository port (R2, CLAUDE.md §3.1).
 *
 * THIS IS THE ATOMIC DEPOSIT SETTLEMENT KERNEL. Everything in
 * `settleDepositAtomic` runs inside a single `prisma.$transaction` — a failure
 * at any step rolls the entire thing back (no half-settled state, no double
 * credit).
 *
 * Steps inside the $transaction:
 *   1. Check DepositConfirmation(txHash) → if exists, return { deposited:false }.
 *   2. Read current per-account ledger state (inside tx for isolation).
 *   3. Call buildDepositLedgerEntries (domain — pure, no DB import).
 *   4. Insert LedgerEntry rows.
 *   5. Create WalletBalance snapshot (credit user USDT).
 *   6. Insert DepositConfirmation(txHash, status=confirmed).
 *
 * Dependency rule (enforced by dependency-cruiser):
 *   infrastructure imports domain (ledger.ts) and core (PrismaService).
 *   It must NOT be imported by application or domain layers.
 */

import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  BalanceSource,
  DepositStatus,
  LedgerAccountType,
} from '../../../../generated/prisma/client';
import type { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { buildDepositLedgerEntries } from '../../transactions/domain/ledger';
import type {
  AccountKey,
  AccountState,
  LedgerEntryDraft,
} from '../../transactions/domain/ledger';
import type {
  IDepositSettlementRepository,
  SettleDepositAtomicInput,
  SettleDepositAtomicOutput,
} from '../application/ports/deposit-settlement.repository.port';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** USDT has 6 decimal places (Tether standard on TRON). */
const USDT_ASSET_DECIMALS = 6;

/**
 * Account ids for the deposit's double-entry ledger:
 *  + user_wallet / walletId / USDT     — user receives
 *  − clearing / usdt_external_deposits / USDT  — contra clearing
 */
const CLEARING_ACCOUNT_ID = 'usdt_external_deposits';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reads the pre-transaction state for the two accounts that buildDepositLedgerEntries
 * touches: the user wallet and the clearing contra account.
 *
 * Must be called inside a `$transaction` so the read is isolated from concurrent writes.
 */
async function fetchDepositAccountStates(
  prisma: PrismaService,
  walletId: string,
): Promise<Record<AccountKey, AccountState>> {
  const accounts: Array<{
    accountType: string;
    accountId: string;
    currency: string;
  }> = [
    { accountType: 'user_wallet', accountId: walletId, currency: 'USDT' },
    {
      accountType: 'clearing',
      accountId: CLEARING_ACCOUNT_ID,
      currency: 'USDT',
    },
  ];

  const states: Record<AccountKey, AccountState> = {};

  for (const account of accounts) {
    const key = `${account.accountType}:${account.accountId}:${account.currency}`;

    const latest = await prisma.ledgerEntry.findFirst({
      where: {
        accountType: account.accountType as LedgerAccountType,
        accountId: account.accountId,
        currency: account.currency,
      },
      orderBy: { sequence: 'desc' },
      select: { sequence: true, balanceAfter: true },
    });

    states[key] = {
      sequence: latest?.sequence ?? 0,
      balance: latest?.balanceAfter
        ? (latest.balanceAfter as { toString(): string }).toString()
        : '0',
    };
  }

  return states;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class DepositSettlementPrismaRepository implements IDepositSettlementRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomic deposit settlement in a single Prisma $transaction.
   *
   * Idempotent: if a DepositConfirmation already exists for txHash, returns
   * `{ deposited: false }` without writing anything (no double-credit).
   */
  async settleDepositAtomic(
    input: SettleDepositAtomicInput,
  ): Promise<SettleDepositAtomicOutput> {
    const {
      walletId,
      cryptoAmount,
      txHash,
      sourceAddress,
      providerWebhookId,
      postedAt,
    } = input;

    return this.prisma.$transaction(async (tx) => {
      // ── 1. Idempotency check ─────────────────────────────────────────────
      const existing = await tx.depositConfirmation.findUnique({
        where: { txHash },
        select: { id: true },
      });

      if (existing !== null) {
        return { deposited: false };
      }

      // ── 2. Read current account states (inside tx for isolation) ─────────
      const accountStates = await fetchDepositAccountStates(
        tx as unknown as PrismaService,
        walletId,
      );

      // ── 3. Build ledger entries (pure domain function) ────────────────────
      const drafts: LedgerEntryDraft[] = buildDepositLedgerEntries({
        walletId,
        cryptoAmount,
        postedAt,
        accountStates,
      });

      // ── 4. Insert LedgerEntry rows ────────────────────────────────────────
      // LedgerEntry requires a transactionId FK. Deposits do not follow the
      // Proposal → Transaction flow, so we create a minimal internal Transaction
      // record to anchor the ledger entries.
      //
      // Design note: the Receipt model is Transaction-bound; a signed Receipt
      // DB row for deposits is deferred (see report §Notes). The
      // DepositConfirmation row is the canonical deposit record.
      // idempotencyKey must be a UUID — we generate one here (safe: the
      // DepositConfirmation dedup check above means this branch is never
      // re-entered for the same txHash).
      const depositTxn = await tx.transaction.create({
        data: {
          userId: input.userId,
          type: 'reward', // closest available type; deposit TransactionType is a follow-up
          status: 'completed',
          idempotencyKey: randomUUID(),
          requestChecksum: txHash,
          metadata: {
            depositTxHash: txHash,
            asset: input.asset,
            amount: cryptoAmount,
            sourceAddress: sourceAddress ?? null,
          },
          completedAt: postedAt,
        },
        select: { id: true },
      });

      for (const draft of drafts) {
        await tx.ledgerEntry.create({
          data: {
            transactionId: depositTxn.id,
            accountType: draft.accountType,
            accountId: draft.accountId,
            currency: draft.currency,
            amount: draft.amount as unknown as Prisma.Decimal,
            direction: draft.direction,
            description: draft.description,
            balanceAfter: draft.balanceAfter as unknown as Prisma.Decimal,
            sequence: draft.sequence,
            postedAt: draft.postedAt,
          },
        });
      }

      // ── 5. Create WalletBalance snapshot ─────────────────────────────────
      await tx.walletBalance.create({
        data: {
          walletId,
          amount: cryptoAmount as unknown as Prisma.Decimal,
          assetDecimals: USDT_ASSET_DECIMALS,
          source: BalanceSource.deposit_webhook,
          syncedAt: postedAt,
        },
      });

      // ── 6. Insert DepositConfirmation ────────────────────────────────────
      await tx.depositConfirmation.create({
        data: {
          walletId,
          txHash,
          amount: cryptoAmount as unknown as Prisma.Decimal,
          assetDecimals: USDT_ASSET_DECIMALS,
          sourceAddress: sourceAddress ?? null,
          status: DepositStatus.confirmed,
          confirmedAt: postedAt,
          webhookId: providerWebhookId ?? null,
        },
      });

      return { deposited: true, newBalance: cryptoAmount };
    });
  }
}
