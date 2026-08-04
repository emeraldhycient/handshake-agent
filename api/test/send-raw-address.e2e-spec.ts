/**
 * Raw-address send vertical — end-to-end acceptance test (Task 6).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and proves
 * Tasks 1-5 end-to-end over real HTTP + real Postgres:
 *
 *   1. Raw send end-to-end (no saved beneficiary) — `sendDestination` on the
 *      chat request drives `createSendProposal`'s raw_address branch → 200,
 *      outcome.kind === 'proposal', txType === 'send' (never a 500).
 *   2. Misroute regression (§3.1 no-misroute proof, PRODUCT DECISION Option A):
 *      a BARE send — no id/nickname/pasted-address confirmation, NO
 *      `sendDestination` — with a raw address token in the message text AND a
 *      DEFAULT saved crypto beneficiary on file must surface the
 *      `needs_beneficiary` card (allowRawSend, prefillAddress), NEVER route to
 *      the default beneficiary. No proposal is created.
 *   3. Save-before persists: proposal → authorize → execute with
 *      `sendDestination.saveAsBeneficiary=true` → once the send settles, a
 *      `Beneficiary` row exists for the raw address (Task 2's save-on-success
 *      in `ExecutionService.executeSend`).
 *
 * Bootstrap (env vars, Testcontainers Postgres, the four external-edge fakes)
 * copied verbatim from web-chat.e2e-spec.ts. Balance-seeding and the
 * authorize→execute helper mirror web-sell-send.e2e-spec.ts /
 * send-vertical.e2e-spec.ts.
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
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-send-raw';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-send-raw-fake';
const WA_APP_SECRET = 'e2e-send-raw-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-send-raw';

const FAKE_WALLET_ADDRESS = 'TSendRawFakeWalletAddress1234xxx';
const FAKE_BLOCKRADAR_REF = 'fake-blockradar-ref-e2e-send-raw';
const FAKE_WITHDRAW_REF = 'e2e-onchain-withdraw-ref-send-raw';

// Four distinct, syntactically valid TRON addresses (^T[1-9A-HJ-NP-Za-km-z]{33}$,
// 34 chars, base58 — no 0/O/I/l) — one per role so wallets/beneficiaries never
// collide across the three tests.
const RAW_SEND_ADDRESS = 'Th82pJGF9p7kpzb6eU326EFZf2cDnimbTF';
const DEFAULT_BENEFICIARY_ADDRESS = 'TVeJtx1qtBmUNJAEqN76R7PwPfHt3oWb8R';
const MISROUTE_PASTED_ADDRESS = 'T6cKvhgyxQdDn53jFrK6wFx7RJWhvQBQPE';
const SAVE_BEFORE_ADDRESS = 'TjJmki5fhBboGBWRJhmcFkMvrr4Fu3tMSJ';

// ===========================================================================
// THE TEST SUITE
// ===========================================================================

describe('Raw-address send vertical — e2e (AppModule, Testcontainers Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stopContainer: () => Promise<void>;
  let fakeLlmProvider: jest.Mocked<LlmProvider>;

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
      DIRECTIVE_SIGNING_KEY: 'e2e-send-raw-directive-key-32bytes!',
      RECEIPT_SIGNING_KEY: 'e2e-send-raw-receipt-signing-key-32b!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-send-raw',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-send-raw',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-send-raw',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-send-raw',
      JWT_SECRET: 'e2e-send-raw-jwt-secret-at-least-32-bytes!!',
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
    const fakeWalletProvider: jest.Mocked<IWalletProvider> = {
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
      // Correct WithdrawOutput shape (providerReference + status) — the real
      // interface (`api/src/modules/wallets/application/ports/wallet-provider.port.ts`),
      // NOT the incomplete `{ txHash, reference }` shape used by web-chat.e2e-spec.ts
      // (which never actually drives an executed send). Test 3 exercises the real
      // withdraw call inside ExecutionService.executeSend, which reads
      // `withdrawOutput.providerReference`.
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
        bankName: 'Send Raw Test MFB',
        providerRef: 'flw_fake_ref_send_raw_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_send_raw_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      findPayoutByReference: jest.fn().mockResolvedValue(null),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.sr.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.sr.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.sr.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.sr.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.sr.e2e' }),
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

    // Seed the AssetRegistry's provider-id overlay (USDT/TRX on TRON) so the
    // withdraw path's `assetRegistry.assetProviderId(asset, 'blockradar')`
    // resolves — CatalogSyncService never ran against a real Blockradar in this
    // suite. Mirrors web-sell-send.e2e-spec.ts.
    seedRegistryAssets(app.get(AssetRegistry, { strict: false }));
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await stopContainer?.();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Mints a tier_1 user, then bumps to tier_2 (crypto.send capability). */
  async function setupVerifiedUser(
    email: string,
    pin = '1357',
  ): Promise<{ accessToken: string; userId: string }> {
    const { accessToken, userId } = await mintTier1User(app, { email, pin });
    await prisma.user.update({
      where: { id: userId },
      data: { kycTier: 'tier_2' },
    });
    return { accessToken, userId };
  }

  /**
   * Seeds a USDT credit on the user's TRON wallet ledger (as a settled buy
   * would), so a send proposal passes `createSendProposal`'s balance check
   * (step 3 — `InsufficientBalanceError` on zero balance). Mirrors
   * `seedUsdtBalance` in web-sell-send.e2e-spec.ts / send-vertical.e2e-spec.ts.
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
        description: 'seed credit for send-raw-address e2e',
        balanceAfter: (before + amount).toFixed(6),
        sequence: seq,
        postedAt: new Date(),
      },
    });
    return wallet.id;
  }

  /** Authorizes the proposal then executes it; resolves with the execute Response. */
  async function authorizeAndExecute(
    accessToken: string,
    proposalId: string,
  ): Promise<import('supertest').Response> {
    const authRes = await request(app.getHttpServer())
      .post(`/chat/proposals/${proposalId}/authorize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    const { directiveId, nonce } = authRes.body as {
      directiveId: string;
      nonce: string;
    };

    return request(app.getHttpServer())
      .post(`/chat/proposals/${proposalId}/execute`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        directiveId,
        nonce,
        pin: '1357',
        idempotencyKey: randomUUID(),
      });
  }

  // ===========================================================================
  // TEST 1 — raw send end-to-end
  // ===========================================================================

  it('sends to a raw address end-to-end (no saved beneficiary) — 200, never 500', async () => {
    const { accessToken, userId } = await setupVerifiedUser(
      `raw_${Date.now()}@test.com`,
    );
    await seedUsdtBalance(userId, 100);

    fakeLlmProvider.extractIntent.mockResolvedValueOnce({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '2',
      network: 'TRON',
    });

    const res = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        text: `send 2 USDT to ${RAW_SEND_ADDRESS}`,
        sendDestination: { address: RAW_SEND_ADDRESS, network: 'TRON' },
      })
      .expect(200);

    const body = res.body as {
      outcome: { kind: string; txType?: string; proposalId?: string };
    };
    expect(body.outcome.kind).toBe('proposal');
    expect(body.outcome.txType).toBe('send');
    expect(body.outcome.proposalId).toBeTruthy();

    // The proposal was genuinely persisted for the raw destination — not a
    // saved beneficiary lookup.
    const proposal = await prisma.proposal.findUnique({
      where: { id: body.outcome.proposalId! },
    });
    expect(proposal).not.toBeNull();
    expect(proposal?.type).toBe('send');
    const params = proposal?.parameters as Record<string, unknown>;
    expect(params.destinationKind).toBe('raw_address');
    expect(params.toAddress).toBe(RAW_SEND_ADDRESS);
  }, 120_000);

  // ===========================================================================
  // TEST 2 — misroute regression (Option A: bare send → needs_beneficiary,
  // NEVER the default beneficiary)
  // ===========================================================================

  it('a raw-address paste with NO explicit sendDestination + a default beneficiary → needs_beneficiary card, NOT the default (misroute regression)', async () => {
    const { accessToken, userId } = await setupVerifiedUser(
      `misroute_${Date.now()}@test.com`,
    );

    // Seed a DEFAULT crypto beneficiary for the user — the first crypto_address
    // add for a user is auto-marked isDefault (BeneficiaryPrismaRepository.addCryptoAddress).
    await request(app.getHttpServer())
      .post('/beneficiaries/crypto-address')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        address: DEFAULT_BENEFICIARY_ADDRESS,
        network: 'TRON',
        asset: 'USDT',
        label: 'Default wallet',
        pin: '1357',
      })
      .expect(201);

    const defaultBen = await prisma.beneficiary.findFirst({
      where: { userId, type: 'crypto_address' },
    });
    expect(defaultBen?.isDefault).toBe(true);
    expect(defaultBen?.cryptoAddress).toBe(DEFAULT_BENEFICIARY_ADDRESS);

    const proposalCountBefore = await prisma.proposal.count({
      where: { userId },
    });

    // NO sendDestination on the request — a bare send with a pasted address in
    // the message text and no explicit confirmation.
    fakeLlmProvider.extractIntent.mockResolvedValueOnce({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '2',
      network: 'TRON',
    });

    const res = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: `send 2 USDT to ${MISROUTE_PASTED_ADDRESS}` })
      .expect(200);

    const body = res.body as {
      outcome: {
        kind: string;
        allowRawSend?: boolean;
        prefillAddress?: string;
        beneficiaryType?: string;
      };
    };
    expect(body.outcome.kind).toBe('needs_beneficiary');
    expect(body.outcome.allowRawSend).toBe(true);
    expect(body.outcome.prefillAddress).toBe(MISROUTE_PASTED_ADDRESS);
    expect(body.outcome.beneficiaryType).toBe('crypto_address');

    // §3.1 no-misroute proof: the default beneficiary was NEVER used — no
    // proposal (of any kind) was created for this turn.
    const proposalCountAfter = await prisma.proposal.count({
      where: { userId },
    });
    expect(proposalCountAfter).toBe(proposalCountBefore);
  }, 120_000);

  // ===========================================================================
  // TEST 3 — save-before persists a beneficiary once the send executes
  // ===========================================================================

  it('save-before persists a beneficiary once the send executes', async () => {
    const { accessToken, userId } = await setupVerifiedUser(
      `savebefore_${Date.now()}@test.com`,
    );
    await seedUsdtBalance(userId, 100);

    fakeLlmProvider.extractIntent.mockResolvedValueOnce({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '2',
      network: 'TRON',
    });

    const chatRes = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        text: `send 2 USDT to ${SAVE_BEFORE_ADDRESS}`,
        sendDestination: {
          address: SAVE_BEFORE_ADDRESS,
          network: 'TRON',
          saveAsBeneficiary: true,
          label: 'Saved via raw send',
        },
      })
      .expect(200);

    const outcome = (
      chatRes.body as { outcome: { kind: string; proposalId: string } }
    ).outcome;
    expect(outcome.kind).toBe('proposal');

    // Before execute: no beneficiary yet — the save happens on the engine's
    // save-on-success step (ExecutionService.executeSend), not at propose time.
    const beforeExecute = await prisma.beneficiary.findFirst({
      where: {
        userId,
        type: 'crypto_address',
        cryptoAddress: SAVE_BEFORE_ADDRESS,
      },
    });
    expect(beforeExecute).toBeNull();

    const execRes = await authorizeAndExecute(accessToken, outcome.proposalId);
    expect(execRes.status).toBe(201);
    const execBody = execRes.body as {
      status: string;
      onChain?: { providerRef: string };
    };
    expect(execBody.status).toBe('settling');
    expect(execBody.onChain?.providerRef).toBe(FAKE_WITHDRAW_REF);

    // After execute: the raw destination is now a saved beneficiary.
    const savedBen = await prisma.beneficiary.findFirst({
      where: {
        userId,
        type: 'crypto_address',
        cryptoAddress: SAVE_BEFORE_ADDRESS,
      },
    });
    expect(savedBen).not.toBeNull();
    expect(savedBen?.label).toBe('Saved via raw send');
  }, 120_000);
});
