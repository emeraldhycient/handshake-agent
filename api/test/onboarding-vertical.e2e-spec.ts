/**
 * Onboarding vertical — the capstone acceptance test (Task 4.2).
 *
 * Boots the REAL AppModule (Testcontainers Postgres + Redis :6379) via supertest
 * and drives the WHOLE backend flow end to end, tying together Phases 0–3:
 *
 *   1. POST /auth/signup/request              → 200 { status: 'otp_sent', devOtp }
 *   2. POST /auth/signup/verify                → 200 session; kycTier tier_1,
 *      emailVerified true; Set-Cookie ha_refresh (HttpOnly).
 *   3. POST /profile/name                      → 200; GET /auth/me reflects it.
 *   4. POST /kyc/pin                           → 200 { hasPin: true } — PIN set
 *      at tier_1 (email-verified only, no full KYC yet).
 *   5. POST /chat/messages "buy …"              → outcome.kind === 'proposal'
 *      (tier_1 can buy — crypto.buy is gated to tier_1).
 *   6. POST /chat/messages "send …"              → 200, outcome.kind ===
 *      'needs_kyc' (tier_1 cannot send — crypto.send needs tier_2; the
 *      chat-entry gate is @HttpCode(200) always, so a blocked capability
 *      renders as an in-thread outcome, not a 4xx).
 *   7. POST /webhooks/sumsub, signed GREEN (tier_2 level, externalUserId=userId)
 *      → 200; drain the durable webhook queue; GET /auth/me → tier_2, verified.
 *   8. POST /chat/messages "send …" again        → outcome.kind === 'proposal'
 *      (the same gate that blocked step 6 now passes).
 *   9. POST /webhooks/sumsub, signed GREEN (tier_3 level) → GET /auth/me → tier_3;
 *      GET /profile → limits.perTxFiatMax is the tier_3 value.
 *
 * Reuses existing e2e patterns verbatim rather than inventing new infra:
 *   - signup/request + signup/verify: mirrors auth.e2e-spec.ts's OTP-signup cases.
 *   - buy/send proposal creation via chat: mirrors web-buy.e2e-spec.ts and
 *     web-sell-send.e2e-spec.ts (LLM fake dispatches by message text; beneficiary
 *     add + cooling-off clear + ledger balance seed for send).
 *   - Sumsub webhook signing: mirrors sumsub-webhook.e2e-spec.ts's HMAC-SHA256
 *     `x-payload-digest` helper over the raw JSON body.
 *
 * Bootstrap mirrors all of the above: Testcontainers Postgres + prisma migrate
 * deploy, env vars set BEFORE AppModule dynamic import, four external-edge fakes
 * overridden via .overrideProvider().
 */

import { createHmac } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// supertest is a CommonJS module; allowSyntheticDefaultImports lets us import it
// as a default, and ts-jest's CJS interop makes it callable as a function.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaPg } from '@prisma/adapter-pg';
// cookie-parser is CJS (`export =`); the api tsconfig has no esModuleInterop, so
// import it as a namespace (same pattern main.ts uses).
import * as cookieParser from 'cookie-parser';
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
import { drainWebhooks } from './helpers/drain-webhooks';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_ROOT = join(__dirname, '..');
const SUMSUB_WEBHOOK_SECRET = 'e2e-onboarding-sumsub-webhook-secret';
const SUMSUB_LEVEL_TIER2 = 'id-and-liveness';
const SUMSUB_LEVEL_TIER3 = 'full-kyc';
// Valid TRON-format address (starts with T, 34 chars total; base58, no 0/O/I/l).
const VALID_TRON_ADDRESS = 'TCapstoneTronBeneficiaryAddr123456';

// ---------------------------------------------------------------------------
// Sumsub signing helper — mirrors sumsub-webhook.e2e-spec.ts EXACTLY: sign
// Buffer.from(JSON.stringify(payload)) and .send(payload) with the SAME object
// so supertest/superagent's own JSON.stringify produces byte-identical wire
// bytes to what we signed.
// ---------------------------------------------------------------------------

function signSumsubPayload(secret: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

// ===========================================================================
// THE TEST SUITE
// ===========================================================================

describe('Onboarding vertical — e2e (email → tier_1 → Sumsub → tier_2/3)', () => {
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
    //    CRITICAL: ConfigModule.forRoot() calls validateEnv() synchronously
    //    at module decoration time (when app.module.ts is first required).
    //    These must be in process.env BEFORE that dynamic import() happens.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl,
      WHATSAPP_PHONE_NUMBER_ID: 'test-pnid-e2e-onboarding',
      WHATSAPP_ACCESS_TOKEN: 'e2e-wa-access-token-onboarding-fake',
      WHATSAPP_APP_SECRET: 'e2e-onboarding-app-secret-123',
      WHATSAPP_VERIFY_TOKEN: 'e2e-verify-token-onboarding',
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-onboarding-directive-key-32byte',
      RECEIPT_SIGNING_KEY: 'e2e-onboarding-receipt-key-32bytes!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-onboarding',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-onboard',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-onboarding',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-onboarding',
      JWT_SECRET: 'e2e-onboarding-jwt-secret-at-least-32-bytes!!',
      AUTH_DEV_EXPOSE_OTP: 'true',
      // Task 3.6: the secret this suite signs webhooks with, + the level→tier
      // mapping so a signed GREEN webhook can grant a real tier in this test.
      SUMSUB_WEBHOOK_SECRET,
      SUMSUB_LEVEL_TIER2,
      SUMSUB_LEVEL_TIER3,
    });
    // Ensure ANTHROPIC_API_KEY is absent (not empty string) to pass optional validation
    delete process.env.ANTHROPIC_API_KEY;

    // 3. Dynamic import of AppModule (happens AFTER env vars are set above).
    //    Deferring this import is essential: ConfigModule.forRoot() calls
    //    validateEnv() synchronously when the module file is first required.
    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    // 4. Build fake providers with correct interface shapes.
    //    The LLM fake dispatches by inspecting the message text — no real
    //    Anthropic call (same pattern as web-sell-send.e2e-spec.ts).
    fakeLlmProvider = {
      extractIntent: jest.fn().mockImplementation((text: string) => {
        if (/send/i.test(text)) {
          return Promise.resolve({
            action: 'send_crypto',
            asset: 'USDT',
            cryptoAmount: '5',
            network: 'TRON',
          });
        }
        return Promise.resolve({
          action: 'buy_crypto',
          asset: 'USDT',
          fiatAmount: '5000',
          fiatCurrency: 'NGN',
        });
      }),
    };

    const fakeWalletProvider: jest.Mocked<IWalletProvider> = {
      provisionAddress: jest.fn().mockResolvedValue({
        address: 'TOnboardingFakeWalletAddr123456789',
        providerReference: 'fake_blockradar_ref_onboarding_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-onboarding-tx-ref-stub',
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
        accountNumber: '0071234567',
        bankName: 'Onboarding Test MFB',
        providerRef: `va_${Date.now()}`,
        amount: '5000',
        currency: 'NGN',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_onboarding_e2e',
      }),
      createPayout: jest
        .fn()
        .mockResolvedValue({ providerRef: 'payout_fake_ref_onboarding' }),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.onb.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.onb.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.onb.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.onb.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.onb.e2e' }),
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
    // Mirror main.ts: parse the Cookie header so req.cookies is populated —
    // needed to observe the HttpOnly ha_refresh cookie Set-Cookie (Wave H).
    app.use(cookieParser());
    await app.init();
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await stopContainer?.();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function buildGreenPayload(
    userId: string,
    levelName: string,
    applicantId: string,
  ): Record<string, unknown> {
    return {
      type: 'applicantReviewed',
      applicantId,
      externalUserId: userId,
      levelName,
      reviewResult: { reviewAnswer: 'GREEN' },
    };
  }

  async function postSignedWebhook(payload: Record<string, unknown>) {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = signSumsubPayload(SUMSUB_WEBHOOK_SECRET, rawBody);
    return request(app.getHttpServer())
      .post('/webhooks/sumsub')
      .set('Content-Type', 'application/json')
      .set('x-payload-digest', signature)
      .set('x-payload-digest-alg', 'HMAC_SHA256_HEX')
      .send(payload);
  }

  async function getMe(accessToken: string): Promise<{
    kycTier: string;
    kycStatus: string;
    emailVerified?: boolean;
    firstName?: string | null;
    lastName?: string | null;
    hasPin: boolean;
  }> {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    return res.body as {
      kycTier: string;
      kycStatus: string;
      emailVerified?: boolean;
      firstName?: string | null;
      lastName?: string | null;
      hasPin: boolean;
    };
  }

  /** Seeds a USDT credit on the user's TRON wallet ledger (as a settled buy would). */
  async function seedUsdtBalance(
    userId: string,
    amount: number,
  ): Promise<void> {
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
        description: 'seed credit for onboarding-vertical e2e',
        balanceAfter: (before + amount).toFixed(6),
        sequence: seq,
        postedAt: new Date(),
      },
    });
  }

  // ===========================================================================
  // THE VERTICAL — one sequential test, phases 0–3 tied together
  // ===========================================================================

  it(
    'email signup → tier_1 (name + PIN) → buy passes / send blocked → ' +
      'Sumsub tier_2 (send unblocks) → Sumsub tier_3 (limits raised)',
    async () => {
      const email = `e2e_onboarding_${Date.now()}@test.com`;
      const deviceFingerprint = `e2e-onboarding-fp-${email.slice(0, 20)}`;

      // ── Step 1: POST /auth/signup/request → devOtp ──────────────────────────
      const sr = await request(app.getHttpServer())
        .post('/auth/signup/request')
        .send({ email })
        .expect(200);
      const srBody = sr.body as { status: string; devOtp: string };
      expect(srBody.status).toBe('otp_sent');
      expect(srBody.devOtp).toMatch(/^[0-9]{6}$/);

      // ── Step 2: POST /auth/signup/verify → session, tier_1, emailVerified ───
      const sv = await request(app.getHttpServer())
        .post('/auth/signup/verify')
        .send({ email, otp: srBody.devOtp, deviceFingerprint })
        .expect(200);
      const svBody = sv.body as {
        accessToken: string;
        refreshToken: string;
        user: {
          id?: string;
          userId?: string;
          email: string;
          kycTier: string;
          emailVerified: boolean;
        };
      };
      expect(svBody.accessToken).toBeTruthy();
      expect(svBody.user.kycTier).toBe('tier_1');
      expect(svBody.user.emailVerified).toBe(true);
      const setCookie = sv.headers['set-cookie'] as unknown as string[];
      expect(setCookie.some((c) => c.startsWith('ha_refresh='))).toBe(true);
      expect(setCookie.some((c) => /ha_refresh=.*HttpOnly/i.test(c))).toBe(
        true,
      );

      const { accessToken } = svBody;

      // Look the user id up from the DB (the me/session projection is the
      // authoritative shape — avoid relying on which field name the signup
      // response happens to carry it under).
      const userRow = await prisma.user.findUnique({ where: { email } });
      expect(userRow).not.toBeNull();
      const userId = userRow!.id;

      // ── Step 3: POST /profile/name → GET /auth/me reflects it ───────────────
      const nameRes = await request(app.getHttpServer())
        .post('/profile/name')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ firstName: 'Amara', lastName: 'Chukwu' })
        .expect(200);
      expect(nameRes.body).toEqual({ firstName: 'Amara', lastName: 'Chukwu' });

      const meAfterName = await getMe(accessToken);
      expect(meAfterName.firstName).toBe('Amara');
      expect(meAfterName.lastName).toBe('Chukwu');
      expect(meAfterName.kycTier).toBe('tier_1');

      // ── Step 4: POST /kyc/pin → { hasPin: true } at tier_1 ───────────────────
      const pinRes = await request(app.getHttpServer())
        .post('/kyc/pin')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ pin: '2468' })
        .expect(200);
      expect(pinRes.body).toEqual({ hasPin: true });

      const meAfterPin = await getMe(accessToken);
      expect(meAfterPin.hasPin).toBe(true);

      // ── Step 5: buy proposal — passes the gate (crypto.buy is tier_1) ───────
      const buyRes = await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ text: 'buy 5000 naira of usdt' })
        .expect(200);
      const buyOutcome = (
        buyRes.body as { outcome: { kind: string; proposalId?: string } }
      ).outcome;
      expect(buyOutcome.kind).toBe('proposal');
      expect(buyOutcome.proposalId).toBeTruthy();

      // ── Prep for the send tests: an eligible crypto beneficiary (past
      // cooling-off) and a funded USDT balance so the CAPABILITY_TIER_REQUIRED
      // gate — not an unrelated insufficient-balance/cooling-off rejection — is
      // what fires on the tier_1 attempt below (ProposalService.createSendProposal
      // checks balance and beneficiary state around the KYC gate call).
      const benRes = await request(app.getHttpServer())
        .post('/beneficiaries/crypto-address')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          address: VALID_TRON_ADDRESS,
          network: 'TRON',
          asset: 'USDT',
          label: 'My cold wallet',
          pin: '2468',
        })
        .expect(201);
      const beneficiaryId = (benRes.body as { id: string }).id;
      await prisma.beneficiary.update({
        where: { id: beneficiaryId },
        data: { firstUseLockedUntil: null },
      });
      await seedUsdtBalance(userId, 100);

      // ── Step 6: send proposal at tier_1 — blocked by the chat-entry gate ─────
      // WebChatService's capability→min-tier pre-check (fixed in 7b04f93) short-
      // circuits crypto.send (tier_2) to a `needs_kyc` outcome at HTTP 200 — the
      // /chat/messages route is @HttpCode(200) always, so gate failures render
      // as an in-thread outcome, never a 4xx (mirrors web-chat.e2e-spec.ts's
      // "email-verified only, tier_1 ... send needs_kyc" regression case).
      const sendBlockedRes = await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ text: 'send 5 usdt', beneficiaryId })
        .expect(200);
      expect(
        (sendBlockedRes.body as { outcome: { kind: string } }).outcome.kind,
      ).toBe('needs_kyc');

      // ── Step 7: signed GREEN Sumsub webhook (tier_2) → tier_2, verified ──────
      const tier2Payload = buildGreenPayload(
        userId,
        SUMSUB_LEVEL_TIER2,
        'sumsub-app-onboarding-e2e-1',
      );
      const tier2Res = await postSignedWebhook(tier2Payload);
      expect(tier2Res.status).toBe(200);
      expect(tier2Res.body).toEqual({ status: 'ok' });
      await drainWebhooks(app);

      const meAfterTier2 = await getMe(accessToken);
      expect(meAfterTier2.kycTier).toBe('tier_2');
      expect(meAfterTier2.kycStatus).toBe('verified');

      // ── Step 8: send proposal again — now passes the gate ────────────────────
      const sendPassedRes = await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ text: 'send 5 usdt', beneficiaryId })
        .expect(200);
      const sendOutcome = (
        sendPassedRes.body as { outcome: { kind: string; proposalId?: string } }
      ).outcome;
      expect(sendOutcome.kind).toBe('proposal');
      expect(sendOutcome.proposalId).toBeTruthy();

      // ── Step 9: signed GREEN Sumsub webhook (tier_3) → tier_3; limits raised ─
      const tier3Payload = buildGreenPayload(
        userId,
        SUMSUB_LEVEL_TIER3,
        'sumsub-app-onboarding-e2e-1',
      );
      const tier3Res = await postSignedWebhook(tier3Payload);
      expect(tier3Res.status).toBe(200);
      await drainWebhooks(app);

      const meAfterTier3 = await getMe(accessToken);
      expect(meAfterTier3.kycTier).toBe('tier_3');

      const profileRes = await request(app.getHttpServer())
        .get('/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const profileBody = profileRes.body as {
        limits: { perTxFiatMax: number } | null;
      };
      expect(profileBody.limits).not.toBeNull();
      // tier_3 NGN perTxFiatMax (configuration.ts limits.NGN.tier_3) — strictly
      // greater than the tier_1 cap, confirming the raised limit is reflected.
      expect(profileBody.limits!.perTxFiatMax).toBe(5_000_000);
    },
    120_000,
  );
});
