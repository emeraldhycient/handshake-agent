/**
 * Admin end-user management + KYC review — end-to-end acceptance test (Phase 2,
 * Task 5).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives
 * the controllers added in this task with NO mocking of the admin/db path:
 *
 *   1.  bootstrap → accept → login as super_admin (holds every grant)
 *   2.  seed an end-user (User + KycProfile @ pending_review) via the testcontainer prisma
 *   3.  GET  /admin/users                 → the seeded user appears
 *   4.  GET  /admin/users/:id             → the detail aggregate parses
 *   5.  POST /admin/auth/step-up          → stamp the session (writes need a fresh step-up)
 *   6.  PATCH /admin/users/:id/tier       → 204; DB asserts kycTier changed + audit row
 *   7.  GET  /admin/kyc/queue             → the pending user appears
 *   8.  POST /admin/kyc/:userId/approve   → 204; DB asserts KycProfile.status / User.kycStatus
 *                                            = verified + audit row
 *
 * Bootstrap mirrors admin-rbac.e2e-spec.ts: Testcontainers Postgres +
 * prisma migrate deploy, all env (incl. ADMIN_*) set BEFORE importing AppModule,
 * and the four external-edge fakes overridden via .overrideProvider().
 */

import { execSync } from 'node:child_process';
import { join } from 'node:path';

// supertest is a CommonJS module
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { INestApplication } from '@nestjs/common';

import { LLM_PROVIDER } from '../src/modules/agent/application/ports/agent.port';
import { WALLET_PROVIDER } from '../src/modules/wallets/application/ports/wallet-provider.port';
import { PAYMENT_PROVIDER } from '../src/modules/treasury/application/ports/payment-provider.port';
import { WHATSAPP_SENDER } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';
import type { LlmProvider } from '../src/modules/agent/core/ports/llm-provider.port';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';
import type { IWhatsAppSender } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';

jest.setTimeout(180_000);

const API_ROOT = join(__dirname, '..');
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-admin-endusers';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-admin-endusers-fake';
const WA_APP_SECRET = 'e2e-admin-endusers-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-admin-endusers';

const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token-endusers';
const ROOT_EMAIL = 'root-endusers@e2e.test';
const ROOT_PASSWORD = 'rootPassword123!';

const SEED_USER_EMAIL = 'enduser@e2e.test';

interface BootstrapBody {
  invitationId: string;
  invitationToken: string;
  expiresAt: string;
}
interface LoginBody {
  accessToken: string;
  expiresAt: string;
  admin: {
    id: string;
    role: { id: string; name: string };
    permissions: string[];
  };
}
interface EndUserListBody {
  items: { id: string; email: string | null; kycTier: string }[];
  nextCursor: string | null;
}
interface EndUserDetailBody {
  id: string;
  email: string | null;
  kycTier: string;
  kycStatus: string;
  devices: unknown[];
  balances: unknown[];
  recentTransactions: unknown[];
  recentLedger: unknown[];
  beneficiaries: unknown[];
}
interface KycQueueBody {
  items: {
    userId: string;
    email: string | null;
    displayName: string | null;
    requestedTier: string | null;
    status: string;
    submittedAt: string | null;
    slaAgeSeconds: number;
  }[];
  nextCursor: string | null;
}

describe('Admin end-user management + KYC review — e2e (AppModule, Testcontainers Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stopContainer: () => Promise<void>;

  beforeAll(async () => {
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

    // Set ALL required env vars BEFORE importing AppModule (ConfigModule.forRoot
    // runs validateEnv() synchronously at module decoration time).
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl,
      WHATSAPP_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: WA_ACCESS_TOKEN,
      WHATSAPP_APP_SECRET: WA_APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: WA_VERIFY_TOKEN,
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-endusers-directive-key-32bytes!x',
      RECEIPT_SIGNING_KEY: 'e2e-endusers-receipt-signing-key32',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-endusers',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-endusers',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-endusers',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-endusers',
      JWT_SECRET: 'e2e-endusers-jwt-secret-at-least-32-bytes!!',
      ADMIN_JWT_SECRET: 'e2e-endusers-admin-jwt-secret-32bytes!!',
      ADMIN_MFA_ENC_KEY: 'a'.repeat(64),
      ADMIN_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN,
    });
    delete process.env.ANTHROPIC_API_KEY;

    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    const fakeLlmProvider: jest.Mocked<LlmProvider> = {
      extractIntent: jest.fn().mockResolvedValue({
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '5000',
        fiatCurrency: 'NGN',
      }),
    };
    const fakeWalletProvider: jest.Mocked<IWalletProvider> = {
      provisionAddress: jest.fn().mockResolvedValue({
        address: 'TEndUsersFakeWalletAddr123456789',
        providerReference: 'fake_blockradar_ref_endusers_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-endusers-stub',
        status: 'pending' as const,
      }),
      getWithdrawalStatus: jest
        .fn()
        .mockResolvedValue({ status: 'pending' as const }),
      listWalletAssets: jest.fn().mockResolvedValue([]),
    };
    const fakePaymentProvider: jest.Mocked<IPaymentProvider> = {
      createCollection: jest.fn().mockResolvedValue({
        accountNumber: '0091234567',
        bankName: 'End Users Test MFB',
        providerRef: 'flw_fake_ref_endusers_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_endusers_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };
    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.eu.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.eu.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.eu.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.eu.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.eu.e2e' }),
    };

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
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await stopContainer?.();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Seed an end-user with a KYC profile pending review. Returns the user id. */
  async function seedEndUser(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: SEED_USER_EMAIL,
        status: 'active',
        kycStatus: 'pending_review',
        kycTier: 'unverified',
        kycProfile: {
          create: {
            status: 'pending_review',
            tier: 'unverified',
            firstName: 'Ada',
            lastName: 'Lovelace',
            nin: '12345678901',
            bvn: '98765432109',
          },
        },
      },
    });
    return user.id;
  }

  // ===========================================================================
  // MAIN TEST — full end-user + KYC lifecycle as a super_admin
  // ===========================================================================

  it('super_admin lists users, reads detail, adjusts tier, and approves KYC', async () => {
    // 1. Bootstrap + accept + login as the first super_admin.
    const bootstrap = await request(app.getHttpServer())
      .post('/admin/bootstrap')
      .send({ token: BOOTSTRAP_TOKEN, email: ROOT_EMAIL })
      .expect(201);
    const rootInviteToken = (bootstrap.body as BootstrapBody).invitationToken;

    await request(app.getHttpServer())
      .post('/admin/invitations/accept')
      .send({ token: rootInviteToken, password: ROOT_PASSWORD })
      .expect(200);

    const rootLogin = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: ROOT_EMAIL, password: ROOT_PASSWORD })
      .expect(200);
    const rootToken = (rootLogin.body as LoginBody).accessToken;
    expect(rootToken).toBeDefined();

    // 2. Seed the end-user + pending-review KYC profile.
    const userId = await seedEndUser();

    // 3. GET /admin/users — the seeded user is listed.
    const listRes = await request(app.getHttpServer())
      .get('/admin/users')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const listBody = listRes.body as EndUserListBody;
    expect(listBody.items.some((u) => u.id === userId)).toBe(true);

    // 4. GET /admin/users/:id — the detail aggregate parses through the schema.
    const detailRes = await request(app.getHttpServer())
      .get(`/admin/users/${userId}`)
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const detail = detailRes.body as EndUserDetailBody;
    expect(detail.id).toBe(userId);
    expect(detail.email).toBe(SEED_USER_EMAIL);
    expect(Array.isArray(detail.devices)).toBe(true);
    expect(Array.isArray(detail.balances)).toBe(true);
    expect(Array.isArray(detail.beneficiaries)).toBe(true);

    // 5. A write requires a fresh step-up — without it, 403 (ADMIN_STEP_UP_REQUIRED).
    await request(app.getHttpServer())
      .patch(`/admin/users/${userId}/tier`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ tier: 'tier_1' })
      .expect(403);

    // Complete the step-up challenge with the password.
    await request(app.getHttpServer())
      .post('/admin/auth/step-up')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ password: ROOT_PASSWORD })
      .expect(204);

    // 6. PATCH /admin/users/:id/tier — now succeeds (204).
    await request(app.getHttpServer())
      .patch(`/admin/users/${userId}/tier`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ tier: 'tier_1' })
      .expect(204);

    const afterTier = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(afterTier.kycTier).toBe('tier_1');

    const tierAudit = await prisma.auditLog.findFirst({
      where: { subject: `User:${userId}`, action: 'kyc_state_change' },
    });
    expect(tierAudit).not.toBeNull();

    // 7. GET /admin/kyc/queue — the pending-review user appears, enriched with the
    //    KYC display name + requested tier and a computed SLA age.
    const queueRes = await request(app.getHttpServer())
      .get('/admin/kyc/queue')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const queue = queueRes.body as KycQueueBody;
    const seeded = queue.items.find((q) => q.userId === userId);
    expect(seeded).toBeDefined();
    expect(seeded?.displayName).toBe('Ada Lovelace');
    expect(seeded?.requestedTier).toBe('unverified');
    expect(seeded?.slaAgeSeconds).toBeGreaterThanOrEqual(0);

    // 7b. The status filter narrows to a different bucket — the pending user is absent
    //     from the 'verified' bucket (it is still pending_review at this point).
    const verifiedRes = await request(app.getHttpServer())
      .get('/admin/kyc/queue')
      .query({ status: 'verified' })
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const verifiedQueue = verifiedRes.body as KycQueueBody;
    expect(verifiedQueue.items.some((q) => q.userId === userId)).toBe(false);

    // 8. POST /admin/kyc/:userId/approve — verifies the submission (204, step-up still fresh).
    await request(app.getHttpServer())
      .post(`/admin/kyc/${userId}/approve`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ tier: 'tier_1' })
      .expect(204);

    const afterKyc = await prisma.kycProfile.findUniqueOrThrow({
      where: { userId },
    });
    expect(afterKyc.status).toBe('verified');

    const afterUser = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(afterUser.kycStatus).toBe('verified');

    const approveAudit = await prisma.auditLog.findFirst({
      where: { subject: `User:${userId}`, action: 'kyc_state_change' },
      orderBy: { createdAt: 'desc' },
    });
    expect(approveAudit).not.toBeNull();
  }, 90_000);
});
