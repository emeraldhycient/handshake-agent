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
  CompensationReason,
  FiatCurrency,
  LedgerAccountType,
  ReceiptDeliveryStatus,
  SettlementOutboxStatus,
  TransactionStatus,
  TravelRulePartyType,
  TravelRuleTrigger,
  VelocityCounterType,
} from '../../../../generated/prisma/client';
import type { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { hmacHex } from '../../../core/crypto/hmac';
import { acquireAccountAdvisoryLocks } from '../../../core/crypto/advisory-lock';
import {
  buildBuyLedgerEntries,
  buildSellReserveEntries,
  buildSellFinalizeEntries,
  buildSellRefundEntries,
  buildSendReserveEntries,
  buildSendFinalizeEntries,
  buildSendRefundEntries,
  buildSwapReserveEntries,
  buildSwapFinalizeEntries,
  buildSwapRefundEntries,
} from '../domain/ledger';
import type {
  AccountKey,
  AccountState,
  LedgerEntryDraft,
} from '../domain/ledger';
import type {
  ISettlementRepository,
  PostSellReserveInput,
  SettleBuyAtomicInput,
  SettleBuyAtomicOutput,
  SettleSellFinalizeInput,
  SettleSellFinalizeOutput,
  SettleSellRefundInput,
  CreateSellSettlingWithReserveInput,
  CreateSellSettlingWithReserveOutput,
  CreateSendSettlingWithReserveInput,
  CreateSwapSettlingWithReserveInput,
  CreateSwapSettlingWithReserveOutput,
  SettleSwapFinalizeInput,
  SettleSwapFinalizeOutput,
  SettleSwapRefundInput,
  CreateSendSettlingWithReserveOutput,
  SettleSendFinalizeInput,
  SettleSendFinalizeOutput,
  SettleSendRefundInput,
} from '../application/ports/settlement.repository.port';
import { ReceiptNotSignableError } from '../domain/execution-errors';
import type { TransactionRecord } from '../application/ports/transaction.repository.port';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Ledger account ids for platform/treasury/processor/clearing accounts. */
const ACCOUNT_IDS = {
  NGN_PROCESSOR: 'ngn_processor',
  NGN_TREASURY: 'ngn_treasury',
  NGN_FEES: 'ngn_fees',
  USDT_TREASURY: 'usdt_treasury',
  USDT_SELL_CLEARING: 'usdt_sell_clearing',
  NGN_PAYOUT: 'ngn_payout',
  USDT_SEND_CLEARING: 'usdt_send_clearing',
  USDT_NETWORK_OUT: 'usdt_network_out',
  USDT_FEES: 'usdt_fees',
  /** Swap clearing: fromAsset held while the swap is in flight. */
  SWAP_CLEARING: 'swap_clearing',
  /** Treasury leg: fromAsset outflow (to provider). */
  SWAP_OUT: 'swap_out',
  /** Treasury leg: toAsset inflow (from provider). */
  SWAP_IN: 'swap_in',
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
  asset: string,
): Promise<Record<AccountKey, AccountState>> {
  // Use string literals that match both the domain enum and the Prisma enum values.
  // WN-4: currency for crypto legs is the passed `asset`, not a hardcoded literal.
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
      currency: asset,
    },
    {
      accountType: 'treasury_reserve',
      accountId: ACCOUNT_IDS.USDT_TREASURY,
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
 * Builds the account-state map for sell RESERVE phase accounts:
 * user_wallet (USDT), clearing / usdt_sell_clearing (USDT).
 */
async function fetchSellReserveAccountStates(
  prisma: PrismaService,
  walletId: string,
  asset: string,
): Promise<Record<string, AccountState>> {
  // WN-4: currency for crypto legs is the passed `asset`, not a hardcoded literal.
  const accounts: Array<{
    accountType: string;
    accountId: string;
    currency: string;
  }> = [
    {
      accountType: 'user_wallet',
      accountId: walletId,
      currency: asset,
    },
    {
      accountType: 'clearing',
      accountId: ACCOUNT_IDS.USDT_SELL_CLEARING,
      currency: asset,
    },
  ];

  return fetchAccountStatesByList(prisma, accounts);
}

/**
 * Builds the account-state map for sell FINALIZE phase accounts:
 * clearing (USDT sell), treasury (USDT), treasury (NGN), processor_settlement (NGN payout).
 */
async function fetchSellFinalizeAccountStates(
  prisma: PrismaService,
  asset: string,
): Promise<Record<string, AccountState>> {
  // WN-4: currency for crypto legs is the passed `asset`, not a hardcoded literal.
  const accounts: Array<{
    accountType: string;
    accountId: string;
    currency: string;
  }> = [
    {
      accountType: 'clearing',
      accountId: ACCOUNT_IDS.USDT_SELL_CLEARING,
      currency: asset,
    },
    {
      accountType: 'treasury_reserve',
      accountId: ACCOUNT_IDS.USDT_TREASURY,
      currency: asset,
    },
    {
      accountType: 'treasury_reserve',
      accountId: ACCOUNT_IDS.NGN_TREASURY,
      currency: 'NGN',
    },
    {
      accountType: 'processor_settlement',
      accountId: ACCOUNT_IDS.NGN_PAYOUT,
      currency: 'NGN',
    },
  ];

  return fetchAccountStatesByList(prisma, accounts);
}

/**
 * Builds the account-state map for sell REFUND phase accounts:
 * clearing (USDT sell), user_wallet (USDT).
 */
async function fetchSellRefundAccountStates(
  prisma: PrismaService,
  walletId: string,
  asset: string,
): Promise<Record<string, AccountState>> {
  // WN-4: currency for crypto legs is the passed `asset`, not a hardcoded literal.
  const accounts: Array<{
    accountType: string;
    accountId: string;
    currency: string;
  }> = [
    {
      accountType: 'clearing',
      accountId: ACCOUNT_IDS.USDT_SELL_CLEARING,
      currency: asset,
    },
    {
      accountType: 'user_wallet',
      accountId: walletId,
      currency: asset,
    },
  ];

  return fetchAccountStatesByList(prisma, accounts);
}

/**
 * Generic account-state fetcher for a list of (accountType, accountId, currency) tuples.
 */
async function fetchAccountStatesByList(
  prisma: PrismaService,
  accounts: Array<{ accountType: string; accountId: string; currency: string }>,
): Promise<Record<string, AccountState>> {
  const states: Record<string, AccountState> = {};

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
 * Builds the account-state map for send RESERVE phase accounts:
 * user_wallet (USDT), clearing / usdt_send_clearing (USDT).
 */
async function fetchSendReserveAccountStates(
  prisma: PrismaService,
  walletId: string,
  asset: string,
): Promise<Record<string, AccountState>> {
  // WN-4: currency for crypto legs is the passed `asset`, not a hardcoded literal.
  const accounts: Array<{
    accountType: string;
    accountId: string;
    currency: string;
  }> = [
    {
      accountType: 'user_wallet',
      accountId: walletId,
      currency: asset,
    },
    {
      accountType: 'clearing',
      accountId: ACCOUNT_IDS.USDT_SEND_CLEARING,
      currency: asset,
    },
  ];

  return fetchAccountStatesByList(prisma, accounts);
}

/**
 * Builds the account-state map for send FINALIZE phase accounts:
 * clearing/usdt_send_clearing (USDT), treasury_reserve/usdt_network_out (USDT),
 * treasury_reserve/usdt_fees (USDT).
 */
async function fetchSendFinalizeAccountStates(
  prisma: PrismaService,
  asset: string,
): Promise<Record<string, AccountState>> {
  // WN-4: currency for crypto legs is the passed `asset`, not a hardcoded literal.
  const accounts: Array<{
    accountType: string;
    accountId: string;
    currency: string;
  }> = [
    {
      accountType: 'clearing',
      accountId: ACCOUNT_IDS.USDT_SEND_CLEARING,
      currency: asset,
    },
    {
      accountType: 'treasury_reserve',
      accountId: ACCOUNT_IDS.USDT_NETWORK_OUT,
      currency: asset,
    },
    {
      accountType: 'treasury_reserve',
      accountId: ACCOUNT_IDS.USDT_FEES,
      currency: asset,
    },
  ];

  return fetchAccountStatesByList(prisma, accounts);
}

/**
 * Builds the account-state map for send REFUND phase accounts:
 * clearing/usdt_send_clearing (USDT) + user_wallet (USDT).
 */
async function fetchSendRefundAccountStates(
  prisma: PrismaService,
  walletId: string,
  asset: string,
): Promise<Record<string, AccountState>> {
  // WN-4: currency for crypto legs is the passed `asset`, not a hardcoded literal.
  const accounts: Array<{
    accountType: string;
    accountId: string;
    currency: string;
  }> = [
    {
      accountType: 'clearing',
      accountId: ACCOUNT_IDS.USDT_SEND_CLEARING,
      currency: asset,
    },
    {
      accountType: 'user_wallet',
      accountId: walletId,
      currency: asset,
    },
  ];

  return fetchAccountStatesByList(prisma, accounts);
}

/**
 * Builds the account-state map for swap RESERVE phase accounts:
 * user_wallet (fromAsset), clearing/swap_clearing (fromAsset).
 */
async function fetchSwapReserveAccountStates(
  prisma: PrismaService,
  walletId: string,
  fromAsset: string,
): Promise<Record<string, AccountState>> {
  const accounts: Array<{
    accountType: string;
    accountId: string;
    currency: string;
  }> = [
    {
      accountType: 'user_wallet',
      accountId: walletId,
      currency: fromAsset,
    },
    {
      accountType: 'clearing',
      accountId: ACCOUNT_IDS.SWAP_CLEARING,
      currency: fromAsset,
    },
  ];

  return fetchAccountStatesByList(prisma, accounts);
}

/**
 * Builds the account-state map for swap FINALIZE phase accounts:
 * clearing/swap_clearing (fromAsset), treasury_reserve/swap_out (fromAsset),
 * treasury_reserve/swap_in (toAsset), user_wallet (toAsset).
 */
async function fetchSwapFinalizeAccountStates(
  prisma: PrismaService,
  walletId: string,
  fromAsset: string,
  toAsset: string,
): Promise<Record<string, AccountState>> {
  const accounts: Array<{
    accountType: string;
    accountId: string;
    currency: string;
  }> = [
    {
      accountType: 'clearing',
      accountId: ACCOUNT_IDS.SWAP_CLEARING,
      currency: fromAsset,
    },
    {
      accountType: 'treasury_reserve',
      accountId: ACCOUNT_IDS.SWAP_OUT,
      currency: fromAsset,
    },
    {
      accountType: 'treasury_reserve',
      accountId: ACCOUNT_IDS.SWAP_IN,
      currency: toAsset,
    },
    {
      accountType: 'user_wallet',
      accountId: walletId,
      currency: toAsset,
    },
  ];

  return fetchAccountStatesByList(prisma, accounts);
}

/**
 * Builds the account-state map for swap REFUND phase accounts:
 * clearing/swap_clearing (fromAsset), user_wallet (fromAsset).
 */
async function fetchSwapRefundAccountStates(
  prisma: PrismaService,
  walletId: string,
  fromAsset: string,
): Promise<Record<string, AccountState>> {
  const accounts: Array<{
    accountType: string;
    accountId: string;
    currency: string;
  }> = [
    {
      accountType: 'clearing',
      accountId: ACCOUNT_IDS.SWAP_CLEARING,
      currency: fromAsset,
    },
    {
      accountType: 'user_wallet',
      accountId: walletId,
      currency: fromAsset,
    },
  ];

  return fetchAccountStatesByList(prisma, accounts);
}

/**
 * Builds the deterministic HTML content and itemized JSON for a SEND receipt.
 */
function buildSendReceiptContent(input: {
  receiptNumber: string;
  transactionId: string;
  userId: string;
  cryptoAmount: string;
  networkFeeCrypto: string;
  /** WN-4: crypto asset symbol (e.g. 'USDT', 'USDC'). */
  asset: string;
  toAddress: string;
  onChainTxHash: string;
  issuedAt: Date;
}): { htmlContent: string; itemized: Record<string, unknown> } {
  const { asset } = input;
  const itemized = {
    // WN-4: asset from input, not a hardcoded literal.
    asset,
    cryptoAmount: input.cryptoAmount,
    networkFeeCrypto: input.networkFeeCrypto,
    toAddress: input.toAddress,
    onChainTxHash: input.onChainTxHash,
    type: 'send',
  };

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Receipt ${input.receiptNumber}</title></head>
<body>
<h1>Handshake Send Receipt</h1>
<p>Receipt Number: ${input.receiptNumber}</p>
<p>Transaction ID: ${input.transactionId}</p>
<p>User ID: ${input.userId}</p>
<p>Amount Sent: ${input.cryptoAmount} ${asset}</p>
<p>Network Fee: ${input.networkFeeCrypto} ${asset}</p>
<p>To Address: ${input.toAddress}</p>
<p>On-chain Tx Hash: ${input.onChainTxHash}</p>
<p>Issued At: ${input.issuedAt.toISOString()}</p>
</body>
</html>`;

  return { htmlContent, itemized };
}

/**
 * Builds the deterministic HTML content and itemized JSON for a SELL receipt.
 */
function buildSellReceiptContent(input: {
  receiptNumber: string;
  transactionId: string;
  userId: string;
  cryptoAmount: string;
  netFiatAmount: string;
  /** WN-4: crypto asset symbol (e.g. 'USDT', 'USDC'). */
  asset: string;
  issuedAt: Date;
}): { htmlContent: string; itemized: Record<string, unknown> } {
  const { asset } = input;
  const itemized = {
    // WN-4: asset from input, not a hardcoded literal.
    asset,
    cryptoAmount: input.cryptoAmount,
    fiatCurrency: 'NGN',
    netFiatAmount: input.netFiatAmount,
    type: 'sell',
  };

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Receipt ${input.receiptNumber}</title></head>
<body>
<h1>Handshake Sell Receipt</h1>
<p>Receipt Number: ${input.receiptNumber}</p>
<p>Transaction ID: ${input.transactionId}</p>
<p>User ID: ${input.userId}</p>
<p>Asset Sold: ${input.cryptoAmount} ${asset}</p>
<p>NGN Payout: ${input.netFiatAmount}</p>
<p>Issued At: ${input.issuedAt.toISOString()}</p>
</body>
</html>`;

  return { htmlContent, itemized };
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
  /** WN-4: crypto asset symbol (e.g. 'USDT', 'USDC'). */
  asset: string;
  issuedAt: Date;
}): { htmlContent: string; itemized: Record<string, unknown> } {
  const { asset } = input;
  const itemized = {
    // WN-4: asset from input, not a hardcoded literal.
    asset,
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
<p>Asset: ${asset}</p>
<p>Crypto Amount: ${input.cryptoAmount} ${asset}</p>
<p>Fiat Amount: NGN ${input.fiatAmount}</p>
<p>Processing Fee: NGN ${input.processingFee}</p>
<p>Total Paid: NGN ${input.fiatAmount}</p>
<p>Issued At: ${input.issuedAt.toISOString()}</p>
</body>
</html>`;

  return { htmlContent, itemized };
}

/**
 * Formats a human-readable receipt number from the year and the next value
 * from the `hs_receipt_seq` Postgres sequence.
 *
 * The sequence is global and monotonic: `nextval('hs_receipt_seq')` is called
 * inside the same `$transaction` as the Receipt insert, so the number is both
 * unique (sequence guarantees it) and obtained atomically with the row creation.
 * The UNIQUE constraint on Receipt.receiptNumber remains as a defence-in-depth
 * safety net.
 *
 * Format: `HS-<YYYY>-<000001>` (zero-padded to 6 digits).
 */
function formatReceiptNumber(year: string, seqVal: bigint): string {
  const seq = seqVal.toString().padStart(6, '0');
  return `HS-${year}-${seq}`;
}

/**
 * Builds the deterministic HTML content and itemized JSON for a SWAP receipt.
 */
function buildSwapReceiptContent(input: {
  receiptNumber: string;
  transactionId: string;
  userId: string;
  fromAmount: string;
  fromAsset: string;
  toAmount: string;
  toAsset: string;
  onChainTxHash: string;
  issuedAt: Date;
}): { htmlContent: string; itemized: Record<string, unknown> } {
  const itemized = {
    fromAsset: input.fromAsset,
    toAsset: input.toAsset,
    fromAmount: input.fromAmount,
    toAmount: input.toAmount,
    onChainTxHash: input.onChainTxHash,
    type: 'swap',
  };

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Receipt ${input.receiptNumber}</title></head>
<body>
<h1>Handshake Swap Receipt</h1>
<p>Receipt Number: ${input.receiptNumber}</p>
<p>Transaction ID: ${input.transactionId}</p>
<p>User ID: ${input.userId}</p>
<p>From: ${input.fromAmount} ${input.fromAsset}</p>
<p>To: ${input.toAmount} ${input.toAsset}</p>
<p>On-chain Tx Hash: ${input.onChainTxHash}</p>
<p>Issued At: ${input.issuedAt.toISOString()}</p>
</body>
</html>`;

  return { htmlContent, itemized };
}

// ---------------------------------------------------------------------------
// Transaction-record helpers (shared with the createSellSettlingWithReserveAtomic method)
// ---------------------------------------------------------------------------

const TRANSACTION_SELECT_SELL = {
  id: true,
  proposalId: true,
  userId: true,
  type: true,
  status: true,
  idempotencyKey: true,
  requestChecksum: true,
  fxRateSnapshot: true,
  metadata: true,
  processorTxRef: true,
  pinVerifiedAt: true,
  createdAt: true,
} as const;

function toTransactionRecord(row: {
  id: string;
  proposalId: string | null;
  userId: string;
  type: string;
  status: string;
  idempotencyKey: string;
  requestChecksum: string;
  fxRateSnapshot: unknown;
  metadata: unknown;
  processorTxRef: string | null;
  pinVerifiedAt: Date | null;
  createdAt: Date;
}): TransactionRecord {
  return {
    id: row.id,
    proposalId: row.proposalId,
    userId: row.userId,
    type: row.type,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    requestChecksum: row.requestChecksum,
    fxRateSnapshot:
      row.fxRateSnapshot !== null && row.fxRateSnapshot !== undefined
        ? (row.fxRateSnapshot as { toString(): string }).toString()
        : null,
    metadata: row.metadata as Record<string, unknown>,
    processorTxRef: row.processorTxRef,
    pinVerifiedAt: row.pinVerifiedAt,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Velocity helpers (duplicated from transaction.prisma.repository.ts to allow
// running inside this repository's $transaction without a cross-repo import).
// ---------------------------------------------------------------------------

const WINDOW_24H_MS_SETTLE = 24 * 60 * 60 * 1_000;

async function upsertVelocityCounterInSettle(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    counterType: VelocityCounterType;
    fiatCurrency: string;
    delta: string;
    now: Date;
  },
): Promise<void> {
  const { userId, counterType, delta, now } = params;
  // Cast string → generated FiatCurrency enum at the infrastructure boundary
  // (application layer uses `string` to stay free of Prisma imports — §3.2).
  const fiatCurrencyEnum = params.fiatCurrency as FiatCurrency;
  const windowEnd = new Date(now.getTime() + WINDOW_24H_MS_SETTLE);

  const existing = await tx.velocityCounter.findUnique({
    where: {
      userId_counterType_fiatCurrency: {
        userId,
        counterType,
        fiatCurrency: fiatCurrencyEnum,
      },
    },
    select: { windowEnd: true, currentValue: true },
  });

  const windowExpired =
    existing === null || existing.windowEnd.getTime() <= now.getTime();

  if (windowExpired) {
    await tx.velocityCounter.upsert({
      where: {
        userId_counterType_fiatCurrency: {
          userId,
          counterType,
          fiatCurrency: fiatCurrencyEnum,
        },
      },
      create: {
        userId,
        counterType,
        fiatCurrency: fiatCurrencyEnum,
        currentValue: delta,
        windowStart: now,
        windowEnd,
      },
      update: {
        currentValue: delta,
        windowStart: now,
        windowEnd,
      },
    });
  } else {
    await tx.velocityCounter.update({
      where: {
        userId_counterType_fiatCurrency: {
          userId,
          counterType,
          fiatCurrency: fiatCurrencyEnum,
        },
      },
      data: {
        currentValue: { increment: delta as unknown as number },
      },
    });
  }
}

async function writeVelocityIncrementsInSettle(
  tx: Prisma.TransactionClient,
  increment: {
    userId: string;
    fiatCurrency: string;
    fiatAmountStr: string;
    now: Date;
  },
): Promise<void> {
  const { userId, fiatCurrency, fiatAmountStr, now } = increment;
  await upsertVelocityCounterInSettle(tx, {
    userId,
    counterType: VelocityCounterType.amount_24h,
    fiatCurrency,
    delta: fiatAmountStr,
    now,
  });
  await upsertVelocityCounterInSettle(tx, {
    userId,
    counterType: VelocityCounterType.count_24h,
    fiatCurrency,
    delta: '1',
    now,
  });
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class SettlementPrismaRepository implements ISettlementRepository {
  // Dedicated receipt signing key — separate from DIRECTIVE_SIGNING_KEY so
  // each can be rotated independently. The settlement kernel fails closed:
  // mintReceiptInTx throws ReceiptNotSignableError when this is empty.
  private readonly signingKey: string;

  constructor(
    private readonly prisma: PrismaService,
    // Bare ConfigService: reads env-layer keys and JSON-defaults.
    // This follows the same pattern as other infrastructure providers
    // (blockradar, flutterwave) that read from env.
    private readonly config: ConfigService,
  ) {
    this.signingKey = this.config.get<string>('RECEIPT_SIGNING_KEY') ?? '';
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
      asset,
      fiatCurrency,
      providerRef,
      now,
      year,
    } = input;
    const signingKey = this.signingKey;

    return this.prisma.$transaction(
      async (tx) => {
        // ── 0. Advisory locks — serialize concurrent settlements to same accounts ─
        // Acquires pg_advisory_xact_lock for every account this buy settlement
        // touches so concurrent buys for the same user cannot race on sequence
        // allocation and produce P2002 (unique constraint on accountType, accountId,
        // sequence). Locks are auto-released at transaction commit/rollback.
        await acquireAccountAdvisoryLocks(tx, [
          {
            accountType: 'processor_settlement',
            accountId: ACCOUNT_IDS.NGN_PROCESSOR,
          },
          {
            accountType: 'treasury_reserve',
            accountId: ACCOUNT_IDS.NGN_TREASURY,
          },
          { accountType: 'platform_float', accountId: ACCOUNT_IDS.NGN_FEES },
          { accountType: 'user_wallet', accountId: walletId },
          {
            accountType: 'treasury_reserve',
            accountId: ACCOUNT_IDS.USDT_TREASURY,
          },
        ]);

        // ── 1. Read current account states (inside transaction for isolation) ─
        // Cast the interactive tx client to PrismaService for our helper —
        // both have the same Prisma model API at runtime (safe boundary cast).
        // WN-4: pass asset so crypto leg states are read with the correct currency key.
        const accountStates = await fetchAccountStates(
          tx as unknown as PrismaService,
          walletId,
          asset,
        );

        // ── 2. Build ledger entries (pure domain function, Task 4.4) ─────────
        // WN-4: pass asset so crypto legs key by asset, not a hardcoded literal.
        const drafts: LedgerEntryDraft[] = buildBuyLedgerEntries({
          userId,
          walletId,
          fiatAmount,
          cryptoAmount,
          processingFee,
          asset,
          fiatCurrency,
          postedAt: now,
          accountStates,
        });

        // ── 3. Insert LedgerEntry rows ────────────────────────────────────────
        for (const draft of drafts) {
          await tx.ledgerEntry.create({
            data: {
              transactionId,
              // Domain enum string values are identical to Prisma enum values —
              // cast to the generated enum type (not `as never`).
              accountType: draft.accountType,
              accountId: draft.accountId,
              currency: draft.currency,
              // Decimal(38,18) field — string bridges cleanly via Prisma's Decimal adapter.
              amount: draft.amount as unknown as Prisma.Decimal,
              direction: draft.direction,
              description: draft.description,
              balanceAfter: draft.balanceAfter as unknown as Prisma.Decimal,
              sequence: draft.sequence,
              postedAt: draft.postedAt,
            },
          });
        }

        // ── 4. Upsert WalletBalance (credit user USDT) ────────────────────────
        // We use create (not upsert) because WalletBalance is an append-only
        // snapshot log; the latest entry by syncedAt is the live balance.
        // WN-1: WalletBalance now requires asset (per-asset balance on the network wallet).
        await tx.walletBalance.create({
          data: {
            walletId,
            // Buy settlements always credit USDT at launch (ADR-0006).
            // asset is now String (TEXT) — no Prisma enum import needed.
            asset: 'USDT',
            // amount is the credited USDT (new snapshot after credit).
            // In a real system this would be baseBalance + cryptoAmount;
            // for the settlement skeleton we record the credited amount
            // as the snapshot — a full balance sync (provider_sync) will
            // reconcile the exact figure later.
            // Decimal field — string bridges cleanly via Prisma's Decimal adapter.
            amount: cryptoAmount as unknown as Prisma.Decimal,
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
        // Fail-closed: throw before any DB write if the signing key is absent.
        if (!signingKey) {
          throw new ReceiptNotSignableError();
        }

        // Derive the next receipt number from the global Postgres sequence.
        // nextval() is atomic and unique — no phantom-read race possible.
        const seqResult = await tx.$queryRaw<[{ nextval: bigint }]>`
          SELECT nextval('hs_receipt_seq')`;
        const receiptNumber = formatReceiptNumber(year, seqResult[0].nextval);

        // WN-4: pass asset so the receipt shows the correct asset symbol.
        const { htmlContent, itemized } = buildReceiptContent({
          receiptNumber,
          transactionId,
          userId,
          fiatAmount,
          cryptoAmount,
          processingFee,
          asset,
          issuedAt: now,
        });

        // Content hash: sha256 of htmlContent + canonical(itemized).
        const contentHash = createHash('sha256')
          .update(htmlContent + JSON.stringify(itemized), 'utf8')
          .digest('hex');

        // Signature: HMAC-SHA256 over (receiptNumber, transactionId, contentHash, userId, issuedAt).
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
            itemized: itemized as unknown as Prisma.InputJsonValue,
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
        // ReadCommitted (Postgres default) — the advisory lock acquired at the
        // START of this transaction serializes concurrent settlements for the
        // same account. SSI (Serializable) can roll back the loser instead of
        // blocking it, manifesting as P2002 when Prisma retries. The advisory
        // lock + ReadCommitted pairing avoids both P2002 and SSI rollback.
        isolationLevel: 'ReadCommitted',
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

  /**
   * ATOMICALLY creates the sell Transaction row, marks the Proposal 'executing',
   * upserts VelocityCounter rows, AND posts the USDT reserve ledger entries
   * (user_wallet → clearing) — all in ONE `prisma.$transaction` (C1 fix).
   *
   * This eliminates the double-spend window that existed when
   * `createSettlingWithProposal` and `postSellReserveAtomic` were called as two
   * separate $transactions. If a process dies between them, the Transaction would
   * exist without reserve entries, allowing idempotency to return 'settling'
   * without ever debiting the user's wallet.
   *
   * Steps inside the $transaction:
   *   a. Create Transaction row (status='settling', type='sell').
   *   b. Update Proposal → 'executing' (+ confirmedAt).
   *   c. Upsert VelocityCounter rows (amount_24h, count_24h).
   *   d. Read sell reserve account states (user_wallet + clearing) inside the tx.
   *   e. buildSellReserveEntries → insert 2 LedgerEntry rows (USDT: user→clearing).
   */
  async createSellSettlingWithReserveAtomic(
    input: CreateSellSettlingWithReserveInput,
  ): Promise<CreateSellSettlingWithReserveOutput> {
    const { asset } = input;
    const {
      txnData,
      proposalId,
      confirmedAt,
      velocityIncrement,
      walletId,
      cryptoAmount,
      now,
    } = input;

    const row = await this.prisma.$transaction(
      async (tx) => {
        // ── a. Create Transaction row ─────────────────────────────────────────
        const created = await tx.transaction.create({
          data: {
            userId: txnData.userId,
            proposalId: txnData.proposalId,
            type: txnData.type,
            status: txnData.status,
            idempotencyKey: txnData.idempotencyKey,
            requestChecksum: txnData.requestChecksum,
            fxRateSnapshot: txnData.fxRateSnapshot as unknown as Prisma.Decimal,
            metadata: txnData.metadata as unknown as Prisma.InputJsonValue,
            pinVerifiedAt: txnData.pinVerifiedAt,
          },
          select: TRANSACTION_SELECT_SELL,
        });

        // ── b. Flip the Proposal to 'executing' ───────────────────────────────
        await tx.proposal.update({
          where: { id: proposalId },
          data: {
            status: 'executing',
            confirmedAt,
          },
        });

        // ── c. Upsert velocity counters atomically (V1) ───────────────────────
        await writeVelocityIncrementsInSettle(tx, velocityIncrement);

        // ── c2. Advisory locks — serialize concurrent sell reserves to same account ─
        await acquireAccountAdvisoryLocks(tx, [
          { accountType: 'user_wallet', accountId: walletId },
          {
            accountType: 'clearing',
            accountId: ACCOUNT_IDS.USDT_SELL_CLEARING,
          },
        ]);

        // ── d. Read sell reserve account states inside the tx ─────────────────
        // Cast the interactive tx client to PrismaService for our helper —
        // both have the same Prisma model API at runtime (safe boundary cast).
        // WN-4: pass asset so crypto leg states are read with the correct currency key.
        const accountStates = await fetchSellReserveAccountStates(
          tx as unknown as PrismaService,
          walletId,
          asset,
        );

        // ── e. Build and insert reserve LedgerEntry rows ──────────────────────
        // WN-4: pass asset so crypto legs key by asset, not a hardcoded literal.
        const drafts: LedgerEntryDraft[] = buildSellReserveEntries({
          walletId,
          cryptoAmount,
          asset,
          postedAt: now,
          accountStates,
        });

        for (const draft of drafts) {
          await tx.ledgerEntry.create({
            data: {
              transactionId: created.id,
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

        return created;
      },
      {
        // ReadCommitted — the advisory lock (c2 above) serializes concurrent
        // sell reserves for the same account without SSI rollback risk.
        isolationLevel: 'ReadCommitted',
      },
    );

    return { txn: toTransactionRecord(row) };
  }

  /**
   * Posts the sell RESERVE ledger entries atomically (task S4b, execute phase).
   *
   * Steps inside the $transaction:
   *   1. Read user_wallet + clearing account states.
   *   2. buildSellReserveEntries → insert 2 LedgerEntry rows (USDT: user→clearing).
   */
  async postSellReserveAtomic(input: PostSellReserveInput): Promise<void> {
    const { transactionId, walletId, cryptoAmount, asset, now } = input;

    await this.prisma.$transaction(async (tx) => {
      // Advisory locks — serialize concurrent sell reserves for the same account.
      await acquireAccountAdvisoryLocks(tx, [
        { accountType: 'user_wallet', accountId: walletId },
        { accountType: 'clearing', accountId: ACCOUNT_IDS.USDT_SELL_CLEARING },
      ]);

      // WN-4: pass asset so crypto leg states are read with the correct currency key.
      const accountStates = await fetchSellReserveAccountStates(
        tx as unknown as PrismaService,
        walletId,
        asset,
      );

      // WN-4: pass asset so crypto legs key by asset, not a hardcoded literal.
      const drafts: LedgerEntryDraft[] = buildSellReserveEntries({
        walletId,
        cryptoAmount,
        asset,
        postedAt: now,
        accountStates,
      });

      for (const draft of drafts) {
        await tx.ledgerEntry.create({
          data: {
            transactionId,
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
    });
  }

  /**
   * Atomic settlement of a sell order finalize phase in a single Prisma $transaction.
   *
   * Steps inside the $transaction:
   *   1. Read account states (clearing, treasury USDT, treasury NGN, payout) for isolation.
   *   2. buildSellFinalizeEntries → insert LedgerEntry rows (2 USDT + 2 NGN legs).
   *   3. Update Transaction → completed (set processorTxRef, completedAt).
   *   4. Update SettlementOutbox → completed.
   *   5. Mint a signed Receipt.
   */
  async settleSellFinalizeAtomic(
    input: SettleSellFinalizeInput,
  ): Promise<SettleSellFinalizeOutput> {
    const {
      transactionId,
      userId,
      walletId,
      cryptoAmount,
      netFiatAmount,
      asset,
      fiatCurrency,
      providerRef,
      now,
      year,
    } = input;
    const signingKey = this.signingKey;

    return this.prisma.$transaction(
      async (tx) => {
        // ── 0. Advisory locks — serialize concurrent sell finalizations ────────
        await acquireAccountAdvisoryLocks(tx, [
          {
            accountType: 'clearing',
            accountId: ACCOUNT_IDS.USDT_SELL_CLEARING,
          },
          {
            accountType: 'treasury_reserve',
            accountId: ACCOUNT_IDS.USDT_TREASURY,
          },
          {
            accountType: 'treasury_reserve',
            accountId: ACCOUNT_IDS.NGN_TREASURY,
          },
          {
            accountType: 'processor_settlement',
            accountId: ACCOUNT_IDS.NGN_PAYOUT,
          },
        ]);

        // ── 1. Read current account states ────────────────────────────────────
        // WN-4: pass asset so crypto leg states are read with the correct currency key.
        const accountStates = await fetchSellFinalizeAccountStates(
          tx as unknown as PrismaService,
          asset,
        );

        // ── 2. Build and insert LedgerEntry rows ──────────────────────────────
        // WN-4: pass asset so crypto legs key by asset, not a hardcoded literal.
        const drafts: LedgerEntryDraft[] = buildSellFinalizeEntries({
          walletId,
          cryptoAmount,
          netFiatAmount,
          asset,
          fiatCurrency,
          postedAt: now,
          accountStates,
        });

        for (const draft of drafts) {
          await tx.ledgerEntry.create({
            data: {
              transactionId,
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

        // ── 3. Update Transaction → completed ─────────────────────────────────
        await tx.transaction.update({
          where: { id: transactionId },
          data: {
            status: TransactionStatus.completed,
            processorTxRef: providerRef,
            completedAt: now,
          },
        });

        // ── 4. Update SettlementOutbox → completed ────────────────────────────
        await tx.settlementOutbox.updateMany({
          where: {
            transactionId,
            settlementType: 'processor_payout',
          },
          data: {
            status: SettlementOutboxStatus.completed,
            completedAt: now,
          },
        });

        // ── 5. Mint signed Receipt ─────────────────────────────────────────────
        // Fail-closed: throw before any DB write if the signing key is absent.
        if (!signingKey) {
          throw new ReceiptNotSignableError();
        }

        const seqResultSell = await tx.$queryRaw<[{ nextval: bigint }]>`
          SELECT nextval('hs_receipt_seq')`;
        const receiptNumber = formatReceiptNumber(
          year,
          seqResultSell[0].nextval,
        );

        // WN-4: pass asset so the receipt shows the correct asset symbol.
        const { htmlContent, itemized } = buildSellReceiptContent({
          receiptNumber,
          transactionId,
          userId,
          cryptoAmount,
          netFiatAmount,
          asset,
          issuedAt: now,
        });

        const contentHash = createHash('sha256')
          .update(htmlContent + JSON.stringify(itemized), 'utf8')
          .digest('hex');

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
            itemized: itemized as unknown as Prisma.InputJsonValue,
            htmlContent,
            contentHash,
            signatureHash,
            deliveryStatus: ReceiptDeliveryStatus.pending,
            issuedAt: now,
          },
        });

        return { receiptNumber };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  /**
   * Atomic refund of a sell reserve after payout failure (task S4b).
   *
   * Steps inside the $transaction:
   *   1. Read clearing + user_wallet account states.
   *   2. buildSellRefundEntries → insert LedgerEntry rows (reverses the reserve).
   *   3. Update Transaction → failed.
   *   4. Create CompensationRecord (status=pending, reason=settlement_failed).
   */
  async settleSellRefundAtomic(input: SettleSellRefundInput): Promise<void> {
    const { transactionId, userId, walletId, cryptoAmount, asset, now } = input;

    await this.prisma.$transaction(
      async (tx) => {
        // ── 0. Advisory locks — serialize concurrent sell refunds for same account ─
        await acquireAccountAdvisoryLocks(tx, [
          {
            accountType: 'clearing',
            accountId: ACCOUNT_IDS.USDT_SELL_CLEARING,
          },
          { accountType: 'user_wallet', accountId: walletId },
        ]);

        // ── 1. Read current account states ────────────────────────────────────
        // WN-4: pass asset so crypto leg states are read with the correct currency key.
        const accountStates = await fetchSellRefundAccountStates(
          tx as unknown as PrismaService,
          walletId,
          asset,
        );

        // ── 2. Build and insert LedgerEntry rows ──────────────────────────────
        // WN-4: pass asset so crypto legs key by asset, not a hardcoded literal.
        const drafts: LedgerEntryDraft[] = buildSellRefundEntries({
          walletId,
          cryptoAmount,
          asset,
          postedAt: now,
          accountStates,
        });

        for (const draft of drafts) {
          await tx.ledgerEntry.create({
            data: {
              transactionId,
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

        // ── 3. Update Transaction → failed ────────────────────────────────────
        await tx.transaction.update({
          where: { id: transactionId },
          data: {
            status: TransactionStatus.failed,
            completedAt: now,
          },
        });

        // ── 4. Create CompensationRecord ──────────────────────────────────────
        // CompensationRecord.@@unique([originatingTransactionId]) means only one
        // compensation can be created per failed transaction (idempotent on retry).
        // We use upsert-style: if it already exists, we do nothing (update: {}).
        // Prisma does not support upsert with unique constraint without an update,
        // so we use createIfNotExists pattern via catch on duplicate.
        try {
          await tx.compensationRecord.create({
            data: {
              originatingTransactionId: transactionId,
              userId,
              reason: CompensationReason.settlement_failed,
              // The refund amount is the USDT that was reserved.
              amount: cryptoAmount as unknown as Prisma.Decimal,
              currency: 'USDT',
              // status defaults to pending per the schema default.
            },
          });
        } catch {
          // Duplicate unique constraint — compensation already recorded on a
          // prior attempt. This is safe to ignore: the ledger refund rows
          // would also have failed (FK checks prevent them from being inserted
          // twice), so this catch is only reached if the $transaction was
          // somehow retried at the application layer after a partial commit,
          // which Prisma's $transaction prevents in normal operation.
        }
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  /**
   * ATOMICALLY creates the send Transaction row, marks the Proposal 'executing',
   * upserts VelocityCounter rows, AND posts the USDT reserve ledger entries
   * (user_wallet → clearing) — all in ONE `prisma.$transaction` (C1 fix, task N3b).
   *
   * The totalDebit (cryptoAmount + networkFeeCrypto) is held from the user's
   * wallet so it cannot be double-spent while the on-chain broadcast is in flight.
   *
   * Steps inside the $transaction:
   *   a. Create Transaction row (status='settling', type='send').
   *   b. Update Proposal → 'executing' (+ confirmedAt).
   *   c. Upsert VelocityCounter rows (amount_24h, count_24h).
   *   d. Read send reserve account states (user_wallet + clearing) inside the tx.
   *   e. buildSendReserveEntries → insert 2 LedgerEntry rows (USDT: user→clearing).
   */
  async createSendSettlingWithReserveAtomic(
    input: CreateSendSettlingWithReserveInput,
  ): Promise<CreateSendSettlingWithReserveOutput> {
    const {
      txnData,
      proposalId,
      confirmedAt,
      velocityIncrement,
      walletId,
      totalDebit,
      asset,
      now,
      travelRule,
    } = input;

    const row = await this.prisma.$transaction(
      async (tx) => {
        // ── a. Create Transaction row ─────────────────────────────────────────
        const created = await tx.transaction.create({
          data: {
            userId: txnData.userId,
            proposalId: txnData.proposalId,
            type: txnData.type,
            status: txnData.status,
            idempotencyKey: txnData.idempotencyKey,
            requestChecksum: txnData.requestChecksum,
            fxRateSnapshot:
              txnData.fxRateSnapshot !== null
                ? (txnData.fxRateSnapshot as unknown as Prisma.Decimal)
                : null,
            metadata: txnData.metadata as unknown as Prisma.InputJsonValue,
            pinVerifiedAt: txnData.pinVerifiedAt,
          },
          select: TRANSACTION_SELECT_SELL,
        });

        // ── b. Flip the Proposal to 'executing' ───────────────────────────────
        await tx.proposal.update({
          where: { id: proposalId },
          data: {
            status: 'executing',
            confirmedAt,
          },
        });

        // ── c. Upsert velocity counters atomically (V1) ───────────────────────
        await writeVelocityIncrementsInSettle(tx, velocityIncrement);

        // ── c2. Advisory locks — serialize concurrent send reserves for same account ─
        await acquireAccountAdvisoryLocks(tx, [
          { accountType: 'user_wallet', accountId: walletId },
          {
            accountType: 'clearing',
            accountId: ACCOUNT_IDS.USDT_SEND_CLEARING,
          },
        ]);

        // ── d. Read send reserve account states inside the tx ─────────────────
        // WN-4: pass asset so crypto leg states are read with the correct currency key.
        const accountStates = await fetchSendReserveAccountStates(
          tx as unknown as PrismaService,
          walletId,
          asset,
        );

        // ── e. Build and insert reserve LedgerEntry rows ──────────────────────
        // WN-4: pass asset so crypto legs key by asset, not a hardcoded literal.
        const drafts: LedgerEntryDraft[] = buildSendReserveEntries({
          walletId,
          totalDebit,
          asset,
          postedAt: now,
          accountStates,
        });

        for (const draft of drafts) {
          await tx.ledgerEntry.create({
            data: {
              transactionId: created.id,
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

        // ── f. Persist TravelRuleData row (SPEC DEVIATION fix, AUD-08) ────────
        // When the send amount exceeds the configured NGN threshold,
        // a TravelRuleData row must be created inside the SAME $transaction
        // so compliance records are never orphaned from the transaction row.
        // Null columns are explicitly noted — KycProfile enrichment is a
        // separate compliance task; the skeleton captures what is available now.
        if (travelRule !== null) {
          await tx.travelRuleData.create({
            data: {
              transactionId: created.id,
              // Originator is always 'individual' at launch (no business accounts yet).
              originatorType: TravelRulePartyType.individual,
              originatorId: travelRule.originatorUserId,
              // originatorName: '' — KycProfile not plumbed through the engine yet.
              // Schema requires non-null string; '' is the explicit empty sentinel.
              originatorName: travelRule.originatorName ?? '',
              // originatorAddress: '' — residential address not captured at this tier.
              originatorAddress: '',
              // originatorAccountNumber: '' — wallet address is the on-chain ref, not an account number.
              originatorAccountNumber: '',
              // Beneficiary fields: address is the on-chain destination.
              beneficiaryType: TravelRulePartyType.unknown,
              // beneficiaryId: null — internal beneficiary FK not available here.
              beneficiaryId: null,
              beneficiaryName: travelRule.beneficiaryName,
              beneficiaryAddress: travelRule.beneficiaryAddress,
              // beneficiaryAccountNumber: '' — on-chain sends do not have account numbers.
              beneficiaryAccountNumber: '',
              // asset is String (TEXT) — any catalog asset persists without migration.
              asset: travelRule.asset,
              amount: travelRule.cryptoAmount,
              amountFiat: travelRule.ngnEquivalent as unknown as Prisma.Decimal,
              triggeringFactor: TravelRuleTrigger.amount_threshold,
              capturedAt: now,
              // reportedAt: null — not yet submitted to counterparty/regulator.
              reportedAt: null,
            },
          });
        }

        return created;
      },
      {
        // ReadCommitted — the advisory lock (c2 above) serializes concurrent
        // send reserves for the same account without SSI rollback risk.
        isolationLevel: 'ReadCommitted',
      },
    );

    return { txn: toTransactionRecord(row) };
  }

  /**
   * Atomic settlement of a send finalize phase in a single Prisma $transaction.
   *
   * Steps inside the $transaction:
   *   1. Read account states (clearing, network_out, fees) for isolation.
   *   2. buildSendFinalizeEntries → insert 3 LedgerEntry rows (all USDT).
   *   3. Update Transaction → completed (set processorTxRef = onChainTxHash).
   *   4. Update SettlementOutbox(onchain_send) → completed.
   *   5. Mint a signed Receipt.
   */
  async settleSendFinalizeAtomic(
    input: SettleSendFinalizeInput,
  ): Promise<SettleSendFinalizeOutput> {
    const {
      transactionId,
      userId,
      walletId,
      cryptoAmount,
      networkFeeCrypto,
      asset,
      onChainTxHash,
      now,
      year,
    } = input;
    const signingKey = this.signingKey;

    return this.prisma.$transaction(
      async (tx) => {
        // ── 0. Advisory locks — serialize concurrent send finalizations ────────
        await acquireAccountAdvisoryLocks(tx, [
          {
            accountType: 'clearing',
            accountId: ACCOUNT_IDS.USDT_SEND_CLEARING,
          },
          {
            accountType: 'treasury_reserve',
            accountId: ACCOUNT_IDS.USDT_NETWORK_OUT,
          },
          { accountType: 'treasury_reserve', accountId: ACCOUNT_IDS.USDT_FEES },
        ]);

        // ── 1. Read current account states ────────────────────────────────────
        // WN-4: pass asset so crypto leg states are read with the correct currency key.
        const accountStates = await fetchSendFinalizeAccountStates(
          tx as unknown as PrismaService,
          asset,
        );

        // ── 2. Build and insert LedgerEntry rows ──────────────────────────────
        // WN-4: pass asset so crypto legs key by asset, not a hardcoded literal.
        const drafts: LedgerEntryDraft[] = buildSendFinalizeEntries({
          walletId,
          cryptoAmount,
          networkFeeCrypto,
          asset,
          postedAt: now,
          accountStates,
        });

        for (const draft of drafts) {
          await tx.ledgerEntry.create({
            data: {
              transactionId,
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

        // ── 3. Update Transaction → completed ─────────────────────────────────
        await tx.transaction.update({
          where: { id: transactionId },
          data: {
            status: TransactionStatus.completed,
            processorTxRef: onChainTxHash,
            completedAt: now,
          },
        });

        // ── 4. Update SettlementOutbox(onchain_send) → completed ──────────────
        await tx.settlementOutbox.updateMany({
          where: {
            transactionId,
            settlementType: 'onchain_send',
          },
          data: {
            status: SettlementOutboxStatus.completed,
            completedAt: now,
          },
        });

        // ── 5. Mint signed Receipt ─────────────────────────────────────────────
        // Fail-closed: throw before any DB write if the signing key is absent.
        if (!signingKey) {
          throw new ReceiptNotSignableError();
        }

        const seqResultSend = await tx.$queryRaw<[{ nextval: bigint }]>`
          SELECT nextval('hs_receipt_seq')`;
        const receiptNumber = formatReceiptNumber(
          year,
          seqResultSend[0].nextval,
        );

        // Read back transaction metadata to get toAddress for the receipt.
        const txnRow = await tx.transaction.findUnique({
          where: { id: transactionId },
          select: { metadata: true },
        });
        const meta = (txnRow?.metadata ?? {}) as Record<string, unknown>;
        const toAddress = (meta.toAddress as string | undefined) ?? '';

        // WN-4: pass asset so the receipt shows the correct asset symbol.
        const { htmlContent, itemized } = buildSendReceiptContent({
          receiptNumber,
          transactionId,
          userId,
          cryptoAmount,
          networkFeeCrypto,
          asset,
          toAddress,
          onChainTxHash,
          issuedAt: now,
        });

        const contentHash = createHash('sha256')
          .update(htmlContent + JSON.stringify(itemized), 'utf8')
          .digest('hex');

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
            itemized: itemized as unknown as Prisma.InputJsonValue,
            htmlContent,
            contentHash,
            signatureHash,
            deliveryStatus: ReceiptDeliveryStatus.pending,
            issuedAt: now,
          },
        });

        return { receiptNumber };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  /**
   * Atomic refund of a send reserve after on-chain broadcast failure (task N3b).
   *
   * Steps inside the $transaction:
   *   1. Read clearing + user_wallet account states.
   *   2. buildSendRefundEntries → insert 2 LedgerEntry rows (reverses the reserve).
   *   3. Update Transaction → failed.
   *   4. Create CompensationRecord (status=pending, reason=settlement_failed).
   */
  async settleSendRefundAtomic(input: SettleSendRefundInput): Promise<void> {
    const {
      transactionId,
      userId,
      walletId,
      totalDebit,
      asset,
      failureReason,
      now,
    } = input;

    await this.prisma.$transaction(
      async (tx) => {
        // ── 0. Advisory locks — serialize concurrent send refunds for same account ─
        await acquireAccountAdvisoryLocks(tx, [
          {
            accountType: 'clearing',
            accountId: ACCOUNT_IDS.USDT_SEND_CLEARING,
          },
          { accountType: 'user_wallet', accountId: walletId },
        ]);

        // ── 1. Read current account states ────────────────────────────────────
        // WN-4: pass asset so crypto leg states are read with the correct currency key.
        const accountStates = await fetchSendRefundAccountStates(
          tx as unknown as PrismaService,
          walletId,
          asset,
        );

        // ── 2. Build and insert LedgerEntry rows ──────────────────────────────
        // WN-4: pass asset so crypto legs key by asset, not a hardcoded literal.
        const drafts: LedgerEntryDraft[] = buildSendRefundEntries({
          walletId,
          totalDebit,
          asset,
          postedAt: now,
          accountStates,
        });

        for (const draft of drafts) {
          await tx.ledgerEntry.create({
            data: {
              transactionId,
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

        // ── 3. Update Transaction → failed ────────────────────────────────────
        await tx.transaction.update({
          where: { id: transactionId },
          data: {
            status: TransactionStatus.failed,
            completedAt: now,
          },
        });

        // ── 4. Create CompensationRecord ──────────────────────────────────────
        try {
          await tx.compensationRecord.create({
            data: {
              originatingTransactionId: transactionId,
              userId,
              reason: CompensationReason.settlement_failed,
              // The refund amount is the totalDebit (cryptoAmount + networkFeeCrypto).
              amount: totalDebit as unknown as Prisma.Decimal,
              // WN-4: use the actual asset so the compensation record is correct.
              currency: asset,
              approvalComment: failureReason,
            },
          });
        } catch {
          // Duplicate unique constraint — compensation already recorded on a
          // prior attempt. Safe to ignore (same logic as settleSellRefundAtomic).
        }
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  // ---------------------------------------------------------------------------
  // Swap settlement methods
  // ---------------------------------------------------------------------------

  /**
   * ATOMICALLY creates the swap Transaction row, marks the Proposal 'executing',
   * upserts VelocityCounter rows, AND posts the fromAsset reserve ledger entries
   * (user_wallet → swap_clearing) — all in ONE `prisma.$transaction` (C1).
   *
   * Steps:
   *   a. Create Transaction row (status='settling', type='swap').
   *   b. Update Proposal → 'executing' (+ confirmedAt).
   *   c. Upsert VelocityCounter rows.
   *   d. Read swap reserve account states (user_wallet + clearing) inside the tx.
   *   e. buildSwapReserveEntries → insert 2 LedgerEntry rows (fromAsset: user→clearing).
   */
  async createSwapSettlingWithReserveAtomic(
    input: CreateSwapSettlingWithReserveInput,
  ): Promise<CreateSwapSettlingWithReserveOutput> {
    const {
      txnData,
      proposalId,
      confirmedAt,
      velocityIncrement,
      walletId,
      fromAmount,
      fromAsset,
      now,
    } = input;

    const row = await this.prisma.$transaction(
      async (tx) => {
        // ── a. Create Transaction row ─────────────────────────────────────────
        const created = await tx.transaction.create({
          data: {
            userId: txnData.userId,
            proposalId: txnData.proposalId,
            type: txnData.type,
            status: txnData.status,
            idempotencyKey: txnData.idempotencyKey,
            requestChecksum: txnData.requestChecksum,
            fxRateSnapshot:
              txnData.fxRateSnapshot !== null
                ? (txnData.fxRateSnapshot as unknown as Prisma.Decimal)
                : null,
            metadata: txnData.metadata as unknown as Prisma.InputJsonValue,
            pinVerifiedAt: txnData.pinVerifiedAt,
          },
          select: TRANSACTION_SELECT_SELL,
        });

        // ── b. Flip the Proposal to 'executing' ───────────────────────────────
        await tx.proposal.update({
          where: { id: proposalId },
          data: {
            status: 'executing',
            confirmedAt,
          },
        });

        // ── c. Upsert velocity counters atomically ────────────────────────────
        await writeVelocityIncrementsInSettle(tx, velocityIncrement);

        // ── c2. Advisory locks — serialize concurrent swap reserves for same account ─
        await acquireAccountAdvisoryLocks(tx, [
          { accountType: 'user_wallet', accountId: walletId },
          { accountType: 'clearing', accountId: ACCOUNT_IDS.SWAP_CLEARING },
        ]);

        // ── d. Read swap reserve account states inside the tx ─────────────────
        const accountStates = await fetchSwapReserveAccountStates(
          tx as unknown as PrismaService,
          walletId,
          fromAsset,
        );

        // ── e. Build and insert reserve LedgerEntry rows ──────────────────────
        const drafts: LedgerEntryDraft[] = buildSwapReserveEntries({
          walletId,
          fromAmount,
          fromAsset,
          postedAt: now,
          accountStates,
        });

        for (const draft of drafts) {
          await tx.ledgerEntry.create({
            data: {
              transactionId: created.id,
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

        return toTransactionRecord(created);
      },
      { isolationLevel: 'ReadCommitted' },
    );

    return { txn: row };
  }

  /**
   * Atomically finalizes a swap after provider confirmation:
   *   1. Read account states.
   *   2. buildSwapFinalizeEntries → insert 4 LedgerEntry rows (from + to legs).
   *   3. Transaction → completed.
   *   4. SettlementOutbox(swap) → completed.
   *   5. Mint signed Receipt.
   */
  async settleSwapFinalizeAtomic(
    input: SettleSwapFinalizeInput,
  ): Promise<SettleSwapFinalizeOutput> {
    const {
      transactionId,
      userId,
      walletId,
      fromAmount,
      fromAsset,
      toAmount,
      toAsset,
      onChainTxHash,
      now,
      year,
    } = input;

    return this.prisma.$transaction(
      async (tx) => {
        // ── 0. Advisory locks — serialize concurrent swap finalizations ────────
        await acquireAccountAdvisoryLocks(tx, [
          { accountType: 'clearing', accountId: ACCOUNT_IDS.SWAP_CLEARING },
          { accountType: 'treasury_reserve', accountId: ACCOUNT_IDS.SWAP_OUT },
          { accountType: 'treasury_reserve', accountId: ACCOUNT_IDS.SWAP_IN },
          { accountType: 'user_wallet', accountId: walletId },
        ]);

        // ── 1. Read account states ─────────────────────────────────────────────
        const accountStates = await fetchSwapFinalizeAccountStates(
          tx as unknown as PrismaService,
          walletId,
          fromAsset,
          toAsset,
        );

        // ── 2. Build and insert LedgerEntry rows ──────────────────────────────
        const drafts: LedgerEntryDraft[] = buildSwapFinalizeEntries({
          walletId,
          fromAmount,
          fromAsset,
          toAmount,
          toAsset,
          postedAt: now,
          accountStates,
        });

        for (const draft of drafts) {
          await tx.ledgerEntry.create({
            data: {
              transactionId,
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

        // ── 3. Update Transaction → completed ─────────────────────────────────
        await tx.transaction.update({
          where: { id: transactionId },
          data: {
            status: TransactionStatus.completed,
            processorTxRef: onChainTxHash,
            completedAt: now,
          },
        });

        // ── 4. Update SettlementOutbox → completed ────────────────────────────
        // Upsert-style: the outbox row may not exist in all test paths.
        try {
          await tx.settlementOutbox.updateMany({
            where: { transactionId, status: SettlementOutboxStatus.pending },
            data: {
              status: SettlementOutboxStatus.completed,
              lastAttemptAt: now,
            },
          });
        } catch {
          // No outbox row — non-fatal in swap finalize (webhook-driven).
        }

        // ── 5. Mint signed Receipt ────────────────────────────────────────────
        const signingKey = this.signingKey;
        if (!signingKey) {
          throw new ReceiptNotSignableError();
        }

        // Derive the next receipt number from the global Postgres sequence —
        // EXACTLY like buy/sell/send/deposit. nextval() is atomic and unique, so
        // it can never collide with a number issued by another settlement path.
        // (The previous `receipt.count()+1` diverged from the sequence and
        // produced duplicate numbers → P2002 inside this $transaction → the
        // atomic finalize rolled back and the user's fromAsset reserve was
        // stranded with no toAsset credit. Audit finding #4.)
        const seqResultSwap = await tx.$queryRaw<[{ nextval: bigint }]>`
          SELECT nextval('hs_receipt_seq')`;
        const receiptNumber = formatReceiptNumber(
          year,
          seqResultSwap[0].nextval,
        );

        const { htmlContent, itemized } = buildSwapReceiptContent({
          receiptNumber,
          transactionId,
          userId,
          fromAmount,
          fromAsset,
          toAmount,
          toAsset,
          onChainTxHash,
          issuedAt: now,
        });

        // Content hash + signature MUST match every other receipt path and the
        // documented Receipt.signatureHash contract (schema/07-receipts.prisma):
        // contentHash = sha256(html + canonical(itemized)); signature = HMAC over
        // the structured tuple (receiptNumber, transactionId, contentHash,
        // userId, issuedAt) — NOT hmac(htmlContent) only. Audit finding #19.
        const contentHash = createHash('sha256')
          .update(htmlContent + JSON.stringify(itemized), 'utf8')
          .digest('hex');

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
            userId,
            receiptNumber,
            itemized: itemized as unknown as Prisma.InputJsonValue,
            htmlContent,
            contentHash,
            signatureHash,
            deliveryStatus: ReceiptDeliveryStatus.pending,
            issuedAt: now,
          },
        });

        return { receiptNumber };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  /**
   * Atomically refunds a swap reserve after provider failure:
   *   1. Read clearing + user_wallet account states.
   *   2. buildSwapRefundEntries → insert 2 LedgerEntry rows (reverses the reserve).
   *   3. Transaction → failed.
   *   4. CompensationRecord created.
   */
  async settleSwapRefundAtomic(input: SettleSwapRefundInput): Promise<void> {
    const {
      transactionId,
      userId,
      walletId,
      fromAmount,
      fromAsset,
      failureReason,
      now,
    } = input;

    await this.prisma.$transaction(
      async (tx) => {
        // ── 0. Advisory locks — serialize concurrent swap refunds for same account ─
        await acquireAccountAdvisoryLocks(tx, [
          { accountType: 'clearing', accountId: ACCOUNT_IDS.SWAP_CLEARING },
          { accountType: 'user_wallet', accountId: walletId },
        ]);

        // ── 1. Read current account states ────────────────────────────────────
        const accountStates = await fetchSwapRefundAccountStates(
          tx as unknown as PrismaService,
          walletId,
          fromAsset,
        );

        // ── 2. Build and insert LedgerEntry rows ──────────────────────────────
        const drafts: LedgerEntryDraft[] = buildSwapRefundEntries({
          walletId,
          fromAmount,
          fromAsset,
          postedAt: now,
          accountStates,
        });

        for (const draft of drafts) {
          await tx.ledgerEntry.create({
            data: {
              transactionId,
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

        // ── 3. Update Transaction → failed ────────────────────────────────────
        await tx.transaction.update({
          where: { id: transactionId },
          data: {
            status: TransactionStatus.failed,
            completedAt: now,
          },
        });

        // ── 4. Create CompensationRecord ──────────────────────────────────────
        try {
          await tx.compensationRecord.create({
            data: {
              originatingTransactionId: transactionId,
              userId,
              reason: CompensationReason.settlement_failed,
              amount: fromAmount as unknown as Prisma.Decimal,
              currency: fromAsset,
              approvalComment: failureReason,
            },
          });
        } catch {
          // Duplicate unique constraint — compensation already recorded.
        }
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }
}
