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
 *   7. Mint signed Receipt (same atomic tx).
 *
 * Dependency rule (enforced by dependency-cruiser):
 *   infrastructure imports domain (ledger.ts), core (PrismaService, AssetRegistry,
 *   hmacHex), and the application port. It must NOT be imported by application
 *   or domain layers.
 */

import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  BalanceSource,
  DepositStatus,
  LedgerAccountType,
  ReceiptDeliveryStatus,
  TransactionStatus,
  TransactionType,
} from '../../../../generated/prisma/client';
import type { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { hmacHex } from '../../../core/crypto/hmac';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import {
  LedgerAccountType as DomainLedgerAccountType,
  buildDepositLedgerEntries,
} from '../../transactions/domain/ledger';
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
  asset: string,
): Promise<Record<AccountKey, AccountState>> {
  const accounts: Array<{
    accountType: string;
    accountId: string;
    currency: string;
  }> = [
    { accountType: 'user_wallet', accountId: walletId, currency: asset },
    {
      accountType: 'clearing',
      accountId: CLEARING_ACCOUNT_ID,
      currency: asset,
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

/**
 * Builds the deterministic HTML content and itemized JSON for a deposit receipt.
 * Byte-stable for the same inputs (canonical JSON, no Date.toLocaleString()).
 */
function buildDepositReceiptContent(input: {
  receiptNumber: string;
  transactionId: string;
  userId: string;
  asset: string;
  amount: string;
  txHash: string;
  issuedAt: Date;
}): { htmlContent: string; itemized: Record<string, unknown> } {
  const itemized = {
    asset: input.asset,
    amount: input.amount,
    type: 'deposit',
    txHash: input.txHash,
  };

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Receipt ${input.receiptNumber}</title></head>
<body>
<h1>Handshake Deposit Receipt</h1>
<p>Receipt Number: ${input.receiptNumber}</p>
<p>Transaction ID: ${input.transactionId}</p>
<p>User ID: ${input.userId}</p>
<p>Asset: ${input.asset}</p>
<p>Amount Deposited: ${input.amount} ${input.asset}</p>
<p>On-Chain Tx Hash: ${input.txHash}</p>
<p>Type: deposit</p>
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
export class DepositSettlementPrismaRepository implements IDepositSettlementRepository {
  private readonly signingKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly assetRegistry: AssetRegistry,
  ) {
    this.signingKey = this.config.get<string>('DIRECTIVE_SIGNING_KEY') ?? '';
  }

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
      userId,
      cryptoAmount,
      asset,
      txHash,
      sourceAddress,
      providerWebhookId,
      postedAt,
    } = input;

    // Look up decimals from AssetRegistry — never hardcode.
    const assetMeta = this.assetRegistry.asset(asset);
    const assetDecimals = assetMeta.decimals;

    const signingKey = this.signingKey;
    const year = postedAt.getFullYear().toString();

    return this.prisma.$transaction(
      async (tx) => {
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
          asset,
        );

        // ── 3. Build ledger entries (pure domain function) ────────────────────
        const drafts: LedgerEntryDraft[] = buildDepositLedgerEntries({
          walletId,
          cryptoAmount,
          postedAt,
          accountStates,
        });

        // ── 4. Create anchor Transaction (type=deposit, status=completed) ─────
        // LedgerEntry requires a transactionId FK. Deposits do not follow the
        // Proposal → Transaction flow, so we create a minimal anchor Transaction.
        // type:'deposit' correctly classifies this for reconciliation.
        const depositTxn = await tx.transaction.create({
          data: {
            userId,
            type: TransactionType.deposit,
            status: TransactionStatus.completed,
            idempotencyKey: randomUUID(),
            requestChecksum: txHash,
            metadata: {
              depositTxHash: txHash,
              asset,
              amount: cryptoAmount,
              sourceAddress: sourceAddress ?? null,
            },
            completedAt: postedAt,
          },
          select: { id: true },
        });

        // ── 5. Insert LedgerEntry rows ────────────────────────────────────────
        // Extract the user_wallet ledger entry to capture balanceAfter (running balance).
        let userWalletBalanceAfter: string = cryptoAmount;

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

          // Capture the running balance from the user_wallet credit entry.
          if (
            draft.accountType === DomainLedgerAccountType.user_wallet &&
            draft.accountId === walletId
          ) {
            userWalletBalanceAfter = draft.balanceAfter;
          }
        }

        // ── 6. Create WalletBalance snapshot ─────────────────────────────────
        await tx.walletBalance.create({
          data: {
            walletId,
            amount: cryptoAmount as unknown as Prisma.Decimal,
            assetDecimals,
            source: BalanceSource.deposit_webhook,
            syncedAt: postedAt,
          },
        });

        // ── 7. Insert DepositConfirmation ─────────────────────────────────────
        await tx.depositConfirmation.create({
          data: {
            walletId,
            txHash,
            amount: cryptoAmount as unknown as Prisma.Decimal,
            assetDecimals,
            sourceAddress: sourceAddress ?? null,
            status: DepositStatus.confirmed,
            confirmedAt: postedAt,
            webhookId: providerWebhookId ?? null,
          },
        });

        // ── 8. Mint signed Receipt ────────────────────────────────────────────
        // TODO(RCP): use a Postgres sequence instead of COUNT(*)+1.
        const countBig = await tx.receipt.count();
        const receiptNumber = formatReceiptNumber(year, BigInt(countBig));

        const { htmlContent, itemized } = buildDepositReceiptContent({
          receiptNumber,
          transactionId: depositTxn.id,
          userId,
          asset,
          amount: cryptoAmount,
          txHash,
          issuedAt: postedAt,
        });

        // Content hash: sha256 of htmlContent + canonical(itemized).
        const contentHash = createHash('sha256')
          .update(htmlContent + JSON.stringify(itemized), 'utf8')
          .digest('hex');

        // Signature: HMAC-SHA256 over (receiptNumber, transactionId, contentHash, userId, issuedAt).
        const signaturePayload = [
          receiptNumber,
          depositTxn.id,
          contentHash,
          userId,
          postedAt.toISOString(),
        ].join('|');

        const signatureHash = hmacHex('sha256', signingKey, signaturePayload);

        await tx.receipt.create({
          data: {
            transactionId: depositTxn.id,
            receiptNumber,
            userId,
            itemized: itemized as unknown as Prisma.InputJsonValue,
            htmlContent,
            contentHash,
            signatureHash,
            deliveryStatus: ReceiptDeliveryStatus.pending,
            issuedAt: postedAt,
          },
        });

        return {
          deposited: true,
          newBalance: userWalletBalanceAfter,
          receiptNumber,
        };
      },
      {
        // Serializable isolation to ensure the COUNT(*) + 1 for receiptNumber
        // is not subject to a phantom read race.
        // TODO(RCP): remove once a Postgres sequence is used.
        isolationLevel: 'Serializable',
      },
    );
  }
}
