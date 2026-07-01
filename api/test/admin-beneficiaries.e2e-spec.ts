/**
 * Admin BENEFICIARY OVERSIGHT (Phase 3, sub-area D) — end-to-end acceptance test.
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives the
 * controller added in this task with NO mocking of the admin/db path:
 *
 *   1. bootstrap → accept → login as super_admin (holds every grant)
 *   2. seed a crypto beneficiary with firstUseLockedUntil in the future
 *   3. GET /admin/beneficiaries → it appears with coolingOffActive=true
 *   4. POST /admin/beneficiaries/:id/cooling-off-override → 403 without step-up,
 *      then step-up → 204; DB firstUseLockedUntil cleared + an admin_override
 *      audit row (subject Beneficiary:<id>)
 *
 * Bootstrap mirrors admin-treasury.e2e-spec.ts.
 */

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-admin-beneficiaries';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-admin-beneficiaries-fake';
const WA_APP_SECRET = 'e2e-admin-beneficiaries-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-admin-beneficiaries';

const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token-beneficiaries';
const ROOT_EMAIL = 'root-beneficiaries@e2e.test';
const ROOT_PASSWORD = 'rootPassword123!';

interface BootstrapBody {
  invitationToken: string;
}
interface LoginBody {
  accessToken: string;
}
interface BeneficiaryListBody {
  items: {
    id: string;
    type: string;
    coolingOffActive: boolean;
    firstUseLockedUntil: string | null;
  }[];
}

describe('Admin beneficiary oversight — e2e (AppModule, Testcontainers Postgres)', () => {
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

    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl,
      WHATSAPP_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: WA_ACCESS_TOKEN,
      WHATSAPP_APP_SECRET: WA_APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: WA_VERIFY_TOKEN,
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-beneficiaries-directive-key-32by!',
      RECEIPT_SIGNING_KEY: 'e2e-beneficiaries-receipt-key-32by!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-beneficiaries',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-beneficiaries',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-beneficiaries',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-beneficiaries',
      JWT_SECRET: 'e2e-beneficiaries-jwt-secret-at-least-32!',
      ADMIN_JWT_SECRET: 'e2e-beneficiaries-admin-jwt-secret-32by!',
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
        address: 'TBeneficiariesFakeWalletAddr12345',
        providerReference: 'fake_blockradar_ref_beneficiaries_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-beneficiaries-stub',
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
        bankName: 'Beneficiaries Test MFB',
        providerRef: 'flw_fake_ref_beneficiaries_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_beneficiaries_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };
    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.bn.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.bn.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.bn.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.bn.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.bn.e2e' }),
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

  /** Seed a crypto beneficiary with a future cooling-off lock. Returns its id. */
  async function seedLockedBeneficiary(): Promise<string> {
    const owner = await prisma.user.create({ data: {} });
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const ben = await prisma.beneficiary.create({
      data: {
        userId: owner.id,
        type: 'crypto_address',
        label: 'Cold wallet',
        cryptoAddress: `T${randomUUID().replace(/-/g, '').slice(0, 30)}`,
        cryptoAsset: 'USDT',
        cryptoNetwork: 'TRON',
        verificationStatus: 'pending',
        firstUseLockedUntil: future,
      },
      select: { id: true },
    });
    return ben.id;
  }

  // ===========================================================================
  // MAIN TEST
  // ===========================================================================

  it('lists a cooling-off beneficiary and overrides the lock (step-up) — audited', async () => {
    // 1. Bootstrap + accept + login as super_admin.
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

    // 2. Seed a cooling-off crypto beneficiary.
    const beneficiaryId = await seedLockedBeneficiary();

    // 3. GET /admin/beneficiaries → it appears with coolingOffActive=true.
    const listRes = await request(app.getHttpServer())
      .get('/admin/beneficiaries')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const list = listRes.body as BeneficiaryListBody;
    const seeded = list.items.find((b) => b.id === beneficiaryId);
    expect(seeded).toBeDefined();
    expect(seeded?.coolingOffActive).toBe(true);
    expect(seeded?.firstUseLockedUntil).not.toBeNull();

    // 4a. POST override WITHOUT step-up → 403.
    await request(app.getHttpServer())
      .post(`/admin/beneficiaries/${beneficiaryId}/cooling-off-override`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({})
      .expect(403);

    // 4b. Complete the step-up challenge with the password.
    await request(app.getHttpServer())
      .post('/admin/auth/step-up')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ password: ROOT_PASSWORD })
      .expect(204);

    // 4c. POST override → 204; the lock is cleared.
    await request(app.getHttpServer())
      .post(`/admin/beneficiaries/${beneficiaryId}/cooling-off-override`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({})
      .expect(204);

    // DB: firstUseLockedUntil cleared.
    const dbBen = await prisma.beneficiary.findUniqueOrThrow({
      where: { id: beneficiaryId },
    });
    expect(dbBen.firstUseLockedUntil).toBeNull();

    // DB: an admin_override audit row exists for this beneficiary.
    const overrideAudit = await prisma.auditLog.findFirst({
      where: {
        action: 'admin_override',
        subject: `Beneficiary:${beneficiaryId}`,
      },
    });
    expect(overrideAudit).not.toBeNull();
  }, 90_000);
});
