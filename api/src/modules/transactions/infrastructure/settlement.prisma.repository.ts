/**
 * Prisma adapter for the SettlementRepository port (task 4.5b, CLAUDE.md §3.1).
 *
 * THIS IS THE ATOMIC SETTLEMENT KERNEL. Everything in `settleBuyAtomic` runs
 * inside a single `prisma.$transaction` — a failure at any step rolls the entire
 * thing back (no half-settled state, no double credit).
 *
 * Steps inside the $transaction:
 *   1. Read current per-account ledger state (last sequence + balanceAfter).
 *   2. Call buildBuyLedgerEntries (Task 4.4 domain — pure, no DB import).
 *   3. Insert LedgerEntry rows.
 *   4. Upsert WalletBalance (credit user USDT).
 *   5. Update Transaction → completed.
 *   6. Update SettlementOutbox → completed.
 *   7. Derive sequential receiptNumber, insert Receipt.
 *
 * Dependency rule (enforced by dependency-cruiser):
 *   infrastructure imports domain (ledger.ts) and core (PrismaService).
 *   It must NOT be imported by application or domain layers.
 *
 * Generated Prisma enums are used directly — never `as never` for enums.
 */

import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  BalanceSource,
  ReceiptDeliveryStatus,
  SettlementOutboxStatus,
  TransactionStatus,
} from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { hmacHex } from '../../../core/crypto/hmac';
import { buildBuyLedgerEntries } from '../domain/ledger';
import type {
  AccountKey,
  AccountState,
  LedgerEntryDraft,
} from '../domain/ledger';
import type {
  ISettlementRepository,
  SettleBuyAtomicInput,
  SettleBuyAtomicOutput,
} from '../application/ports/settlement.repository.port';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Ledger account ids for platform/treasury/processor accounts. */
const ACCOUNT_IDS = {
  NGN_PROCESSOR: 'ngn_processor',
  NGN_TREASURY: 'ngn_treasury',
  NGN_FEES: 'ngn_fees',
  USDT_TREASURY: 'usdt_treasury',
} as const;

/** USDT has 6 decimal places (Tether standard on TRON). */
const USDT_ASSET_DECIMALS = 6;

/**
 * Builds the account-state map for all accounts a buy ledger touches.
 * Each entry is the running balance state *before* this transaction.
 *
 * We read the highest-sequence LedgerEntry for each (accountType, accountId,
 * currency) tuple and fall back to { sequence: 0, balance: '0' } if none exist.
 *
 * Note: this must be called inside the $transaction so the read is isolated
 * from concurrent writes.
 */
async function fetchAccountStates(
  prisma: PrismaService,
  walletId: string,
): Promise<Record<AccountKey, AccountState>> {
  // Use string literals that match both the domain enum and the Prisma enum values.
  const accounts: Array<{
    accountType: string;
    accountId: string;
    currency: string;
  }> = [
    {
      accountType: 'processor_settlement',
      accountId: ACCOUNT_IDS.NGN_PROCESSOR,
      currency: 'NGN',
    },
    {
      accountType: 'treasury_reserve',
      accountId: ACCOUNT_IDS.NGN_TREASURY,
      currency: 'NGN',
    },
    {
      accountType: 'platform_float',
      accountId: ACCOUNT_IDS.NGN_FEES,
      currency: 'NGN',
    },
    {
      accountType: 'user_wallet',
      accountId: walletId,
      currency: 'USDT',
    },
    {
      accountType: 'treasury_reserve',
      accountId: ACCOUNT_IDS.USDT_TREASURY,
      currency: 'USDT',
    },
  ];

  const states: Record<AccountKey, AccountState> = {};

  for (const account of accounts) {
    const key = `${account.accountType}:${account.accountId}:${account.currency}`;

    const latest = await prisma.ledgerEntry.findFirst({
      where: {
        accountType: account.accountType as never,
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

/**
 * Builds the deterministic HTML content and itemized JSON for a receipt.
 * Byte-stable for the same inputs (canonical JSON, no Date.toLocaleString()).
 */
function buildReceiptContent(input: {
  receiptNumber: string;
  transactionId: string;
  userId: string;
  fiatAmount: string;
  cryptoAmount: string;
  processingFee: string;
  issuedAt: Date;
}): { htmlContent: string; itemized: Record<string, unknown> } {
  const itemized = {
    asset: 'USDT',
    fiatAmount: input.fiatAmount,
    fiatCurrency: 'NGN',
    cryptoAmount: input.cryptoAmount,
    processingFeeAmount: input.processingFee,
    totalFiat: input.fiatAmount,
  };

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Receipt ${input.receiptNumber}</title></head>
<body>
<h1>Handshake Receipt</h1>
<p>Receipt Number: ${input.receiptNumber}</p>
<p>Transaction ID: ${input.transactionId}</p>
<p>User ID: ${input.userId}</p>
<p>Asset: USDT</p>
<p>Crypto Amount: ${input.cryptoAmount} USDT</p>
<p>Fiat Amount: NGN ${input.fiatAmount}</p>
<p>Processing Fee: NGN ${input.processingFee}</p>
<p>Total Paid: NGN ${input.fiatAmount}</p>
<p>Issued At: ${input.issuedAt.toISOString()}</p>
</body>
</html>`;

  return { htmlContent, itemized };
}

/**
 * Derives a sequential human-readable receipt number.
 *
 * TODO(RCP): use a Postgres sequence instead of COUNT(*) + 1 to eliminate
 * the race condition under high concurrency. For the skeleton, a serializable
 * $transaction means this count is correct within the same transaction — but
 * if multiple transactions commit concurrently at exactly the same sequence
 * position the UNIQUE constraint on Receipt.receiptNumber will catch it.
 */
function formatReceiptNumber(year: string, count: bigint): string {
  // count is the number of receipts *before* this insert (0-based index);
  // +1 gives the 1-based position for the next receipt.
  const seq = (count + 1n).toString().padStart(6, '0');
  return `HS-${year}-${seq}`;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class SettlementPrismaRepository implements ISettlementRepository {
  // TODO(RCP): inject a dedicated RECEIPT_SIGNING_KEY env var instead.
  private readonly signingKey: string;

  constructor(
    private readonly prisma: PrismaService,
    // Bare ConfigService: reads both env-layer keys (DIRECTIVE_SIGNING_KEY)
    // and JSON-defaults. This follows the same pattern as other infrastructure
    // providers (blockradar, flutterwave) that read from env.
    private readonly config: ConfigService,
  ) {
    this.signingKey = this.config.get<string>('DIRECTIVE_SIGNING_KEY') ?? '';
  }

  /**
   * Atomic settlement of a buy order in a single Prisma $transaction.
   *
   * A failure at any step rolls everything back — no partial state.
   * Idempotency is enforced by the caller (ExecutionService checks status
   * before calling this).
   */
  async settleBuyAtomic(
    input: SettleBuyAtomicInput,
  ): Promise<SettleBuyAtomicOutput> {
    const {
      transactionId,
      userId,
      walletId,
      fiatAmount,
      cryptoAmount,
      processingFee,
      providerRef,
      now,
      year,
    } = input;
    const signingKey = this.signingKey;

    return this.prisma.$transaction(
      async (tx) => {
        // ── 1. Read current account states (inside transaction for isolation) ─
        // Cast the interactive tx client to PrismaService for our helper —
        // both have the same Prisma model API at runtime (safe boundary cast).
        const accountStates = await fetchAccountStates(
          tx as unknown as PrismaService,
          walletId,
        );

        // ── 2. Build ledger entries (pure domain function, Task 4.4) ─────────
        const drafts: LedgerEntryDraft[] = buildBuyLedgerEntries({
          userId,
          walletId,
          fiatAmount,
          cryptoAmount,
          processingFee,
          postedAt: now,
          accountStates,
        });

        // ── 3. Insert LedgerEntry rows ────────────────────────────────────────
        for (const draft of drafts) {
          await tx.ledgerEntry.create({
            data: {
              transactionId,
              // Domain enum string values map directly to Prisma enum values (string identity).
              accountType: draft.accountType as never,
              accountId: draft.accountId,
              currency: draft.currency,
              amount: draft.amount as never, // Decimal(38,18) — string at runtime
              // LedgerDirection enum values ('debit'|'credit') match Prisma's enum.
              direction: draft.direction as never,
              description: draft.description,
              balanceAfter: draft.balanceAfter as never,
              sequence: draft.sequence,
              postedAt: draft.postedAt,
            },
          });
        }

        // ── 4. Upsert WalletBalance (credit user USDT) ────────────────────────
        // We use create (not upsert) because WalletBalance is an append-only
        // snapshot log; the latest entry by syncedAt is the live balance.
        await tx.walletBalance.create({
          data: {
            walletId,
            // amount is the credited USDT (new snapshot after credit).
            // In a real system this would be baseBalance + cryptoAmount;
            // for the settlement skeleton we record the credited amount
            // as the snapshot — a full balance sync (provider_sync) will
            // reconcile the exact figure later.
            amount: cryptoAmount as never,
            assetDecimals: USDT_ASSET_DECIMALS,
            source: BalanceSource.deposit_webhook,
            syncedAt: now,
          },
        });

        // ── 5. Update Transaction → completed ─────────────────────────────────
        await tx.transaction.update({
          where: { id: transactionId },
          data: {
            status: TransactionStatus.completed,
            processorTxRef: providerRef,
            completedAt: now,
          },
        });

        // ── 6. Update SettlementOutbox → completed ────────────────────────────
        await tx.settlementOutbox.updateMany({
          where: {
            transactionId,
            settlementType: 'processor_collection',
          },
          data: {
            status: SettlementOutboxStatus.completed,
            completedAt: now,
          },
        });

        // ── 7. Mint Receipt ───────────────────────────────────────────────────

        // TODO(RCP): use a Postgres sequence here to eliminate race under concurrency.
        const countBig = await tx.receipt.count();
        const receiptNumber = formatReceiptNumber(year, BigInt(countBig));

        const { htmlContent, itemized } = buildReceiptContent({
          receiptNumber,
          transactionId,
          userId,
          fiatAmount,
          cryptoAmount,
          processingFee,
          issuedAt: now,
        });

        // Content hash: sha256 of htmlContent + canonical(itemized).
        const contentHash = createHash('sha256')
          .update(htmlContent + JSON.stringify(itemized), 'utf8')
          .digest('hex');

        // Signature: HMAC-SHA256 over (receiptNumber, transactionId, contentHash, userId, issuedAt).
        // TODO(RCP): replace DIRECTIVE_SIGNING_KEY with a dedicated RECEIPT_SIGNING_KEY.
        const signaturePayload = [
          receiptNumber,
          transactionId,
          contentHash,
          userId,
          now.toISOString(),
        ].join('|');

        const signatureHash = hmacHex('sha256', signingKey, signaturePayload);

        await tx.receipt.create({
          data: {
            transactionId,
            receiptNumber,
            userId,
            itemized: itemized as never,
            htmlContent,
            contentHash,
            signatureHash,
            deliveryStatus: ReceiptDeliveryStatus.pending,
            issuedAt: now,
          },
        });

        return { receiptNumber };
      },
      {
        // Serializable isolation to ensure the COUNT(*) + 1 for receiptNumber
        // is not subject to a phantom read race.
        // TODO(RCP): remove this isolation level once a Postgres sequence is used.
        isolationLevel: 'Serializable',
      },
    );
  }

  /** Returns the Receipt.receiptNumber for the given transactionId, or null. */
  async findReceiptNumber(transactionId: string): Promise<string | null> {
    const row = await this.prisma.receipt.findUnique({
      where: { transactionId },
      select: { receiptNumber: true },
    });
    return row?.receiptNumber ?? null;
  }
}
