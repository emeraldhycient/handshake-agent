/**
 * Sumsub webhook — end-to-end acceptance test (task 3.6, the final piece of
 * Phase 3 — Sumsub).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives:
 *
 *   1. Sign up + verify + login a fresh user, upgrade to tier_1 via /kyc/submit.
 *   2. BEFORE any Sumsub webhook: KycGateService.assertCanTransact({capability:
 *      'crypto.send'}) throws CapabilityTierError — tier_1 cannot send
 *      (gating.capabilityMinTier['crypto.send'] = 'tier_2').
 *   3. POST a correctly-signed GREEN webhook (`x-payload-digest` = hex
 *      HMAC-SHA256 of the raw body, keyed by SUMSUB_WEBHOOK_SECRET) whose
 *      `levelName` maps to tier_2 (SUMSUB_LEVEL_TIER2) → 200 { status: 'ok' }.
 *      Drain the durable webhook queue synchronously (no worker process in
 *      e2e), then assert:
 *        - GET /auth/me → kycTier: 'tier_2', kycStatus: 'verified'.
 *        - KycProfile.sumsubApplicantId persisted, tierChangedAt stamped.
 *        - KycGateService.assertCanTransact({capability: 'crypto.send'}) now
 *          RESOLVES — the same server-side gate that 403'd before now passes.
 *   4. Bad signature → 401, no persistence, /auth/me unchanged (still tier_1).
 *   5. A semantically-identical GREEN webhook delivered again (different
 *      bytes — Sumsub's own redelivery is not guaranteed byte-identical, so
 *      this exercises the HANDLER's own idempotent-grant guard, not just the
 *      ingestion layer's exact-body dedup) → still tier_2, tierChangedAt
 *      UNCHANGED (no downgrade, no re-stamp — a replay must never restart the
 *      tier-change cooling-off window).
 *
 * Bootstrap mirrors kyc-sumsub-token.e2e-spec.ts:
 *   - Testcontainers Postgres + prisma migrate deploy
 *   - env vars set BEFORE AppModule dynamic import
 *   - four external-edge fakes overridden via .overrideProvider()
 */

import { createHmac } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

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
import { mintTier1User } from './helpers/mint-verified-user';
import { WALLET_PROVIDER } from '../src/modules/wallets/application/ports/wallet-provider.port';
import { PAYMENT_PROVIDER } from '../src/modules/treasury/application/ports/payment-provider.port';
import { WHATSAPP_SENDER } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';
import type { LlmProvider } from '../src/modules/agent/core/ports/llm-provider.port';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';
import type { IWhatsAppSender } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';
import { KycGateService } from '../src/modules/identity/application/kyc-gate.service';
import { CapabilityTierError } from '../src/modules/identity/domain/gate-errors';
import { drainWebhooks } from './helpers/drain-webhooks';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_ROOT = join(__dirname, '..');
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-sumsub-webhook';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-sumsub-webhook-fake';
const WA_APP_SECRET = 'e2e-sumsub-webhook-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-sumsub-webhook';
const SUMSUB_WEBHOOK_SECRET = 'e2e-sumsub-webhook-secret-signing-key';
const SUMSUB_LEVEL_TIER2 = 'id-and-liveness';

// ---------------------------------------------------------------------------
// Signing helper — mirrors the whatsapp-image/whatsapp-voice e2e pattern:
// sign Buffer.from(JSON.stringify(payload)) and .send(payload) with the SAME
// object, so supertest/superagent's own JSON.stringify produces byte-identical
// wire bytes to what we signed.
// ---------------------------------------------------------------------------

function signSumsubPayload(secret: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

// ===========================================================================
// THE TEST SUITE
// ===========================================================================

describe('Sumsub webhook — e2e (AppModule, Testcontainers Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stopContainer: () => Promise<void>;
  let fakeLlmProvider: jest.Mocked<LlmProvider>;
  let fakeWalletProvider: jest.Mocked<IWalletProvider>;
  let fakePaymentProvider: jest.Mocked<IPaymentProvider>;
  let fakeSender: jest.Mocked<IWhatsAppSender>;
  let kycGateService: KycGateService;

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
      DIRECTIVE_SIGNING_KEY: 'e2e-sw-directive-key-32bytes!!xxxx',
      RECEIPT_SIGNING_KEY: 'e2e-sw-receipt-signing-key-32b!!!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-sumsub-webhook',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-sw',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-sumsub-webhook',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-sumsub-webhook',
      JWT_SECRET: 'e2e-sumsub-webhook-jwt-secret-at-least-32-bytes!!',
      AUTH_DEV_EXPOSE_OTP: 'true',
      // Task 3.6: the secret this suite signs webhooks with, + the level→tier
      // mapping so a GREEN 'id-and-liveness' review grants tier_2.
      SUMSUB_WEBHOOK_SECRET,
      SUMSUB_LEVEL_TIER2,
      SUMSUB_LEVEL_TIER3: 'full-kyc',
    });
    delete process.env.ANTHROPIC_API_KEY;

    // 3. Dynamic import of AppModule (happens AFTER env vars are set above).
    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    // 4. Build fake providers with correct interface shapes
    fakeLlmProvider = {
      extractIntent: jest.fn().mockResolvedValue({
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '5000',
        fiatCurrency: 'NGN',
      }),
    };

    fakeWalletProvider = {
      provisionAddress: jest.fn().mockResolvedValue({
        address: 'TSumsubWebhookFakeWalletAddr123456789',
        providerReference: 'fake_blockradar_ref_sumsub_webhook_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-sumsub-webhook-stub',
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

    fakePaymentProvider = {
      createCollection: jest.fn().mockResolvedValue({
        accountNumber: '0091234567',
        bankName: 'Sumsub Webhook Test MFB',
        providerRef: 'flw_fake_ref_sumsub_webhook_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_sumsub_webhook_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      findPayoutByReference: jest.fn().mockResolvedValue(null),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    fakeSender = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.sw.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.sw.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.sw.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.sw.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.sw.e2e' }),
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

    kycGateService = app.get(KycGateService);
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await stopContainer?.();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function getMe(
    accessToken: string,
  ): Promise<{ kycTier: string; kycStatus: string }> {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    return res.body as { kycTier: string; kycStatus: string };
  }

  /** Asserts whether crypto.send currently passes/fails the real server-side gate. */
  async function assertSendGate(userId: string): Promise<'passed' | 'blocked'> {
    try {
      await kycGateService.assertCanTransact({
        userId,
        fiatAmount: '5000',
        fiatCurrency: 'NGN',
        asset: 'USDT',
        capability: 'crypto.send',
      });
      return 'passed';
    } catch (err) {
      if (err instanceof CapabilityTierError) return 'blocked';
      throw err;
    }
  }

  function buildGreenPayload(
    userId: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      type: 'applicantReviewed',
      applicantId: 'sumsub-app-e2e-1',
      externalUserId: userId,
      levelName: SUMSUB_LEVEL_TIER2,
      reviewResult: { reviewAnswer: 'GREEN' },
      ...extra,
    };
  }

  /** A RED verdict at the tier_2 level (SUMSUB_LEVEL_TIER2) — the compliance
   * auto-downgrade policy drops a tier_2 (or higher) user to tier_1. */
  function buildRedPayload(
    userId: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      type: 'applicantReviewed',
      applicantId: 'sumsub-app-e2e-red-1',
      externalUserId: userId,
      levelName: SUMSUB_LEVEL_TIER2,
      reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'FINAL' },
      ...extra,
    };
  }

  async function postSignedWebhook(
    payload: Record<string, unknown>,
    secret: string = SUMSUB_WEBHOOK_SECRET,
  ) {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = signSumsubPayload(secret, rawBody);
    return request(app.getHttpServer())
      .post('/webhooks/sumsub')
      .set('Content-Type', 'application/json')
      .set('x-payload-digest', signature)
      .set('x-payload-digest-alg', 'HMAC_SHA256_HEX')
      .send(payload);
  }

  // ===========================================================================
  // MAIN TEST — full grant flow, gate flip, redelivery idempotency
  // ===========================================================================

  it(
    'signed GREEN webhook grants tier_2; the crypto.send gate flips from ' +
      'blocked to passed; a redelivered GREEN is idempotent (no downgrade, ' +
      'no tierChangedAt re-stamp); a bad signature 401s with no state change',
    async () => {
      const { accessToken, userId } = await mintTier1User(app, { pin: '2468' });

      // ── Baseline: tier_1, crypto.send blocked by the real gate ──────────────
      const before = await getMe(accessToken);
      expect(before.kycTier).toBe('tier_1');
      expect(await assertSendGate(userId)).toBe('blocked');

      // ── Bad signature → 401, no persistence, no state change ────────────────
      const badPayload = buildGreenPayload(userId);
      const badRes = await request(app.getHttpServer())
        .post('/webhooks/sumsub')
        .set('Content-Type', 'application/json')
        .set('x-payload-digest', 'deadbeef'.repeat(8))
        .send(badPayload);
      expect(badRes.status).toBe(401);

      const afterBadSig = await getMe(accessToken);
      expect(afterBadSig.kycTier).toBe('tier_1');
      expect(afterBadSig.kycStatus).toBe(before.kycStatus);

      // ── Correctly-signed GREEN webhook → 200, ACK ────────────────────────────
      const greenPayload = buildGreenPayload(userId);
      const goodRes = await postSignedWebhook(greenPayload);
      expect(goodRes.status).toBe(200);
      expect(goodRes.body).toEqual({ status: 'ok' });

      await drainWebhooks(app);

      // ── /auth/me now shows tier_2, verified ──────────────────────────────────
      const afterGrant = await getMe(accessToken);
      expect(afterGrant.kycTier).toBe('tier_2');
      expect(afterGrant.kycStatus).toBe('verified');

      // ── DB assertions: applicantId persisted, tierChangedAt stamped ─────────
      const profileAfterGrant = await prisma.kycProfile.findUnique({
        where: { userId },
      });
      expect(profileAfterGrant).not.toBeNull();
      expect(profileAfterGrant!.sumsubApplicantId).toBe('sumsub-app-e2e-1');
      expect(profileAfterGrant!.tier).toBe('tier_2');
      expect(profileAfterGrant!.status).toBe('verified');

      const userAfterGrant = await prisma.user.findUnique({
        where: { id: userId },
      });
      expect(userAfterGrant!.tierChangedAt).not.toBeNull();
      const tierChangedAtAfterGrant = userAfterGrant!.tierChangedAt!.getTime();

      // ── The real send gate now PASSES (previously blocked) ──────────────────
      expect(await assertSendGate(userId)).toBe('passed');

      // ── Redelivered GREEN (a distinct delivery, not byte-identical — Sumsub's
      //    own redelivery isn't guaranteed to replay the exact same bytes) is
      //    idempotent: still tier_2, tierChangedAt UNCHANGED ──────────────────
      const redeliveredPayload = buildGreenPayload(userId, {
        redeliveryMarker: 'redelivery-2',
      });
      const redeliveredRes = await postSignedWebhook(redeliveredPayload);
      expect(redeliveredRes.status).toBe(200);

      await drainWebhooks(app);

      const afterRedelivery = await getMe(accessToken);
      expect(afterRedelivery.kycTier).toBe('tier_2');
      expect(afterRedelivery.kycStatus).toBe('verified');

      const userAfterRedelivery = await prisma.user.findUnique({
        where: { id: userId },
      });
      expect(userAfterRedelivery!.tierChangedAt!.getTime()).toBe(
        tierChangedAtAfterGrant,
      );
    },
    120_000,
  );

  // ===========================================================================
  // RED AUTO-DOWNGRADE — compliance policy (a RED at a level drops the user
  // to the rung below it; §3.3 re-locks the gate for capabilities that
  // required the revoked tier)
  // ===========================================================================

  it(
    'a signed RED webhook at the tier_2 level downgrades tier_2 → tier_1 and ' +
      're-locks crypto.send AND raises a single kyc_escalation compliance ' +
      'flag; a replayed RED is idempotent (no re-downgrade, no tierChangedAt ' +
      're-stamp, no duplicate flag)',
    async () => {
      const { accessToken, userId } = await mintTier1User(app, { pin: '2468' });

      // ── Grant tier_2 via a signed GREEN webhook (same flow as the main test).
      //    Distinct applicantId — KycProfile.sumsubApplicantId is @unique and
      //    the main test's suite-wide GREEN grant already claimed the default. ─
      const greenRes = await postSignedWebhook(
        buildGreenPayload(userId, {
          applicantId: 'sumsub-app-e2e-red-downgrade-green-1',
        }),
      );
      expect(greenRes.status).toBe(200);
      await drainWebhooks(app);

      const afterGrant = await getMe(accessToken);
      expect(afterGrant.kycTier).toBe('tier_2');
      expect(afterGrant.kycStatus).toBe('verified');

      // ── The real send gate passes at tier_2 (crypto.send requires tier_2) ────
      expect(await assertSendGate(userId)).toBe('passed');

      // ── A RED verdict AT THE TIER_2 LEVEL → auto-downgrade to tier_1 ─────────
      const redRes = await postSignedWebhook(buildRedPayload(userId));
      expect(redRes.status).toBe(200);
      expect(redRes.body).toEqual({ status: 'ok' });

      await drainWebhooks(app);

      const afterRed = await getMe(accessToken);
      expect(afterRed.kycTier).toBe('tier_1');
      expect(afterRed.kycStatus).toBe('rejected');

      // ── The real send gate (the money path a proposal endpoint would hit,
      //    §3.1/§3.3 — CapabilityTierError maps to 403 at the HTTP layer) is
      //    re-locked: it passed at tier_2, now blocks again at tier_1 ──────────
      expect(await assertSendGate(userId)).toBe('blocked');

      const profileAfterRed = await prisma.kycProfile.findUnique({
        where: { userId },
      });
      expect(profileAfterRed!.tier).toBe('tier_1');
      expect(profileAfterRed!.status).toBe('rejected');

      const userAfterRed = await prisma.user.findUnique({
        where: { id: userId },
      });
      expect(userAfterRed!.tierChangedAt).not.toBeNull();
      const tierChangedAtAfterRed = userAfterRed!.tierChangedAt!.getTime();

      // ── Hybrid policy's human-review half: exactly one kyc_escalation
      //    ComplianceEvent is flagged for the operator queue, carrying the
      //    downgrade + review context ────────────────────────────────────────
      const flagsAfterRed = await prisma.complianceEvent.findMany({
        where: { userId, eventType: 'kyc_escalation' },
      });
      expect(flagsAfterRed).toHaveLength(1);
      expect(flagsAfterRed[0].status).toBe('flagged');
      expect(flagsAfterRed[0].severity).toBe('high');
      expect(flagsAfterRed[0].screeningProvider).toBe('sumsub');
      expect(
        (flagsAfterRed[0].details as { downgradedTo?: string }).downgradedTo,
      ).toBe('tier_1');

      // ── A replayed RED (identical verdict, distinct delivery) is idempotent:
      //    still tier_1, tierChangedAt UNCHANGED — never re-downgrades below
      //    tier_1 and never re-stamps the cooling-off window ─────────────────
      const replayedRes = await postSignedWebhook(
        buildRedPayload(userId, { redeliveryMarker: 'red-replay-1' }),
      );
      expect(replayedRes.status).toBe(200);

      await drainWebhooks(app);

      const afterReplay = await getMe(accessToken);
      expect(afterReplay.kycTier).toBe('tier_1');
      expect(afterReplay.kycStatus).toBe('rejected');

      const userAfterReplay = await prisma.user.findUnique({
        where: { id: userId },
      });
      expect(userAfterReplay!.tierChangedAt!.getTime()).toBe(
        tierChangedAtAfterRed,
      );

      // ── Idempotent flag: the replayed RED does NOT pile a second
      //    kyc_escalation case onto the reviewer's queue (the first is still
      //    open) — findLatestOpenByUserAndType guards the create ─────────────
      const flagsAfterReplay = await prisma.complianceEvent.findMany({
        where: { userId, eventType: 'kyc_escalation' },
      });
      expect(flagsAfterReplay).toHaveLength(1);
    },
    120_000,
  );
});
