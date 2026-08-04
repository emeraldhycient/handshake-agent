/**
 * Admin TREASURY OVERSIGHT (Phase 3, sub-area D) — end-to-end acceptance test.
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives the
 * controller added in this task with NO mocking of the admin/db path:
 *
 *   1. bootstrap → accept → login as super_admin (holds every grant)
 *   2. seed wallets + WalletBalance snapshots → GET /admin/treasury/balances
 *      aggregates per (network, asset)
 *   3. seed a TreasuryExposure + TreasuryAlert → GET /admin/treasury/alerts lists it
 *   4. POST /admin/treasury/alerts/:id/acknowledge → 403 without step-up, then
 *      step-up → 200; DB row acknowledgedByAdminId set + an admin_override audit row
 *   5. GET /admin/treasury/exposure + /withdrawal-policies parse
 *
 * Bootstrap mirrors admin-compliance.e2e-spec.ts.
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
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-admin-treasury';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-admin-treasury-fake';
const WA_APP_SECRET = 'e2e-admin-treasury-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-admin-treasury';

const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token-treasury';
const ROOT_EMAIL = 'root-treasury@e2e.test';
const ROOT_PASSWORD = 'rootPassword123!';

interface BootstrapBody {
  invitationToken: string;
}
interface LoginBody {
  accessToken: string;
}
interface BalancesBody {
  balances: {
    network: string;
    asset: string;
    totalAmount: string;
    walletCount: number;
  }[];
}
interface AlertListBody {
  items: { id: string; severity: string; acknowledgedAt: string | null }[];
}
interface AlertBody {
  id: string;
  acknowledgedAt: string | null;
}

describe('Admin treasury oversight — e2e (AppModule, Testcontainers Postgres)', () => {
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
      DIRECTIVE_SIGNING_KEY: 'e2e-treasury-directive-key-32bytes!xx',
      RECEIPT_SIGNING_KEY: 'e2e-treasury-receipt-signing-key32x',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-treasury',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-treasury',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-treasury',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-treasury',
      JWT_SECRET: 'e2e-treasury-jwt-secret-at-least-32-bytes!!',
      ADMIN_JWT_SECRET: 'e2e-treasury-admin-jwt-secret-32bytes!!',
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
        address: 'TTreasuryFakeWalletAddr123456789',
        providerReference: 'fake_blockradar_ref_treasury_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-treasury-stub',
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
        bankName: 'Treasury Test MFB',
        providerRef: 'flw_fake_ref_treasury_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_treasury_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      findPayoutByReference: jest.fn().mockResolvedValue(null),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };
    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.tr.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.tr.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.tr.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.tr.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.tr.e2e' }),
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

  /** A fresh user + provisioned TRON wallet (one wallet per user, network). */
  async function seedWalletWithBalance(
    asset: string,
    amount: string,
  ): Promise<void> {
    const owner = await prisma.user.create({ data: {} });
    const wallet = await prisma.wallet.create({
      data: {
        userId: owner.id,
        network: 'TRON',
        address: `addr-${randomUUID()}`,
        providerReference: `ref-${randomUUID()}`,
        status: 'active',
      },
    });
    await prisma.walletBalance.create({
      data: {
        walletId: wallet.id,
        asset,
        amount,
        assetDecimals: 6,
        source: 'provider_sync',
        syncedAt: new Date(),
      },
    });
  }

  // ===========================================================================
  // MAIN TEST
  // ===========================================================================

  it('aggregates balances, lists + acknowledges an alert (step-up), and reads exposure/policies — audited', async () => {
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

    // 2. Seed two wallets holding USDT → GET balances aggregates them.
    await seedWalletWithBalance('USDT', '250');
    await seedWalletWithBalance('USDT', '50');

    const balRes = await request(app.getHttpServer())
      .get('/admin/treasury/balances')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const balances = balRes.body as BalancesBody;
    const tronUsdt = balances.balances.find(
      (b) => b.network === 'TRON' && b.asset === 'USDT',
    );
    expect(tronUsdt).toBeDefined();
    expect(Number(tronUsdt?.totalAmount)).toBe(300);
    expect(tronUsdt?.walletCount).toBe(2);

    // 3. Seed an exposure + alert → GET alerts lists it (unacknowledged).
    const exposure = await prisma.treasuryExposure.create({
      data: {
        asset: 'USDT',
        fiatCurrency: 'NGN',
        cryptoHeld: '1000',
        fiatEquivalent: '1600000.00',
        fiatReserve: '500000.00',
        netExposure: '1100000.00',
        exposureLimitBps: 500,
        alertThresholdBps: 400,
        status: 'critical',
      },
    });
    const alert = await prisma.treasuryAlert.create({
      data: {
        exposureId: exposure.id,
        asset: 'USDT',
        severity: 'critical',
        message: 'Exposure breached the critical threshold',
        netExposure: '1100000.00',
        exposureLimit: '1000000.00',
      },
    });

    const alertsRes = await request(app.getHttpServer())
      .get('/admin/treasury/alerts?acknowledged=false')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const alerts = alertsRes.body as AlertListBody;
    expect(alerts.items.some((a) => a.id === alert.id)).toBe(true);

    // 4a. POST acknowledge WITHOUT step-up → 403.
    await request(app.getHttpServer())
      .post(`/admin/treasury/alerts/${alert.id}/acknowledge`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ note: 'reviewed' })
      .expect(403);

    // 4b. Complete the step-up challenge with the password.
    await request(app.getHttpServer())
      .post('/admin/auth/step-up')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ password: ROOT_PASSWORD })
      .expect(204);

    // 4c. POST acknowledge → 200, acknowledgedAt set.
    const ackRes = await request(app.getHttpServer())
      .post(`/admin/treasury/alerts/${alert.id}/acknowledge`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ note: 'reviewed' })
      .expect(200);
    const ack = ackRes.body as AlertBody;
    expect(ack.id).toBe(alert.id);
    expect(ack.acknowledgedAt).not.toBeNull();

    // DB: TreasuryAlert.acknowledgedByAdminId set + note persisted.
    const dbAlert = await prisma.treasuryAlert.findUniqueOrThrow({
      where: { id: alert.id },
    });
    expect(dbAlert.acknowledgedAt).not.toBeNull();
    expect(dbAlert.acknowledgedByAdminId).not.toBeNull();
    expect(dbAlert.acknowledgmentNote).toBe('reviewed');

    // DB: an admin_override audit row exists for this alert.
    const overrideAudit = await prisma.auditLog.findFirst({
      where: {
        action: 'admin_override',
        subject: `TreasuryAlert:${alert.id}`,
      },
    });
    expect(overrideAudit).not.toBeNull();

    // 5. GET exposure + withdrawal-policies parse (read-only).
    const expoRes = await request(app.getHttpServer())
      .get('/admin/treasury/exposure')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    expect(
      (expoRes.body as { items: { id: string }[] }).items.some(
        (e) => e.id === exposure.id,
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .get('/admin/treasury/withdrawal-policies')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
  }, 90_000);
});
