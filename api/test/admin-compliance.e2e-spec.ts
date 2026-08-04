/**
 * Admin COMPLIANCE CONSOLE (Phase 3, sub-area C) — end-to-end acceptance test.
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives the
 * controller added in this task with NO mocking of the admin/db path:
 *
 *   1. bootstrap → accept → login as super_admin (holds every grant)
 *   2. seed a flagged ComplianceEvent via the testcontainer prisma
 *   3. GET  /admin/compliance/events?status=flagged → lists it
 *   4. POST .../events/:id/disposition {status:'approved'} → 403 without step-up,
 *      then step-up → 200; DB row status='approved' + dispositionAdminId set + an
 *      admin_review audit row
 *   5. POST /admin/compliance/aml-rules (step-up) → create
 *   6. PATCH /admin/compliance/aml-rules/:id → version incremented + a config_change
 *      audit row
 *
 * Bootstrap mirrors admin-txn-oversight.e2e-spec.ts.
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
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-admin-compliance';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-admin-compliance-fake';
const WA_APP_SECRET = 'e2e-admin-compliance-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-admin-compliance';

const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token-compliance';
const ROOT_EMAIL = 'root-compliance@e2e.test';
const ROOT_PASSWORD = 'rootPassword123!';

interface BootstrapBody {
  invitationToken: string;
}
interface LoginBody {
  accessToken: string;
}
interface EventListBody {
  items: { id: string; status: string; severity: string }[];
  nextCursor: string | null;
}
interface EventDetailBody {
  id: string;
  status: string;
  dispositionComment: string | null;
}
interface AmlRuleBody {
  id: string;
  ruleKey: string;
  version: number;
  enabled: boolean;
  action: string;
}

describe('Admin compliance console — e2e (AppModule, Testcontainers Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stopContainer: () => Promise<void>;

  let userId: string;

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
      DIRECTIVE_SIGNING_KEY: 'e2e-compl-directive-key-32bytes!xxx',
      RECEIPT_SIGNING_KEY: 'e2e-compl-receipt-signing-key-32x',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-compl',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-compl',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-compl',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-compl',
      JWT_SECRET: 'e2e-compl-jwt-secret-at-least-32-bytes!!',
      ADMIN_JWT_SECRET: 'e2e-compl-admin-jwt-secret-32bytes!!',
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
        address: 'TComplFakeWalletAddr123456789',
        providerReference: 'fake_blockradar_ref_compl_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-compl-stub',
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
        bankName: 'Compl Test MFB',
        providerRef: 'flw_fake_ref_compl_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_compl_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      findPayoutByReference: jest.fn().mockResolvedValue(null),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };
    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.compl.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.compl.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.compl.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.compl.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.compl.e2e' }),
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

    userId = (await prisma.user.create({ data: {} })).id;
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await stopContainer?.();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function seedFlaggedEvent(): Promise<string> {
    const row = await prisma.complianceEvent.create({
      data: {
        userId,
        eventType: 'sanctions_hit',
        severity: 'high',
        screeningProvider: 'open_sanctions',
        ruleOrHit: 'OFAC SDN',
        details: { hit: true },
        status: 'flagged',
      },
      select: { id: true },
    });
    return row.id;
  }

  // ===========================================================================
  // MAIN TEST
  // ===========================================================================

  it('lists a flagged event, disposes it (step-up), and CRUDs an AML rule — all audited', async () => {
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

    // 2. Seed a flagged compliance event.
    const eventId = await seedFlaggedEvent();

    // 3. GET /admin/compliance/events?status=flagged → lists it.
    const listRes = await request(app.getHttpServer())
      .get('/admin/compliance/events?status=flagged')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const list = listRes.body as EventListBody;
    expect(list.items.every((e) => e.status === 'flagged')).toBe(true);
    expect(list.items.some((e) => e.id === eventId)).toBe(true);

    // 4a. POST disposition WITHOUT step-up → 403.
    await request(app.getHttpServer())
      .post(`/admin/compliance/events/${eventId}/disposition`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ status: 'approved', comment: 'verified manually' })
      .expect(403);

    // 4b. Complete the step-up challenge with the password.
    await request(app.getHttpServer())
      .post('/admin/auth/step-up')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ password: ROOT_PASSWORD })
      .expect(204);

    // 4c. POST disposition → 200, status='approved'.
    const dispRes = await request(app.getHttpServer())
      .post(`/admin/compliance/events/${eventId}/disposition`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ status: 'approved', comment: 'verified manually' })
      .expect(200);
    const disp = dispRes.body as EventDetailBody;
    expect(disp.id).toBe(eventId);
    expect(disp.status).toBe('approved');
    expect(disp.dispositionComment).toBe('verified manually');

    // DB: ComplianceEvent.status='approved' + dispositionAdminId set.
    const dbEvent = await prisma.complianceEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    expect(dbEvent.status).toBe('approved');
    expect(dbEvent.dispositionAdminId).not.toBeNull();
    expect(dbEvent.dispositionComment).toBe('verified manually');

    // DB: an admin_review audit row exists for this event.
    const reviewAudit = await prisma.auditLog.findFirst({
      where: {
        action: 'admin_review',
        subject: `ComplianceEvent:${eventId}`,
      },
    });
    expect(reviewAudit).not.toBeNull();

    // 5. POST /admin/compliance/aml-rules (step-up still fresh) → create.
    const ruleKey = `velocity_${randomUUID()}`;
    const createRes = await request(app.getHttpServer())
      .post('/admin/compliance/aml-rules')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({
        ruleKey,
        name: 'Daily velocity',
        description: 'Flags daily volume over threshold',
        ruleType: 'velocity_amount',
        action: 'flag',
        parameters: { window: '24h', limit: 1000000 },
      })
      .expect(201);
    const created = createRes.body as AmlRuleBody;
    expect(created.ruleKey).toBe(ruleKey);
    expect(created.version).toBe(1);

    // 6. PATCH /admin/compliance/aml-rules/:id → version incremented.
    const patchRes = await request(app.getHttpServer())
      .patch(`/admin/compliance/aml-rules/${created.id}`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ enabled: false, action: 'block' })
      .expect(200);
    const patched = patchRes.body as AmlRuleBody;
    expect(patched.version).toBe(2);
    expect(patched.enabled).toBe(false);
    expect(patched.action).toBe('block');

    // DB: a config_change audit row exists for the AML rule.
    const configAudit = await prisma.auditLog.findFirst({
      where: {
        action: 'config_change',
        subject: `AmlRule:${created.id}`,
      },
    });
    expect(configAudit).not.toBeNull();
  }, 90_000);
});
