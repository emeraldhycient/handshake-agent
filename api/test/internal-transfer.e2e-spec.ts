/**
 * Internal (user→user, PayID) transfer vertical — end-to-end acceptance test
 * (Spec 2, Task 10). CLOSES the funds-safety coverage gap: Tasks 6/7 unit-test
 * the executor with a MOCKED settlement repo, so the REAL atomic ledger
 * double-entry, the in-atomic sender-balance guard, and the
 * idempotency/advisory-lock guards are unverified until this suite runs the
 * full HTTP stack against real Postgres.
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and proves
 * Tasks 1-9 end-to-end over real HTTP + real Postgres:
 *
 *   1. Happy path A→B: an `@handle` send → internal_transfer proposal (handle
 *      resolved SERVER-SIDE, §3.1) → authorize (step-up) → execute → INSTANT
 *      completed. Balanced double-entry (A −5, B +5, legs sum 0), ONE
 *      Transaction + ONE Receipt, NO walletProvider.withdraw, NO onchain
 *      SettlementOutbox, B's TRON wallet auto-provisioned. + velocity attributed
 *      to the SENDER, never the recipient (Task 8 folded in).
 *   2. /auth/me carries a valid payId (Task 3).
 *   3. Self-send (@A.payId) → clarification, NO proposal (§3.1 no-misroute).
 *   4. Unknown handle → clarification, NO proposal.
 *   5. Sequential replay: a completed transfer cannot be re-executed — no second
 *      post (exactly ONE of everything; A debited once, B credited once).
 *   6. Concurrent double-execute (one proposal, two parallel executes): the
 *      invariant holds regardless of which layer blocks the loser
 *      (single-use directive / status guard / in-atomic idempotency).
 *   7. Concurrent drain (A→B & A→C, each 5, A seeded 5): at most one commits, A
 *      never goes negative, the loser fails cleanly (in-atomic balance guard).
 *
 * Bootstrap (env vars, Testcontainers Postgres, the four external-edge fakes)
 * and the seed / authorize→execute helpers are copied from
 * send-raw-address.e2e-spec.ts (the Spec-1 send surface). A focused,
 * repo-level companion (settleInternalTransferAtomic in isolation, both
 * WalletBalance snapshots, deterministic in-atomic guard) lives in
 * internal-transfer-settle.e2e-spec.ts.
 */

import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// supertest is a CommonJS module
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { INestApplication } from '@nestjs/common';

// Port symbol imports — these do NOT transitively import AppModule or trigger
// ConfigModule.forRoot(). They export only const symbols and interfaces.
import { LLM_PROVIDER } from '../src/modules/agent/application/ports/agent.port';
import { WALLET_PROVIDER } from '../src/modules/wallets/application/ports/wallet-provider.port';
import { PAYMENT_PROVIDER } from '../src/modules/treasury/application/ports/payment-provider.port';
import { WHATSAPP_SENDER } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';
import type { LlmProvider } from '../src/modules/agent/core/ports/llm-provider.port';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';
import type { IWhatsAppSender } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';

import { WalletService } from '../src/modules/wallets/application/wallet.service';
import { AssetRegistry } from '../src/core/catalog/asset-registry';
import { seedRegistryAssets } from './helpers/seed-registry-assets';
import { mintTier1User } from './helpers/mint-verified-user';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_ROOT = join(__dirname, '..');
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-internal-xfer';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-internal-xfer-fake';
const WA_APP_SECRET = 'e2e-internal-xfer-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-internal-xfer';

const FAKE_WALLET_ADDRESS = 'TInternalXferFakeWalletAddress12xxx';
const FAKE_BLOCKRADAR_REF = 'fake-blockradar-ref-e2e-internal-xfer';
const FAKE_WITHDRAW_REF = 'e2e-onchain-withdraw-ref-internal-xfer';

const PIN = '1357';

// ===========================================================================
// THE TEST SUITE
// ===========================================================================

describe('Internal transfer vertical — e2e (AppModule, Testcontainers Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stopContainer: () => Promise<void>;
  let fakeLlmProvider: jest.Mocked<LlmProvider>;
  let fakeWalletProvider: jest.Mocked<IWalletProvider>;

  // ── beforeAll: set env → import AppModule → boot ───────────────────────────

  beforeAll(async () => {
    // 1. Boot Postgres container and apply migrations
    const container = await new PostgreSqlContainer(
      'postgres:16-alpine',
    ).start();
    const dbUrl = container.getConnectionUri();

    execSync('node_modules/.bin/prisma migrate deploy', {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'inherit',
    });

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: dbUrl }),
    });
    await prisma.$connect();

    stopContainer = async () => {
      await prisma.$disconnect();
      await container.stop();
    };

    // 2. Set ALL required env vars BEFORE importing AppModule.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl,
      WHATSAPP_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: WA_ACCESS_TOKEN,
      WHATSAPP_APP_SECRET: WA_APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: WA_VERIFY_TOKEN,
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-internal-xfer-directive-key-32bytes!',
      RECEIPT_SIGNING_KEY: 'e2e-internal-xfer-receipt-signing-key32b!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-internal-xfer',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-internal-xfer',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-internal-xfer',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-internal-xfer',
      JWT_SECRET: 'e2e-internal-xfer-jwt-secret-at-least-32-bytes!!',
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    // Ensure ANTHROPIC_API_KEY is absent (not empty string) to pass optional validation
    delete process.env.ANTHROPIC_API_KEY;

    // 3. Dynamic import of AppModule (happens AFTER env vars are set above).
    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    // 4. Build fake providers with correct interface shapes.
    //    The LLM fake is reconfigured per-test via mockResolvedValueOnce.
    fakeLlmProvider = {
      extractIntent: jest.fn().mockResolvedValue({
        action: 'none',
        clarification: 'default fake — reconfigure per test',
      }),
    };

    // Unique address per call — multiple users provision wallets across the
    // tests, so a fixed address would violate the wallet unique constraint.
    let addrSeq = 0;
    fakeWalletProvider = {
      provisionAddress: jest.fn().mockImplementation(() => {
        addrSeq += 1;
        return Promise.resolve({
          address: `${FAKE_WALLET_ADDRESS}${addrSeq.toString().padStart(4, '0')}`,
          providerReference: `${FAKE_BLOCKRADAR_REF}-${addrSeq}`,
        });
      }),
      getBalance: jest.fn().mockResolvedValue({
        available: '0',
        pending: '0',
        asset: 'USDT',
      }),
      // An internal transfer NEVER calls withdraw — asserted in test 1. The
      // stub is shaped correctly regardless so a stray call would not crash.
      withdraw: jest.fn().mockResolvedValue({
        providerReference: FAKE_WITHDRAW_REF,
        status: 'pending' as const,
      }),
      getWithdrawalStatus: jest
        .fn()
        .mockResolvedValue({ status: 'pending' as const }),
      listWalletAssets: jest.fn().mockResolvedValue([
        {
          assetId: 'e2e-usdt-tron-asset-id',
          symbol: 'USDT',
          name: 'Tether USD',
          network: 'TRON',
          contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
          decimals: 6,
          isMainnet: false,
        },
      ]),
    };

    const fakePaymentProvider: jest.Mocked<IPaymentProvider> = {
      createCollection: jest.fn().mockResolvedValue({
        accountNumber: '0091234568',
        bankName: 'Internal Xfer Test MFB',
        providerRef: 'flw_fake_ref_internal_xfer_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_internal_xfer_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.it.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.it.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.it.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.it.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.it.e2e' }),
    };

    // 5. Compile NestJS TestingModule with provider overrides
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER)
      .useValue(fakeLlmProvider)
      .overrideProvider(WALLET_PROVIDER)
      .useValue(fakeWalletProvider)
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(fakePaymentProvider)
      .overrideProvider(WHATSAPP_SENDER)
      .useValue(fakeSender)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();

    // Seed the AssetRegistry's provider-id overlay (USDT/TRX on TRON) so any
    // asset-provider-id lookup resolves — CatalogSyncService never ran against
    // a real Blockradar in this suite. Mirrors send-raw-address.e2e-spec.ts.
    seedRegistryAssets(app.get(AssetRegistry, { strict: false }));
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await stopContainer?.();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  let userSeq = 0;

  /**
   * Mints a tier_1 user (email-OTP signup, PIN set), bumps to tier_2 (the
   * crypto.transfer capability floor, §3.3), and reads the PayID minted at
   * signup (Task 3). A monotonic counter + Date.now keeps emails — and thus the
   * derived PayIDs — unique across the run.
   */
  async function mintTransferUser(
    role: string,
  ): Promise<{ accessToken: string; userId: string; payId: string }> {
    userSeq += 1;
    const email = `${role}${userSeq}_${Date.now()}@test.com`.toLowerCase();
    const { accessToken, userId } = await mintTier1User(app, {
      email,
      pin: PIN,
    });
    await prisma.user.update({
      where: { id: userId },
      data: { kycTier: 'tier_2' },
    });
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { payId: true },
    });
    if (!row?.payId) throw new Error(`user '${role}' has no minted payId`);
    return { accessToken, userId, payId: row.payId };
  }

  /**
   * Seeds a USDT credit on the user's TRON wallet ledger (as a settled buy
   * would), so a transfer proposal passes the balance check. Mirrors
   * `seedUsdtBalance` in send-raw-address.e2e-spec.ts. Returns the wallet id.
   */
  async function seedUsdtBalance(
    userId: string,
    amount: number,
  ): Promise<string> {
    const walletService = app.get(WalletService, { strict: false });
    await walletService.getOrProvisionNetworkWallet(userId, 'TRON');

    const wallet = await prisma.wallet.findFirst({
      where: { userId, network: 'TRON' },
      select: { id: true },
    });
    if (wallet === null) throw new Error('no TRON wallet for user');

    const seedTxn = await prisma.transaction.create({
      data: {
        userId,
        type: 'buy',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: 'seed',
        fxRateSnapshot: '1600',
        metadata: {},
        pinVerifiedAt: new Date(),
      },
    });

    const latest = await prisma.ledgerEntry.findFirst({
      where: { accountType: 'user_wallet', accountId: wallet.id },
      orderBy: { sequence: 'desc' },
    });
    const seq = (latest?.sequence ?? 0) + 1;
    const before = latest?.balanceAfter ? Number(latest.balanceAfter) : 0;

    await prisma.ledgerEntry.create({
      data: {
        transactionId: seedTxn.id,
        accountType: 'user_wallet',
        accountId: wallet.id,
        currency: 'USDT',
        direction: 'credit',
        amount: amount.toFixed(6),
        description: 'seed credit for internal-transfer e2e',
        balanceAfter: (before + amount).toFixed(6),
        sequence: seq,
        postedAt: new Date(),
      },
    });
    return wallet.id;
  }

  /**
   * Drives an `@handle` internal-transfer turn: stubs the LLM to emit a
   * `send_crypto` intent naming the PUBLIC handle (resolved server-side, §3.1 —
   * the model never supplies a destination), then POSTs /chat/messages with NO
   * `sendDestination` in the body. Returns the supertest response.
   */
  async function postHandleSend(
    accessToken: string,
    handle: string,
    amount: string,
  ): Promise<import('supertest').Response> {
    fakeLlmProvider.extractIntent.mockResolvedValueOnce({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: amount,
      network: 'TRON',
      recipientNickname: `@${handle}`,
    });
    return request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: `send ${amount} USDT to @${handle}` })
      .expect(200);
  }

  /** Issues a step-up directive for the proposal; returns { directiveId, nonce }. */
  async function authorizeOnly(
    accessToken: string,
    proposalId: string,
  ): Promise<{ directiveId: string; nonce: string }> {
    const authRes = await request(app.getHttpServer())
      .post(`/chat/proposals/${proposalId}/authorize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    return authRes.body as { directiveId: string; nonce: string };
  }

  /** Fires a single execute (no status assertion); resolves with the Response. */
  function executeOnce(
    accessToken: string,
    proposalId: string,
    directiveId: string,
    nonce: string,
  ): Promise<import('supertest').Response> {
    return request(app.getHttpServer())
      .post(`/chat/proposals/${proposalId}/execute`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        directiveId,
        nonce,
        pin: PIN,
        idempotencyKey: randomUUID(),
      });
  }

  /** Authorizes the proposal then executes it; resolves with the execute Response. */
  async function authorizeAndExecute(
    accessToken: string,
    proposalId: string,
  ): Promise<import('supertest').Response> {
    const { directiveId, nonce } = await authorizeOnly(accessToken, proposalId);
    return executeOnce(accessToken, proposalId, directiveId, nonce);
  }

  /** Latest authoritative USDT ledger balance for a wallet (0 if no entries). */
  async function ledgerBalance(walletId: string): Promise<number> {
    const row = await prisma.ledgerEntry.findFirst({
      where: {
        accountType: 'user_wallet',
        accountId: walletId,
        currency: 'USDT',
      },
      orderBy: { sequence: 'desc' },
      select: { balanceAfter: true },
    });
    return row ? Number(row.balanceAfter) : 0;
  }

  /** Resolves a user's TRON wallet id, or null if none provisioned. */
  async function tronWalletId(userId: string): Promise<string | null> {
    const wallet = await prisma.wallet.findFirst({
      where: { userId, network: 'TRON' },
      select: { id: true },
    });
    return wallet?.id ?? null;
  }

  // ===========================================================================
  // TEST 1 — happy path A→B (+ velocity attribution, Task 8 folded in)
  // ===========================================================================

  it('sends 5 USDT A→B via @handle: internal_transfer proposal → instant completed, balanced double-entry, one Transaction + Receipt, no withdraw/outbox, recipient wallet auto-provisioned, velocity to sender', async () => {
    const a = await mintTransferUser('a');
    const b = await mintTransferUser('b');

    // B has NO wallet before the transfer — the recipient wallet must be
    // auto-provisioned by the internal-transfer path.
    expect(await tronWalletId(b.userId)).toBeNull();

    const aWalletId = await seedUsdtBalance(a.userId, 100);
    const aBalanceBefore = await ledgerBalance(aWalletId);
    expect(aBalanceBefore).toBe(100);

    // POST /chat/messages — the @handle is resolved SERVER-SIDE (§3.1); no
    // sendDestination in the body.
    const res = await postHandleSend(a.accessToken, b.payId, '5');
    const outcome = (
      res.body as { outcome: { kind: string; proposalId?: string } }
    ).outcome;
    expect(outcome.kind).toBe('proposal');
    expect(outcome.proposalId).toBeTruthy();
    const proposalId = outcome.proposalId!;

    // The PERSISTED proposal is a genuine internal_transfer resolved to B's
    // userId — NO on-chain address; destinationKind internal_user.
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
    });
    expect(proposal).not.toBeNull();
    expect(proposal?.type).toBe('internal_transfer');
    const params = proposal?.parameters as Record<string, unknown>;
    expect(params.destinationKind).toBe('internal_user');
    expect(params.recipientUserId).toBe(b.userId);
    expect(params.toAddress).toBeUndefined();

    // B's TRON wallet was auto-provisioned at propose time.
    const bWalletId = await tronWalletId(b.userId);
    expect(bWalletId).not.toBeNull();

    // Authorize (step-up) + execute — INSTANT settle.
    const execRes = await authorizeAndExecute(a.accessToken, proposalId);
    expect(execRes.status).toBe(201);
    expect((execRes.body as { status: string }).status).toBe('completed');

    // Balances: A −5, B +5.
    const aBalanceAfter = await ledgerBalance(aWalletId);
    const bBalanceAfter = await ledgerBalance(bWalletId!);
    expect(aBalanceBefore - aBalanceAfter).toBe(5);
    expect(aBalanceAfter).toBe(95);
    expect(bBalanceAfter).toBe(5);

    // Exactly ONE Transaction (internal_transfer, sender-owned).
    const txns = await prisma.transaction.findMany({
      where: { userId: a.userId, type: 'internal_transfer' },
    });
    expect(txns).toHaveLength(1);
    const txnId = txns[0].id;

    // The two ledger legs sum to exactly 0 (amount is signed: −5 debit, +5 credit).
    const legs = await prisma.ledgerEntry.findMany({
      where: { transactionId: txnId },
    });
    expect(legs).toHaveLength(2);
    const legSum = legs.reduce((acc, l) => acc + Number(l.amount), 0);
    expect(legSum).toBe(0);
    const senderLeg = legs.find((l) => l.accountId === aWalletId);
    const recipientLeg = legs.find((l) => l.accountId === bWalletId);
    expect(Number(senderLeg?.amount)).toBe(-5);
    expect(senderLeg?.direction).toBe('debit');
    expect(Number(recipientLeg?.amount)).toBe(5);
    expect(recipientLeg?.direction).toBe('credit');

    // Exactly ONE Receipt (the sender's transaction).
    const receipts = await prisma.receipt.findMany({
      where: { transactionId: txnId },
    });
    expect(receipts).toHaveLength(1);

    // NO on-chain withdraw was called and NO onchain SettlementOutbox row exists.
    expect(fakeWalletProvider.withdraw).not.toHaveBeenCalled();
    const outbox = await prisma.settlementOutbox.findMany({
      where: { transactionId: txnId },
    });
    expect(outbox).toHaveLength(0);

    // Velocity attribution (Task 8): the SENDER's counters incremented; the
    // recipient's did not.
    const senderCounters = await prisma.velocityCounter.findMany({
      where: { userId: a.userId },
    });
    const recipientCounters = await prisma.velocityCounter.findMany({
      where: { userId: b.userId },
    });
    expect(senderCounters.length).toBeGreaterThan(0);
    expect(recipientCounters).toHaveLength(0);
  }, 120_000);

  // ===========================================================================
  // TEST 2 — /auth/me carries a valid payId
  // ===========================================================================

  it('/auth/me carries a payId matching the handle format', async () => {
    const a = await mintTransferUser('me');
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    const payId = (res.body as { payId?: string }).payId;
    expect(payId).toBeTruthy();
    expect(payId).toMatch(/^[a-z0-9_]{3,30}$/);
    expect(payId).toBe(a.payId);
  }, 120_000);

  // ===========================================================================
  // TEST 3 — self-send → clarification, NO proposal (§3.1 no-misroute)
  // ===========================================================================

  it('a self-send to your own @handle → clarification, NO proposal', async () => {
    const a = await mintTransferUser('self');

    const res = await postHandleSend(a.accessToken, a.payId, '5');
    const outcome = (res.body as { outcome: { kind: string } }).outcome;
    expect(outcome.kind).toBe('clarification');

    const proposals = await prisma.proposal.count({
      where: { userId: a.userId, type: 'internal_transfer' },
    });
    expect(proposals).toBe(0);
  }, 120_000);

  // ===========================================================================
  // TEST 4 — unknown handle → clarification, NO proposal
  // ===========================================================================

  it('an unknown @handle → clarification, NO proposal', async () => {
    const a = await mintTransferUser('unknown');
    const nobody = `nobody_${Date.now()}`;

    const res = await postHandleSend(a.accessToken, nobody, '5');
    const outcome = (res.body as { outcome: { kind: string } }).outcome;
    expect(outcome.kind).toBe('clarification');

    const proposals = await prisma.proposal.count({
      where: { userId: a.userId, type: 'internal_transfer' },
    });
    expect(proposals).toBe(0);
  }, 120_000);

  // ===========================================================================
  // TEST 5 — sequential replay: a completed transfer cannot post twice
  // ===========================================================================

  it('a completed transfer cannot be re-executed: the replay creates no second post (at-most-once)', async () => {
    const a = await mintTransferUser('replaya');
    const b = await mintTransferUser('replayb');
    const aWalletId = await seedUsdtBalance(a.userId, 100);

    const res = await postHandleSend(a.accessToken, b.payId, '5');
    const proposalId = (res.body as { outcome: { proposalId: string } }).outcome
      .proposalId;

    // First execute — posts.
    const firstExec = await authorizeAndExecute(a.accessToken, proposalId);
    expect(firstExec.status).toBe(201);
    expect((firstExec.body as { status: string }).status).toBe('completed');

    const bWalletId = (await tronWalletId(b.userId))!;
    expect(await ledgerBalance(aWalletId)).toBe(95);
    expect(await ledgerBalance(bWalletId)).toBe(5);

    // Second attempt on the SAME proposal — authorize again (new directive) then
    // execute again. The proposal is now terminal ('executed'), so the money
    // path refuses a second post at SOME layer (the controller's proposal-status
    // guard fires first for a sequential replay; the engine's in-atomic
    // idempotency guard is the defence-in-depth for the CONCURRENT case, test 6).
    // Either way: exactly ONE of everything must remain — no second post.
    let secondAttemptRejected = false;
    try {
      const { directiveId, nonce } = await authorizeOnly(
        a.accessToken,
        proposalId,
      );
      const secondExec = await executeOnce(
        a.accessToken,
        proposalId,
        directiveId,
        nonce,
      );
      // A 2xx here would only be acceptable as an idempotent replay of the PRIOR
      // result — never a fresh second post; the DB invariant below is the
      // authoritative check either way.
      secondAttemptRejected = secondExec.status >= 400;
    } catch {
      // authorize itself may 409 the terminal proposal — that is a clean refusal.
      secondAttemptRejected = true;
    }
    expect(secondAttemptRejected).toBe(true);

    // Funds-safety invariant: NO second post — still exactly one of everything,
    // A debited once, B credited once.
    const txns = await prisma.transaction.findMany({
      where: { userId: a.userId, type: 'internal_transfer' },
    });
    expect(txns).toHaveLength(1);
    const legs = await prisma.ledgerEntry.findMany({
      where: { transactionId: txns[0].id },
    });
    expect(legs).toHaveLength(2);
    const receipts = await prisma.receipt.findMany({
      where: { transactionId: txns[0].id },
    });
    expect(receipts).toHaveLength(1);
    expect(await ledgerBalance(aWalletId)).toBe(95);
    expect(await ledgerBalance(bWalletId)).toBe(5);
  }, 120_000);

  // ===========================================================================
  // TEST 6 — concurrent double-execute (one proposal, two parallel executes)
  // ===========================================================================

  it('two parallel executes of ONE proposal post exactly once (advisory lock + single-use directive + in-atomic idempotency)', async () => {
    const a = await mintTransferUser('racea');
    const b = await mintTransferUser('raceb');
    const aWalletId = await seedUsdtBalance(a.userId, 100);

    const res = await postHandleSend(a.accessToken, b.payId, '5');
    const proposalId = (res.body as { outcome: { proposalId: string } }).outcome
      .proposalId;

    // Authorize ONCE, then fire TWO executes in parallel with the SAME
    // directiveId + nonce + proposalId.
    const { directiveId, nonce } = await authorizeOnly(
      a.accessToken,
      proposalId,
    );
    const [r1, r2] = await Promise.all([
      executeOnce(a.accessToken, proposalId, directiveId, nonce),
      executeOnce(a.accessToken, proposalId, directiveId, nonce),
    ]);

    const completed = [r1, r2].filter(
      (r) =>
        r.status === 201 &&
        (r.body as { status?: string }).status === 'completed',
    );
    // At least one commits; the loser is blocked at SOME layer (single-use
    // directive / status guard / in-atomic idempotency) — never a second post.
    expect(completed.length).toBeGreaterThanOrEqual(1);

    const bWalletId = (await tronWalletId(b.userId))!;

    // The INVARIANT — exactly one ledger pair, one Transaction, one Receipt;
    // A debited exactly once (95, never negative), B credited exactly once (5).
    const txns = await prisma.transaction.findMany({
      where: { userId: a.userId, type: 'internal_transfer' },
    });
    expect(txns).toHaveLength(1);
    const legs = await prisma.ledgerEntry.findMany({
      where: { transactionId: txns[0].id },
    });
    expect(legs).toHaveLength(2);
    expect(legs.reduce((acc, l) => acc + Number(l.amount), 0)).toBe(0);
    const receipts = await prisma.receipt.findMany({
      where: { transactionId: txns[0].id },
    });
    expect(receipts).toHaveLength(1);
    const aFinal = await ledgerBalance(aWalletId);
    expect(aFinal).toBe(95);
    expect(aFinal).toBeGreaterThanOrEqual(0);
    expect(await ledgerBalance(bWalletId)).toBe(5);
  }, 120_000);

  // ===========================================================================
  // TEST 7 — concurrent drain of the sender (A→B and A→C, only 5 available)
  // ===========================================================================

  it('two concurrent transfers draining the sender: at most one commits, sender never goes negative, the loser fails cleanly', async () => {
    const a = await mintTransferUser('draina');
    const b = await mintTransferUser('drainb');
    const c = await mintTransferUser('drainc');
    // Exactly 5 USDT — only ONE of the two 5-USDT transfers can be funded.
    const aWalletId = await seedUsdtBalance(a.userId, 5);

    // Build TWO proposals (each its own directive) — both pass the propose-time
    // balance check because nothing is debited until execute.
    const resB = await postHandleSend(a.accessToken, b.payId, '5');
    const proposalB = (resB.body as { outcome: { proposalId: string } }).outcome
      .proposalId;
    const resC = await postHandleSend(a.accessToken, c.payId, '5');
    const proposalC = (resC.body as { outcome: { proposalId: string } }).outcome
      .proposalId;

    const authB = await authorizeOnly(a.accessToken, proposalB);
    const authC = await authorizeOnly(a.accessToken, proposalC);

    const [rB, rC] = await Promise.all([
      executeOnce(a.accessToken, proposalB, authB.directiveId, authB.nonce),
      executeOnce(a.accessToken, proposalC, authC.directiveId, authC.nonce),
    ]);

    const completed = [rB, rC].filter(
      (r) =>
        r.status === 201 &&
        (r.body as { status?: string }).status === 'completed',
    );
    const failed = [rB, rC].filter((r) => r.status >= 400);
    // AT MOST one commits; the other fails cleanly (no partial post).
    expect(completed.length).toBeLessThanOrEqual(1);
    expect(completed.length + failed.length).toBe(2);

    // Sender never goes negative and ends at >= 0.
    const aFinal = await ledgerBalance(aWalletId);
    expect(aFinal).toBeGreaterThanOrEqual(0);

    // Exactly one committed internal_transfer for A matches the success count;
    // its legs sum to 0 and exactly one recipient was credited 5.
    const txns = await prisma.transaction.findMany({
      where: { userId: a.userId, type: 'internal_transfer' },
    });
    expect(txns.length).toBe(completed.length);
    if (completed.length === 1) {
      expect(aFinal).toBe(0);
      const legs = await prisma.ledgerEntry.findMany({
        where: { transactionId: txns[0].id },
      });
      expect(legs).toHaveLength(2);
      expect(legs.reduce((acc, l) => acc + Number(l.amount), 0)).toBe(0);
      const bWalletId = await tronWalletId(b.userId);
      const cWalletId = await tronWalletId(c.userId);
      const bBal = bWalletId ? await ledgerBalance(bWalletId) : 0;
      const cBal = cWalletId ? await ledgerBalance(cWalletId) : 0;
      expect(bBal + cBal).toBe(5);
      expect([bBal, cBal].filter((x) => x === 5)).toHaveLength(1);
    }
  }, 120_000);
});
