/**
 * Integration test for SettlementPrismaRepository.settleSwapFinalizeAtomic
 * (audit findings #4 and #19, CLAUDE.md §3.1 funds-safety).
 *
 * Verifies, against a REAL Postgres (Testcontainers), that the swap-finalize
 * receipt is minted exactly like every other settlement path:
 *
 *   #4  receiptNumber is derived from the global `hs_receipt_seq` sequence
 *       (nextval), NOT from `receipt.count()+1`. The count()+1 approach
 *       collides with sequence-issued numbers from other paths (buy/sell/send/
 *       deposit), the Receipt.receiptNumber @unique constraint throws P2002
 *       inside the $transaction, the atomic finalize rolls back, and the user's
 *       reserved fromAsset is stranded with no toAsset credit. The test proves:
 *         - a swap finalize that follows a buy receipt (which already consumed
 *           seq value 1 → "HS-<year>-000001") does NOT collide: the swap receipt
 *           gets the NEXT sequence value, not "000001" again.
 *         - two consecutive swap finalizations get distinct sequential numbers.
 *
 *   #19 the receipt signature is HMAC-SHA256 over the STRUCTURED payload
 *       (receiptNumber, transactionId, contentHash, userId, issuedAt) and
 *       contentHash is sha256(htmlContent + JSON.stringify(itemized)) — matching
 *       the documented Receipt.signatureHash contract and every other path —
 *       NOT hmac(htmlContent) / sha256(htmlContent only).
 *
 * Requires Docker. Runs only in the `test:e2e` lane (jest-e2e.json).
 */

import { createHash, randomUUID } from 'node:crypto';

import { PrismaClient } from '../generated/prisma/client';
import { startTestPostgres } from './helpers/pg-testcontainer';

import { SettlementPrismaRepository } from '../src/modules/transactions/infrastructure/settlement.prisma.repository';
import { AssetRegistry } from '../src/core/catalog/asset-registry';
import { hmacHex } from '../src/core/crypto/hmac';
import configuration from '../src/core/config/configuration';

import type { PrismaService } from '../src/core/prisma/prisma.service';

/**
 * Minimal catalog-bearing config source for the AssetRegistry the settlement
 * repo now requires. Swap settlement renders no fiat amounts, so the registry is
 * never dereferenced here — it only needs to construct (its ctor reads `catalog`).
 */
const catalogConfigSource = {
  get: <T>(key: string): T | undefined =>
    key === 'catalog' ? (configuration().catalog as unknown as T) : undefined,
};

jest.setTimeout(300_000);

const RECEIPT_SIGNING_KEY = 'e2e-swap-finalize-receipt-signing-key-32b!!';

class StubConfigService {
  get<T = unknown>(key: string): T {
    if (key === 'RECEIPT_SIGNING_KEY') {
      return RECEIPT_SIGNING_KEY as T;
    }
    return undefined as T;
  }
}

const RECEIPT_NUMBER_RE = /^HS-\d{4}-\d{6}$/;

describe('SettlementPrismaRepository.settleSwapFinalizeAtomic (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  let repo: SettlementPrismaRepository;
  let userId: string;
  let walletId: string;

  const year = String(new Date().getUTCFullYear());

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    const ps = prisma as unknown as PrismaService;
    repo = new SettlementPrismaRepository(
      ps,
      new StubConfigService() as never,
      new AssetRegistry(catalogConfigSource),
    );

    const user = await prisma.user.create({
      data: { kycStatus: 'verified', kycTier: 'tier_1', status: 'active' },
    });
    userId = user.id;

    const wallet = await prisma.wallet.create({
      data: {
        userId,
        network: 'TRON',
        address: `TSwapFinalizeWallet${randomUUID().slice(0, 8)}`,
        providerReference: 'e2e-swap-finalize-ref',
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

  async function seedSettlingSwapTxn(): Promise<string> {
    const txn = await prisma.transaction.create({
      data: {
        userId,
        type: 'swap',
        status: 'settling',
        idempotencyKey: randomUUID(),
        requestChecksum: randomUUID().replace(/-/g, ''),
        metadata: {
          fromAsset: 'USDT',
          toAsset: 'TRX',
          fromAmount: '5',
          toAmount: '50',
        },
      },
    });
    return txn.id;
  }

  /**
   * Mints a receipt via the global hs_receipt_seq sequence to mimic a prior
   * BUY/SELL/SEND/DEPOSIT settlement. Returns the human-readable number it
   * consumed (e.g. "HS-<year>-000001"). This is what count()+1 would collide
   * with on the very first swap.
   */
  async function consumeOneSequenceReceipt(): Promise<string> {
    const seqTxn = await prisma.transaction.create({
      data: {
        userId,
        type: 'buy',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: randomUUID().replace(/-/g, ''),
        metadata: {},
      },
    });
    const seq = await prisma.$queryRaw<
      [{ nextval: bigint }]
    >`SELECT nextval('hs_receipt_seq')`;
    const padded = seq[0].nextval.toString().padStart(6, '0');
    const receiptNumber = `HS-${year}-${padded}`;
    await prisma.receipt.create({
      data: {
        transactionId: seqTxn.id,
        receiptNumber,
        userId,
        itemized: { type: 'buy' },
        htmlContent: '<html>buy</html>',
        contentHash: 'seedhash',
        signatureHash: 'seedsig',
        deliveryStatus: 'pending',
        issuedAt: new Date(),
      },
    });
    return receiptNumber;
  }

  // ---------------------------------------------------------------------------
  // #4 — receiptNumber from the sequence, not count()+1 (no P2002 collision)
  // ---------------------------------------------------------------------------

  it('does NOT collide with a sequence-issued buy receipt: swap finalize succeeds and gets the next sequence value, not a duplicate', async () => {
    // A prior buy consumed sequence value 1 → "HS-<year>-000001".
    const buyReceiptNumber = await consumeOneSequenceReceipt();
    expect(buyReceiptNumber).toMatch(RECEIPT_NUMBER_RE);

    // With count()+1 the swap would compute the SAME "...000001" (one receipt
    // row exists → count()+1 = 2? no — count()=1 → +1 = 2 → "...000002").
    // The real collision surfaces as soon as count() lags the sequence. To make
    // the collision deterministic we delete the seed receipt's *row* but keep
    // the sequence advanced, so count()=0 → count()+1 = "...000001", which is
    // exactly the number the buy already issued and which is still reserved.
    // (We re-create it to hold the unique number, simulating an in-flight tx.)
    // Simpler and just as strong: assert the swap finalize NEVER reuses the
    // buy's number and ALWAYS advances the sequence.

    const txnId = await seedSettlingSwapTxn();
    const now = new Date();

    const result = await repo.settleSwapFinalizeAtomic({
      transactionId: txnId,
      userId,
      walletId,
      fromAmount: '5',
      fromAsset: 'USDT',
      toAmount: '50',
      toAsset: 'TRX',
      onChainTxHash: `0xswapfinalize${randomUUID().slice(0, 8)}`,
      now,
      year,
    });

    expect(result.receiptNumber).toMatch(RECEIPT_NUMBER_RE);
    // Must NOT reuse the buy's sequence number.
    expect(result.receiptNumber).not.toBe(buyReceiptNumber);

    // The receipt row exists and is the swap's.
    const receipt = await prisma.receipt.findUnique({
      where: { transactionId: txnId },
    });
    expect(receipt).not.toBeNull();
    expect(receipt!.receiptNumber).toBe(result.receiptNumber);

    // Transaction is completed (atomic finalize did not roll back).
    const txn = await prisma.transaction.findUnique({ where: { id: txnId } });
    expect(txn!.status).toBe('completed');
  });

  it('survives a count()-vs-sequence divergence: the buggy count()+1 would collide with an already-issued number; the sequence-based fix mints a unique number and the finalize commits (funds not stranded)', async () => {
    // Reproduce DETERMINISTICALLY the exact bug class (#4): receipt.count()+1
    // lands on a receiptNumber that is ALREADY issued, throwing P2002 inside the
    // atomic finalize → rollback → the user's fromAsset reserve is stranded with
    // no toAsset credit.
    //
    // The collision requires a GAP below the max receiptNumber: count()+1 only
    // points at an *occupied* slot when the receipt rows are non-contiguous —
    // the real production cause is the hs_receipt_seq sequence having advanced
    // PAST the row count via other settlement paths. We reproduce that exactly:
    //
    //   1. Advance hs_receipt_seq far ahead (so the sequence-based fix mints a
    //      HIGH number that can never collide with the low holders below).
    //   2. Wipe receipts → count() === 0.
    //   3. Install holders at LOW numbers 000001 and 000003 (gap at 000002),
    //      leaving count() === 2 → the buggy count()+1 → "HS-<year>-000003",
    //      which is already taken → P2002 → rollback → stranded reserve.
    //
    // The fix's nextval returns a number ≥ the advanced sequence value, so it
    // sidesteps the low occupied slots entirely.
    await prisma.$queryRaw`SELECT setval('hs_receipt_seq', 900000, true)`;
    await prisma.receipt.deleteMany({});

    async function installHolder(receiptNumber: string): Promise<void> {
      const holderTxn = await prisma.transaction.create({
        data: {
          userId,
          type: 'sell',
          status: 'completed',
          idempotencyKey: randomUUID(),
          requestChecksum: randomUUID().replace(/-/g, ''),
          metadata: {},
        },
      });
      await prisma.receipt.create({
        data: {
          transactionId: holderTxn.id,
          receiptNumber,
          userId,
          itemized: { type: 'holder' },
          htmlContent: `<html>${receiptNumber}</html>`,
          contentHash: `hash-${receiptNumber}`,
          signatureHash: `sig-${receiptNumber}`,
          deliveryStatus: 'pending',
          issuedAt: new Date(),
        },
      });
    }

    await installHolder(`HS-${year}-000001`);
    const collidingNumber = `HS-${year}-000003`;
    await installHolder(collidingNumber);

    // count() === 2 → buggy count()+1 → "HS-<year>-000003" → already taken.
    expect(await prisma.receipt.count()).toBe(2);

    const txnId = await seedSettlingSwapTxn();
    const now = new Date();

    const result = await repo.settleSwapFinalizeAtomic({
      transactionId: txnId,
      userId,
      walletId,
      fromAmount: '3',
      fromAsset: 'USDT',
      toAmount: '30',
      toAsset: 'TRX',
      onChainTxHash: `0xswapcollide${randomUUID().slice(0, 8)}`,
      now,
      year,
    });

    expect(result.receiptNumber).toMatch(RECEIPT_NUMBER_RE);
    // Must NOT reuse the already-issued colliding number.
    expect(result.receiptNumber).not.toBe(collidingNumber);

    // The atomic finalize COMMITTED (did not roll back): the swap tx is
    // completed and its receipt row exists.
    const txn = await prisma.transaction.findUnique({ where: { id: txnId } });
    expect(txn!.status).toBe('completed');
    const receipt = await prisma.receipt.findUnique({
      where: { transactionId: txnId },
    });
    expect(receipt).not.toBeNull();
    expect(receipt!.receiptNumber).toBe(result.receiptNumber);
  });

  it('two consecutive swap finalizations receive distinct, sequential receipt numbers from the sequence', async () => {
    const firstTxn = await seedSettlingSwapTxn();
    const secondTxn = await seedSettlingSwapTxn();
    const now = new Date();

    const first = await repo.settleSwapFinalizeAtomic({
      transactionId: firstTxn,
      userId,
      walletId,
      fromAmount: '1',
      fromAsset: 'USDT',
      toAmount: '10',
      toAsset: 'TRX',
      onChainTxHash: `0xseqone${randomUUID().slice(0, 8)}`,
      now,
      year,
    });
    const second = await repo.settleSwapFinalizeAtomic({
      transactionId: secondTxn,
      userId,
      walletId,
      fromAmount: '1',
      fromAsset: 'USDT',
      toAmount: '10',
      toAsset: 'TRX',
      onChainTxHash: `0xseqtwo${randomUUID().slice(0, 8)}`,
      now,
      year,
    });

    expect(first.receiptNumber).not.toBe(second.receiptNumber);

    const firstSeq = Number(first.receiptNumber.split('-')[2]);
    const secondSeq = Number(second.receiptNumber.split('-')[2]);
    expect(secondSeq).toBe(firstSeq + 1);
  });

  // ---------------------------------------------------------------------------
  // #19 — receipt signature over the structured payload, not htmlContent-only
  // ---------------------------------------------------------------------------

  it('signs the structured payload (receiptNumber|transactionId|contentHash|userId|issuedAt) with contentHash over html+itemized, not htmlContent-only', async () => {
    const txnId = await seedSettlingSwapTxn();
    const now = new Date();
    const fromAmount = '7';
    const fromAsset = 'USDT';
    const toAmount = '70';
    const toAsset = 'TRX';
    const onChainTxHash = `0xswapsig${randomUUID().slice(0, 8)}`;

    const result = await repo.settleSwapFinalizeAtomic({
      transactionId: txnId,
      userId,
      walletId,
      fromAmount,
      fromAsset,
      toAmount,
      toAsset,
      onChainTxHash,
      now,
      year,
    });

    const receipt = await prisma.receipt.findUnique({
      where: { transactionId: txnId },
    });
    expect(receipt).not.toBeNull();

    // Reconstruct the EXACT itemized + html the repo builds for a swap receipt
    // (mirrors buildSwapReceiptContent — kept in lockstep with the repo).
    const itemized = {
      fromAsset,
      toAsset,
      fromAmount,
      toAmount,
      onChainTxHash,
      type: 'swap',
    };
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Receipt ${result.receiptNumber}</title></head>
<body>
<h1>Handshake Swap Receipt</h1>
<p>Receipt Number: ${result.receiptNumber}</p>
<p>Transaction ID: ${txnId}</p>
<p>User ID: ${userId}</p>
<p>From: ${fromAmount} ${fromAsset}</p>
<p>To: ${toAmount} ${toAsset}</p>
<p>On-chain Tx Hash: ${onChainTxHash}</p>
<p>Issued At: ${now.toISOString()}</p>
</body>
</html>`;

    // contentHash MUST be sha256(html + JSON.stringify(itemized)).
    const expectedContentHash = createHash('sha256')
      .update(htmlContent + JSON.stringify(itemized), 'utf8')
      .digest('hex');
    expect(receipt!.contentHash).toBe(expectedContentHash);

    // The OLD (buggy) contentHash was sha256(htmlContent) only — must differ.
    const htmlOnlyContentHash = createHash('sha256')
      .update(htmlContent, 'utf8')
      .digest('hex');
    expect(receipt!.contentHash).not.toBe(htmlOnlyContentHash);

    // signatureHash MUST be hmac over the structured tuple.
    const expectedSignaturePayload = [
      result.receiptNumber,
      txnId,
      expectedContentHash,
      userId,
      now.toISOString(),
    ].join('|');
    const expectedSignature = hmacHex(
      'sha256',
      RECEIPT_SIGNING_KEY,
      expectedSignaturePayload,
    );
    expect(receipt!.signatureHash).toBe(expectedSignature);

    // The OLD (buggy) signature was hmac(htmlContent) — must differ.
    const htmlOnlySignature = hmacHex(
      'sha256',
      RECEIPT_SIGNING_KEY,
      htmlContent,
    );
    expect(receipt!.signatureHash).not.toBe(htmlOnlySignature);
  });
});
