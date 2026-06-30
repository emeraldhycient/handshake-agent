/**
 * Admin Comms console — notification-template CRUD/preview + read-only WhatsApp
 * config — end-to-end acceptance test (Phase 4, wave 1).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives the
 * controllers added in this task with NO mocking of the admin/db path:
 *
 *   1. bootstrap → accept → login as super_admin (holds every grant)
 *   2. POST /admin/auth/step-up (writes need a fresh step-up)
 *   3. POST /admin/notification-templates → 201; DB row created + audit
 *      `config_change`
 *   4. GET  /admin/notification-templates → the created template is listed
 *   5. POST /admin/notification-templates/preview → renderedText 'Hi Ada'
 *   6. GET  /admin/whatsapp/config → non-secret values + presence booleans; the
 *      actual secret string is asserted NOT present in the response body
 *
 * Bootstrap mirrors admin-end-users.e2e-spec.ts: Testcontainers Postgres +
 * prisma migrate deploy, all env (incl. ADMIN_* + a known WHATSAPP_APP_SECRET) set
 * BEFORE importing AppModule, and the four external-edge fakes overridden.
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
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-admin-comms';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-admin-comms-fake';
const WA_APP_SECRET = 'e2e-admin-comms-super-secret-app-secret-xyz';
const WA_VERIFY_TOKEN = 'e2e-verify-token-admin-comms';

const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token-comms';
const ROOT_EMAIL = 'root-comms@e2e.test';
const ROOT_PASSWORD = 'rootPassword123!';

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
interface TemplateBody {
  id: string;
  templateKey: string;
  language: string;
  channel: string;
  contentText: string;
  variables: { name: string; type: string; description: string }[];
}
interface TemplateListBody {
  items: TemplateBody[];
}
interface PreviewBody {
  renderedSubject: string | null;
  renderedText: string;
}
interface WhatsAppConfigBody {
  graphVersion: string;
  phoneNumberId: string;
  hasAppSecret: boolean;
  hasFlowPrivateKey: boolean;
  hasVerifyToken: boolean;
}

describe('Admin notification templates + WhatsApp config — e2e (AppModule, Testcontainers Postgres)', () => {
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
      DIRECTIVE_SIGNING_KEY: 'e2e-comms-directive-key-32bytes!!xx',
      RECEIPT_SIGNING_KEY: 'e2e-comms-receipt-signing-key-32by',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-comms',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-comms',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-comms',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-comms',
      JWT_SECRET: 'e2e-comms-jwt-secret-at-least-32-bytes!!',
      ADMIN_JWT_SECRET: 'e2e-comms-admin-jwt-secret-32bytes!!',
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
        address: 'TCommsFakeWalletAddr123456789',
        providerReference: 'fake_blockradar_ref_comms_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-comms-stub',
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
        bankName: 'Comms Test MFB',
        providerRef: 'flw_fake_ref_comms_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_comms_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };
    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.comms.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.comms.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.comms.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.comms.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.comms.e2e' }),
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

  it('super_admin creates, lists, previews a template and reads non-secret WhatsApp config', async () => {
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

    // 2. A write requires a fresh step-up — without it, 403.
    await request(app.getHttpServer())
      .post('/admin/notification-templates')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({
        templateKey: 'transaction.completed',
        language: 'en',
        channel: 'whatsapp',
        contentText: 'Hi {{name}}, your transfer is done.',
        variables: [{ name: 'name', type: 'string', description: 'User.' }],
      })
      .expect(403);

    // Complete the step-up challenge with the password.
    await request(app.getHttpServer())
      .post('/admin/auth/step-up')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ password: ROOT_PASSWORD })
      .expect(204);

    // 3. POST /admin/notification-templates — now succeeds (201). DB row + audit.
    const createRes = await request(app.getHttpServer())
      .post('/admin/notification-templates')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({
        templateKey: 'transaction.completed',
        language: 'en',
        channel: 'whatsapp',
        contentText: 'Hi {{name}}, your transfer is done.',
        variables: [{ name: 'name', type: 'string', description: 'User.' }],
      })
      .expect(201);
    const created = createRes.body as TemplateBody;
    expect(created.templateKey).toBe('transaction.completed');
    expect(created.contentText).toBe('Hi {{name}}, your transfer is done.');

    const dbRow = await prisma.notificationTemplate.findUnique({
      where: {
        templateKey_language_channel: {
          templateKey: 'transaction.completed',
          language: 'en',
          channel: 'whatsapp',
        },
      },
    });
    expect(dbRow).not.toBeNull();
    expect(dbRow?.contentText).toBe('Hi {{name}}, your transfer is done.');

    const audit = await prisma.auditLog.findFirst({
      where: {
        subject: 'NotificationTemplate:transaction.completed:en:whatsapp',
        action: 'config_change',
      },
    });
    expect(audit).not.toBeNull();

    // 4. GET /admin/notification-templates — the created template is listed.
    const listRes = await request(app.getHttpServer())
      .get('/admin/notification-templates')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const list = listRes.body as TemplateListBody;
    expect(
      list.items.some((t) => t.templateKey === 'transaction.completed'),
    ).toBe(true);

    // 5. POST /admin/notification-templates/preview — renderedText 'Hi Ada'.
    const previewRes = await request(app.getHttpServer())
      .post('/admin/notification-templates/preview')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ contentText: 'Hi {{name}}', variables: { name: 'Ada' } })
      .expect(201);
    const preview = previewRes.body as PreviewBody;
    expect(preview.renderedText).toBe('Hi Ada');
    expect(preview.renderedSubject).toBeNull();

    // 6. GET /admin/whatsapp/config — non-secret values + presence booleans; the
    //    actual secret string must NOT appear anywhere in the response body.
    const cfgRes = await request(app.getHttpServer())
      .get('/admin/whatsapp/config')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const cfg = cfgRes.body as WhatsAppConfigBody;
    expect(cfg.phoneNumberId).toBe(WHATSAPP_PHONE_NUMBER_ID);
    expect(cfg.hasAppSecret).toBe(true);
    expect(cfg.hasVerifyToken).toBe(true);
    expect(cfg.hasFlowPrivateKey).toBe(false);
    expect(JSON.stringify(cfgRes.body)).not.toContain(WA_APP_SECRET);
    expect(JSON.stringify(cfgRes.body)).not.toContain(WA_VERIFY_TOKEN);
  }, 90_000);
});
