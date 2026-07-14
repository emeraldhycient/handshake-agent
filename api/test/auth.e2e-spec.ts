/**
 * Web auth flow — end-to-end acceptance test (Task 13).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives
 * the complete auth happy-path:
 *
 *   1. POST /auth/signup         → 202, devToken (AUTH_DEV_EXPOSE_OTP=true)
 *   2. POST /auth/verify-email   → 200, { verified: true }
 *   3. POST /auth/login/request  → 202, devOtp
 *   4. POST /auth/login/verify   → 200, { accessToken, refreshToken, user }
 *   5. GET  /auth/me             → 200, user object
 *   6. GET  /auth/me (no token)  → 401
 *   7. POST /auth/refresh        → 200, rotated pair
 *   8. POST /auth/refresh (old)  → 401
 *   9. POST /auth/logout         → 204; GET /auth/me → 401
 *
 * Plus: wrong OTP → 401.
 *
 * Bootstrap mirrors buy-vertical.e2e-spec.ts:
 *   - Testcontainers Postgres + prisma migrate deploy
 *   - env vars set BEFORE AppModule dynamic import (ConfigModule side-effect)
 *   - four external-edge fakes overridden via .overrideProvider()
 */

import { execSync } from 'node:child_process';
import { join } from 'node:path';

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

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_ROOT = join(__dirname, '..');
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-auth';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-auth-fake';
const WA_APP_SECRET = 'e2e-auth-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-auth';

// ===========================================================================
// THE TEST SUITE
// ===========================================================================

describe('Web auth flow — e2e (AppModule, Testcontainers Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stopContainer: () => Promise<void>;
  let fakeLlmProvider: jest.Mocked<LlmProvider>;
  let fakeWalletProvider: jest.Mocked<IWalletProvider>;
  let fakePaymentProvider: jest.Mocked<IPaymentProvider>;
  let fakeSender: jest.Mocked<IWhatsAppSender>;

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
      WHATSAPP_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: WA_ACCESS_TOKEN,
      WHATSAPP_APP_SECRET: WA_APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: WA_VERIFY_TOKEN,
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-auth-directive-key-32bytes!!xx',
      RECEIPT_SIGNING_KEY: 'e2e-auth-receipt-signing-key-32b!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-auth',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-auth',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-auth',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-auth',
      JWT_SECRET: 'e2e-auth-jwt-secret-at-least-32-bytes!!',
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    // Ensure ANTHROPIC_API_KEY is absent (not empty string) to pass optional validation
    delete process.env.ANTHROPIC_API_KEY;

    // 3. Dynamic import of AppModule (happens AFTER env vars are set above).
    //    Deferring this import is essential: ConfigModule.forRoot() calls
    //    validateEnv() synchronously when the module file is first required.
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
        address: 'TAuthFakeWalletAddr123456789012',
        providerReference: 'fake_blockradar_ref_auth_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-auth-stub',
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
        accountNumber: '0081234567',
        bankName: 'Auth Test MFB',
        providerRef: 'flw_fake_ref_auth_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_auth_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    fakeSender = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.auth.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.auth.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.auth.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.auth.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.auth.e2e' }),
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
    // Mirror main.ts: parse the Cookie header so req.cookies is populated. This
    // is what makes the HttpOnly ha_refresh cookie flow (Wave H) exercisable e2e.
    app.use(cookieParser());
    await app.init();
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await stopContainer?.();
  });

  // ===========================================================================
  // MAIN TEST — full auth happy path
  // ===========================================================================

  it('signup → verify-email → login request → login verify → me → refresh → logout', async () => {
    const email = `e2e_${Date.now()}@test.com`;

    // 1. signup returns devToken (dev-expose on)
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, phone: '+2348019999999' })
      .expect(202);
    const signupBody = signup.body as { status: string; devToken: string };
    expect(signupBody.status).toBe('pending_verification');
    const token = signupBody.devToken;
    expect(token).toBeDefined();

    // 2. verify email
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token })
      .expect(200)
      .expect((r) => expect(r.body).toEqual({ verified: true }));

    // 3. login request returns devOtp
    const lr = await request(app.getHttpServer())
      .post('/auth/login/request')
      .send({ email })
      .expect(202);
    const lrBody = lr.body as { status: string; devOtp: string };
    const otp = lrBody.devOtp;
    expect(otp).toMatch(/^[0-9]{6}$/);

    // 4. login verify returns tokens
    const lv = await request(app.getHttpServer())
      .post('/auth/login/verify')
      .send({ email, otp, deviceFingerprint: 'e2e-fingerprint-123' })
      .expect(200);
    const lvBody = lv.body as {
      accessToken: string;
      refreshToken: string;
      user: { email: string };
    };
    expect(lvBody.accessToken).toBeDefined();
    expect(lvBody.refreshToken).toBeDefined();
    expect(lvBody.user.email).toBe(email);
    const { accessToken, refreshToken } = lvBody;

    // 5. /auth/me with the access token — emailVerified:true for a verified
    // user (Task 4.1: loadMe now derives it from emailVerifiedAt).
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const meBody = me.body as { email: string; emailVerified: boolean };
    expect(meBody.email).toBe(email);
    expect(meBody.emailVerified).toBe(true);

    // 6. /auth/me without a token → 401
    await request(app.getHttpServer()).get('/auth/me').expect(401);

    // 7. refresh rotates the pair — same loadMe projection, so the boot-
    // rehydrate user object also carries emailVerified:true (Task 4.1).
    const rf = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    const rfBody = rf.body as {
      accessToken: string;
      refreshToken: string;
      user: { emailVerified: boolean };
    };
    expect(rfBody.accessToken).toBeDefined();
    expect(rfBody.refreshToken).not.toBe(refreshToken);
    expect(rfBody.user.emailVerified).toBe(true);

    // 8. old refresh token no longer works
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    // 9. logout revokes; the (new) access token then fails /me
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${rfBody.accessToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${rfBody.accessToken}`)
      .expect(401);
  }, 60_000);

  // ===========================================================================
  // WRONG OTP TEST
  // ===========================================================================

  it('wrong OTP is rejected with 401', async () => {
    const email = `e2e_bad_${Date.now()}@test.com`;
    const s = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, phone: '+2348018888888' })
      .expect(202);
    const sBody = s.body as { devToken: string };
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: sBody.devToken })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/login/request')
      .send({ email })
      .expect(202);
    await request(app.getHttpServer())
      .post('/auth/login/verify')
      .send({ email, otp: '000000', deviceFingerprint: 'fp-e2e-xyz' })
      .expect(401);
  }, 60_000);

  // ===========================================================================
  // OTP SIGNUP (Task 2.2) — additive /auth/signup/request + /auth/signup/verify
  // ===========================================================================

  it('signup/request → signup/verify issues a session with tier_1 + emailVerified, and Set-Cookies ha_refresh', async () => {
    const email = `e2e_otp_signup_${Date.now()}@test.com`;

    const sr = await request(app.getHttpServer())
      .post('/auth/signup/request')
      .send({ email })
      .expect(200);
    const srBody = sr.body as { status: string; devOtp: string };
    expect(srBody.status).toBe('otp_sent');
    const otp = srBody.devOtp;
    expect(otp).toMatch(/^[0-9]{6}$/);

    const sv = await request(app.getHttpServer())
      .post('/auth/signup/verify')
      .send({ email, otp, deviceFingerprint: 'e2e-signup-fingerprint-1' })
      .expect(200);
    const svBody = sv.body as {
      accessToken: string;
      refreshToken: string;
      user: { email: string; kycTier: string; emailVerified: boolean };
    };
    expect(svBody.accessToken).toBeDefined();
    expect(svBody.refreshToken).toBeDefined();
    expect(svBody.user.email).toBe(email);
    expect(svBody.user.kycTier).toBe('tier_1');
    expect(svBody.user.emailVerified).toBe(true);

    const setCookie = sv.headers['set-cookie'] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith('ha_refresh='))).toBe(true);

    // The issued access token authenticates /auth/me like any other session.
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${svBody.accessToken}`)
      .expect(200);
  }, 60_000);

  it('signup/verify rejects a wrong OTP with 401', async () => {
    const email = `e2e_otp_signup_bad_${Date.now()}@test.com`;
    await request(app.getHttpServer())
      .post('/auth/signup/request')
      .send({ email })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/signup/verify')
      .send({ email, otp: '000000', deviceFingerprint: 'e2e-signup-badotp-fp' })
      .expect(401);
  }, 60_000);

  it('signup/request on an already-verified email returns the same otp_sent shape but mints no usable OTP (no enumeration oracle)', async () => {
    // Create + verify a real user first via the legacy link flow (still intact).
    const email = `e2e_otp_signup_dup_${Date.now()}@test.com`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, phone: '+2348016666666' })
      .expect(202);
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: (signup.body as { devToken: string }).devToken })
      .expect(200);

    // Hitting signup/request again for the now-verified email is neutral.
    const sr = await request(app.getHttpServer())
      .post('/auth/signup/request')
      .send({ email })
      .expect(200);
    const srBody = sr.body as { status: string; devOtp?: string };
    expect(srBody.status).toBe('otp_sent');
    expect(srBody.devOtp).toBeUndefined();

    // No usable challenge was minted — any code is rejected the same way an
    // unknown email would be.
    await request(app.getHttpServer())
      .post('/auth/signup/verify')
      .send({ email, otp: '000000', deviceFingerprint: 'e2e-signup-dup-fp' })
      .expect(401);
  }, 60_000);

  // ===========================================================================
  // LEGACY link flow still passes (kept for backward-compat, Task 2.2 is additive)
  // ===========================================================================

  it('LEGACY: signup → verify-email link flow still works unmodified', async () => {
    const email = `e2e_legacy_link_${Date.now()}@test.com`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, phone: '+2348015555555' })
      .expect(202);
    const token = (signup.body as { devToken: string }).devToken;
    expect(token).toBeDefined();
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token })
      .expect(200)
      .expect((r) => expect(r.body).toEqual({ verified: true }));
  }, 60_000);

  // ===========================================================================
  // HttpOnly refresh-cookie flow (Wave H) — cookie-primary, no body token
  // ===========================================================================

  it('login/verify Set-Cookies ha_refresh (HttpOnly); refresh works from the cookie with NO body; logout clears it', async () => {
    // A cookie-jar agent persists Set-Cookie across requests (like a browser).
    const agent = request.agent(app.getHttpServer());
    const email = `e2e_cookie_${Date.now()}@test.com`;

    const signup = await agent
      .post('/auth/signup')
      .send({ email, phone: '+2348017777777' })
      .expect(202);
    await agent
      .post('/auth/verify-email')
      .send({ token: (signup.body as { devToken: string }).devToken })
      .expect(200);
    const lr = await agent
      .post('/auth/login/request')
      .send({ email })
      .expect(202);
    const otp = (lr.body as { devOtp: string }).devOtp;

    // login/verify sets the HttpOnly ha_refresh cookie (and still returns tokens).
    const lv = await agent
      .post('/auth/login/verify')
      .send({ email, otp, deviceFingerprint: 'e2e-cookie-fp' })
      .expect(200);
    const setCookie = lv.headers['set-cookie'] as unknown as string[];
    const refreshCookie = setCookie.find((c) => c.startsWith('ha_refresh='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/i);
    // The body still carries the tokens (non-breaking), but a browser ignores them.
    const accessToken = (lv.body as { accessToken: string }).accessToken;

    // refresh with the cookie ONLY and a COMPLETELY ABSENT body → 200, rotated
    // pair + user. This is exactly what the browser client sends (axios
    // `api.post('/auth/refresh')` with no data): the token rides in the cookie.
    // A bodyless POST hands the DTO layer `undefined`; the request schema must
    // accept it (RefreshRequestSchema.default({})), or every browser boot-refresh
    // 400s and the user is logged out on reload. Do NOT `.send({})` here — that
    // masks the bug (an empty object validates even without the default).
    const rf = await agent.post('/auth/refresh').expect(200);
    const rfBody = rf.body as {
      accessToken: string;
      refreshToken: string;
      user: { email: string };
    };
    expect(rfBody.accessToken).toBeDefined();
    expect(rfBody.user.email).toBe(email);
    // The rotation re-Set-Cookies a fresh ha_refresh.
    const rfSetCookie = rf.headers['set-cookie'] as unknown as string[];
    expect(rfSetCookie.some((c) => c.startsWith('ha_refresh='))).toBe(true);

    // The new access token authenticates /auth/me (Bearer flow untouched).
    await agent
      .get('/auth/me')
      .set('Authorization', `Bearer ${rfBody.accessToken}`)
      .expect(200);

    // logout clears the cookie (Set-Cookie with an expiry in the past).
    const lo = await agent
      .post('/auth/logout')
      .set('Authorization', `Bearer ${rfBody.accessToken}`)
      .expect(204);
    const loSetCookie = lo.headers['set-cookie'] as unknown as string[];
    expect(loSetCookie.some((c) => c.startsWith('ha_refresh='))).toBe(true);

    // With no body token AND the (rotated-away) cookie now revoked, refresh 401s.
    await agent.post('/auth/refresh').send({}).expect(401);

    // Sanity: the original login access token was long-lived but the session is
    // now revoked, so it no longer authenticates either.
    await agent
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  }, 60_000);
});
