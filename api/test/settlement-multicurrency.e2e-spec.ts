/**
 * Integration test: multi-currency settlement — the fiat legs must derive from
 * the transaction's `fiatCurrency`, not a hardcoded 'NGN'/'USDT' literal.
 *
 * Regression guard for the static-currency money-path bug: the account-state
 * FETCHERS + advisory-lock lists in settlement.prisma.repository.ts hardcoded the
 * NGN fiat accounts, while the DOMAIN builders (ledger.ts) DERIVE per-currency
 * accounts from `fiatCurrency`. For a non-NGN live fiat the fetcher read state for
 * `ngn_processor:NGN` but the builder wrote to `ghs_processor:GHS` → the state read
 * always missed → getState returned {sequence:0} → every leg computed sequence=1 →
 * the SECOND non-NGN buy/sell P2002-collided on
 * @@unique([accountType,accountId,currency,sequence]).
 *
 * Proof (all against REAL Postgres via Testcontainers):
 *   (a) fiat legs post to `${fc}_processor/_treasury/_fees` (buy) and
 *       `${fc}_treasury/_payout` (sell) with currency=<fc> (NOT ngn/NGN);
 *   (b) TWO CONSECUTIVE non-NGN settles succeed — the 2nd does NOT P2002 and the
 *       per-account sequence advances 1→2 with a correct running balanceAfter;
 *   (c) the buy/sell receipt itemized JSON + HTML carry <fc> and its symbol;
 *   (d) a non-USDT (USDC) buy's WalletBalance snapshot + a non-USDT sell refund's
 *       CompensationRecord carry the crypto `asset`, not a hardcoded 'USDT'.
 *
 * The settlement repository is exercised DIRECTLY (no proposal/quote pipeline) so
 * the assertions isolate the fetcher/lock/receipt derivation under test. A SECOND
 * live fiat (GHS) is enabled via the config-defaults catalog seam the AssetRegistry
 * reads — the same seam an admin currency-enable toggles in production.
 *
 * Requires Docker. Runs only in the `test:e2e` lane (jest-e2e.json).
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '../generated/prisma/client';
import { startTestPostgres } from './helpers/pg-testcontainer';

import { SettlementPrismaRepository } from '../src/modules/transactions/infrastructure/settlement.prisma.repository';
import { AssetRegistry } from '../src/core/catalog/asset-registry';

import type { PrismaService } from '../src/core/prisma/prisma.service';

import configuration from '../src/core/config/configuration';

jest.setTimeout(300_000);

// ---------------------------------------------------------------------------
// Config with a SECOND live fiat (GHS) enabled — the multi-currency seam.
// GHS ships in configuration.ts as supported-but-not-live (enabled:false); we
// flip its enable flag on the catalog the AssetRegistry reads, exactly as an
// admin currency-enable would in production.
// ---------------------------------------------------------------------------

const appConfig = configuration();
appConfig.catalog.fiats.GHS.enabled = true;

const RECEIPT_SIGNING_KEY = 'e2e-multicurrency-receipt-signing-key-32b!!';

class StubConfigService {
  get<T = unknown>(key: string): T {
    if (key === 'RECEIPT_SIGNING_KEY') {
      return RECEIPT_SIGNING_KEY as T;
    }
    const parts = key.split('.');
    let val: unknown = appConfig;
    for (const part of parts) {
      if (val === null || typeof val !== 'object') return undefined as T;
      val = (val as Record<string, unknown>)[part];
    }
    return val as T;
  }
}

// ---------------------------------------------------------------------------
// Decimal-safe helper for balanceAfter assertions.
// ---------------------------------------------------------------------------

const SCALE = 10n ** 18n;

function toScaled(s: string): bigint {
  const str = s.trim();
  const isNeg = str.startsWith('-');
  const abs = isNeg ? str.slice(1) : str;
  const [whole = '0', frac = ''] = abs.split('.');
  const fracPadded = frac.slice(0, 18).padEnd(18, '0');
  const scaled = BigInt(whole) * SCALE + BigInt(fracPadded);
  return isNeg ? -scaled : scaled;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Settlement — multi-currency fiat legs (Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: SettlementPrismaRepository;

  let userId: string;
  let walletId: string;

  const year = String(new Date().getUTCFullYear());
  const now = new Date();

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    const ps = prisma as unknown as PrismaService;
    const config = new StubConfigService() as never;
    const assets = new AssetRegistry(config);
    repo = new SettlementPrismaRepository(ps, config, assets);

    const user = await prisma.user.create({
      data: { kycStatus: 'verified', kycTier: 'tier_1', status: 'active' },
    });
    userId = user.id;

    const wallet = await prisma.wallet.create({
      data: {
        userId,
        network: 'TRON',
        address: `TMultiCcyWallet${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        providerReference: `e2e-multiccy-ref-${randomUUID().slice(0, 8)}`,
        status: 'active',
      },
    });
    walletId = wallet.id;
  });

  afterAll(async () => {
    await stop?.();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function seedSettlingTxn(
    type: 'buy' | 'sell',
    metadata: Record<string, unknown> = {},
  ): Promise<string> {
    const txn = await prisma.transaction.create({
      data: {
        userId,
        type,
        status: 'settling',
        idempotencyKey: randomUUID(),
        requestChecksum: randomUUID().replace(/-/g, ''),
        metadata: metadata as never,
      },
    });
    return txn.id;
  }

  // ---------------------------------------------------------------------------
  // (a)+(b)+(c) BUY — two consecutive GHS buys settle with GHS fiat legs, no P2002
  // ---------------------------------------------------------------------------

  it('two consecutive GHS buys post GHS fiat legs (${fc}_processor/_treasury/_fees), no P2002, sequence 1→2, GHS receipt', async () => {
    const t1 = await seedSettlingTxn('buy');
    const t2 = await seedSettlingTxn('buy');

    const buyInput = (transactionId: string, ref: string) => ({
      transactionId,
      userId,
      walletId,
      fiatAmount: '10000',
      cryptoAmount: '6.25',
      processingFee: '100',
      asset: 'USDT',
      fiatCurrency: 'GHS',
      providerRef: ref,
      now,
      year,
    });

    // FIRST GHS buy.
    const r1 = await repo.settleBuyAtomic(buyInput(t1, 'ghs_ref_buy_1'));
    expect(r1.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);

    // SECOND GHS buy — MUST NOT P2002 (the core bug) — under the buggy fetcher
    // both buys recompute sequence=1 for ghs_processor and collide.
    const r2 = await repo.settleBuyAtomic(buyInput(t2, 'ghs_ref_buy_2'));
    expect(r2.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);

    // (a) GHS fiat legs present with the ${fc}-derived account ids + currency=GHS.
    const ghsEntries = await prisma.ledgerEntry.findMany({
      where: { currency: 'GHS' },
    });
    const ghsAccountIds = ghsEntries.map((e) => e.accountId);
    expect(ghsAccountIds).toContain('ghs_processor');
    expect(ghsAccountIds).toContain('ghs_treasury');
    expect(ghsAccountIds).toContain('ghs_fees');

    // NO legs leaked to the NGN accounts (the hardcoded-literal bug).
    const ngnEntries = await prisma.ledgerEntry.findMany({
      where: {
        OR: [
          { accountId: 'ngn_processor' },
          { accountId: 'ngn_treasury' },
          { accountId: 'ngn_fees' },
        ],
      },
    });
    expect(ngnEntries).toHaveLength(0);

    // (b) Shared processor_settlement/ghs_processor account advanced 1→2 with a
    // running balance of 10000 then 20000 (state read HITS the GHS account now).
    const processorRows = await prisma.ledgerEntry.findMany({
      where: {
        accountType: 'processor_settlement',
        accountId: 'ghs_processor',
        currency: 'GHS',
      },
      orderBy: { sequence: 'asc' },
    });
    expect(processorRows.map((r) => r.sequence)).toEqual([1, 2]);
    expect(
      toScaled(
        (processorRows[0].balanceAfter as { toString(): string }).toString(),
      ),
    ).toBe(toScaled('10000'));
    expect(
      toScaled(
        (processorRows[1].balanceAfter as { toString(): string }).toString(),
      ),
    ).toBe(toScaled('20000'));

    // (c) Buy receipt carries GHS (code) + its symbol (GH₵).
    const receipt = await prisma.receipt.findUnique({
      where: { transactionId: t1 },
    });
    expect(receipt).not.toBeNull();
    const itemized = receipt!.itemized as Record<string, unknown>;
    expect(itemized.fiatCurrency).toBe('GHS');
    expect(receipt!.htmlContent).toContain('GH₵');
    expect(receipt!.htmlContent).not.toContain('NGN ');
  });

  // ---------------------------------------------------------------------------
  // (a)+(b)+(c) SELL — two consecutive GHS sell-finalizes, GHS payout legs, no P2002
  // ---------------------------------------------------------------------------

  it('two consecutive GHS sell-finalizes post GHS payout legs (${fc}_treasury/_payout), no P2002, sequence 1→2, GHS receipt', async () => {
    const t1 = await seedSettlingTxn('sell');
    const t2 = await seedSettlingTxn('sell');

    const sellInput = (transactionId: string, ref: string) => ({
      transactionId,
      userId,
      walletId,
      cryptoAmount: '5',
      netFiatAmount: '8000',
      asset: 'USDT',
      fiatCurrency: 'GHS',
      providerRef: ref,
      now,
      year,
    });

    const r1 = await repo.settleSellFinalizeAtomic(
      sellInput(t1, 'ghs_payout_1'),
    );
    expect(r1.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);

    // SECOND GHS sell-finalize — MUST NOT P2002 on ghs_treasury / ghs_payout.
    const r2 = await repo.settleSellFinalizeAtomic(
      sellInput(t2, 'ghs_payout_2'),
    );
    expect(r2.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);

    // (a) GHS payout legs present with the ${fc}-derived account ids + currency=GHS.
    const payoutRows = await prisma.ledgerEntry.findMany({
      where: {
        accountType: 'processor_settlement',
        accountId: 'ghs_payout',
        currency: 'GHS',
      },
      orderBy: { sequence: 'asc' },
    });
    const treasuryFiatRows = await prisma.ledgerEntry.findMany({
      where: {
        accountType: 'treasury_reserve',
        accountId: 'ghs_treasury',
        currency: 'GHS',
      },
      orderBy: { sequence: 'asc' },
    });
    expect(payoutRows).toHaveLength(2);
    expect(treasuryFiatRows.length).toBeGreaterThanOrEqual(2);

    // No sell payout leaked to the NGN payout account.
    const ngnPayout = await prisma.ledgerEntry.findMany({
      where: { accountId: 'ngn_payout' },
    });
    expect(ngnPayout).toHaveLength(0);

    // (b) ghs_payout advanced 1→2 (running credit 8000 then 16000).
    expect(payoutRows.map((r) => r.sequence)).toEqual([1, 2]);
    expect(
      toScaled(
        (payoutRows[1].balanceAfter as { toString(): string }).toString(),
      ),
    ).toBe(toScaled('16000'));

    // (c) Sell receipt carries GHS (code) + its symbol (GH₵).
    const receipt = await prisma.receipt.findUnique({
      where: { transactionId: t1 },
    });
    expect(receipt).not.toBeNull();
    const itemized = receipt!.itemized as Record<string, unknown>;
    expect(itemized.fiatCurrency).toBe('GHS');
    expect(receipt!.htmlContent).toContain('GH₵');
  });

  // ---------------------------------------------------------------------------
  // (d) non-USDT asset — buy WalletBalance snapshot + sell-refund CompensationRecord
  // ---------------------------------------------------------------------------

  it('a USDC buy writes a USDC WalletBalance snapshot (not a hardcoded USDT)', async () => {
    const t = await seedSettlingTxn('buy');

    await repo.settleBuyAtomic({
      transactionId: t,
      userId,
      walletId,
      fiatAmount: '10000',
      cryptoAmount: '4',
      processingFee: '100',
      asset: 'USDC',
      fiatCurrency: 'GHS',
      providerRef: 'ghs_ref_usdc_buy',
      now,
      year,
    });

    const usdcBalance = await prisma.walletBalance.findFirst({
      where: { walletId, asset: 'USDC' },
      orderBy: { syncedAt: 'desc' },
    });
    expect(usdcBalance).not.toBeNull();
    expect(usdcBalance!.asset).toBe('USDC');
    // The user_wallet USDC ledger leg is present (crypto keyed by asset).
    const usdcLeg = await prisma.ledgerEntry.findFirst({
      where: { transactionId: t, accountType: 'user_wallet', currency: 'USDC' },
    });
    expect(usdcLeg).not.toBeNull();
  });

  it('a USDC sell refund records the CompensationRecord in USDC (not a hardcoded USDT)', async () => {
    const t = await seedSettlingTxn('sell');

    await repo.settleSellRefundAtomic({
      transactionId: t,
      userId,
      walletId,
      cryptoAmount: '3',
      asset: 'USDC',
      failureReason: 'payout_failed',
      now,
    });

    const comp = await prisma.compensationRecord.findFirst({
      where: { originatingTransactionId: t },
    });
    expect(comp).not.toBeNull();
    expect(comp!.currency).toBe('USDC');
    expect(toScaled((comp!.amount as { toString(): string }).toString())).toBe(
      toScaled('3'),
    );
  });
});
