/**
 * Admin metrics / dashboard — end-to-end acceptance test (Phase 5 — FINAL).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives the
 * READ-ONLY metrics controller with NO mocking of the admin/db path:
 *
 *   1.  bootstrap → accept → login as super_admin (holds every grant)
 *   2.  seed a few end-users + Transactions (+ platform-fee legs) across dates
 *   3.  GET /admin/metrics/dashboard?from=&to=  → sane aggregates (txn counts,
 *        a success rate, revenue by currency, kyc funnel, active users, service health)
 *   4.  invite a 'support' admin (holds Metrics:read) → support CAN read the dashboard
 *
 * Bootstrap mirrors admin-end-users.e2e-spec.ts: Testcontainers Postgres +
 * prisma migrate deploy, all env set BEFORE importing AppModule, and the four
 * external-edge fakes overridden via .overrideProvider().
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
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-admin-metrics';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-admin-metrics-fake';
const WA_APP_SECRET = 'e2e-admin-metrics-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-admin-metrics';

const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token-metrics';
const ROOT_EMAIL = 'root-metrics@e2e.test';
const ROOT_PASSWORD = 'rootPassword123!';
const SUPPORT_EMAIL = 'support-metrics@e2e.test';
const SUPPORT_PASSWORD = 'supportPassword123!';

// The query window the e2e asserts against; all in-range seeds fall inside it.
const FROM = '2026-06-01';
const TO = '2026-06-30';

interface BootstrapBody {
  invitationToken: string;
}
interface LoginBody {
  accessToken: string;
}
interface InviteBody {
  invitationToken: string;
}
interface RolesBody {
  roles: { id: string; name: string }[];
}
interface DashboardBody {
  txnVolume: {
    byType: {
      type: string;
      count: number;
      completed: number;
      failed: number;
      stuck: number;
    }[];
    series: { date: string; count: number }[];
    successRate: number;
  };
  revenue: {
    totalFeesByCurrency: { currency: string; amount: string }[];
    totalSpreadByCurrency: { currency: string; amount: string }[];
    txnCount: number;
  };
  kycFunnel: {
    byStatus: { status: string; count: number }[];
    byTier: { tier: string; count: number }[];
  };
  activeUsers: {
    activeInRange: number;
    newInRange: number;
    totalUsers: number;
  };
  serviceHealth: {
    services: {
      service: string;
      total: number;
      completed: number;
      failed: number;
      successRate: number;
    }[];
  };
}

describe('Admin metrics / dashboard — e2e (AppModule, Testcontainers Postgres)', () => {
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
      DIRECTIVE_SIGNING_KEY: 'e2e-metrics-directive-key-32bytes!xx',
      RECEIPT_SIGNING_KEY: 'e2e-metrics-receipt-signing-key32xx',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-metrics',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-metrics',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-metrics',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-metrics',
      JWT_SECRET: 'e2e-metrics-jwt-secret-at-least-32-bytes!!',
      ADMIN_JWT_SECRET: 'e2e-metrics-admin-jwt-secret-32bytes!!',
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
        address: 'TMetricsFakeWalletAddr123456789',
        providerReference: 'fake_blockradar_ref_metrics_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-metrics-stub',
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
        bankName: 'Metrics Test MFB',
        providerRef: 'flw_fake_ref_metrics_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_metrics_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };
    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.m.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.m.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.m.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.m.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.m.e2e' }),
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

  // ── Seed helpers ─────────────────────────────────────────────────────────

  async function seedUser(over: {
    kycStatus: string;
    kycTier: string;
    createdAt: Date;
  }): Promise<string> {
    const user = await prisma.user.create({
      data: {
        kycStatus: over.kycStatus as never,
        kycTier: over.kycTier as never,
        createdAt: over.createdAt,
      },
      select: { id: true },
    });
    return user.id;
  }

  async function seedTxn(over: {
    userId: string;
    type: string;
    status: string;
    createdAt: Date;
  }): Promise<string> {
    const txn = await prisma.transaction.create({
      data: {
        userId: over.userId,
        type: over.type as never,
        status: over.status as never,
        idempotencyKey: randomUUID(),
        requestChecksum: `chk-${randomUUID()}`,
        metadata: {},
        createdAt: over.createdAt,
      },
      select: { id: true },
    });
    return txn.id;
  }

  async function seedFeeLeg(over: {
    txnId: string;
    amount: string;
    sequence: number;
    postedAt: Date;
  }): Promise<void> {
    await prisma.ledgerEntry.create({
      data: {
        transactionId: over.txnId,
        accountType: 'platform_float' as never,
        accountId: 'ngn_fees',
        currency: 'NGN',
        amount: over.amount,
        direction: 'credit' as never,
        description: 'fee revenue',
        balanceAfter: over.amount,
        sequence: over.sequence,
        postedAt: over.postedAt,
      },
    });
  }

  async function acceptAndLogin(
    invitationToken: string,
    password: string,
    email: string,
  ): Promise<string> {
    await request(app.getHttpServer())
      .post('/admin/invitations/accept')
      .send({ token: invitationToken, password })
      .expect(200);
    const login = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password })
      .expect(200);
    return (login.body as LoginBody).accessToken;
  }

  // ===========================================================================
  // MAIN TEST
  // ===========================================================================

  it('aggregates the dashboard and lets a support admin (Metrics:read) read it', async () => {
    // 1. Bootstrap + accept + login as the first super_admin.
    const bootstrap = await request(app.getHttpServer())
      .post('/admin/bootstrap')
      .send({ token: BOOTSTRAP_TOKEN, email: ROOT_EMAIL })
      .expect(201);
    const rootInviteToken = (bootstrap.body as BootstrapBody).invitationToken;
    const rootToken = await acceptAndLogin(
      rootInviteToken,
      ROOT_PASSWORD,
      ROOT_EMAIL,
    );

    // 2. Seed users + transactions (+ fee legs) across dates.
    //    u1: verified/tier_1, created in range, transacts in range.
    //    u2: pending/unverified, created before range, transacts in range.
    const u1 = await seedUser({
      kycStatus: 'verified',
      kycTier: 'tier_1',
      createdAt: new Date('2026-06-05T00:00:00.000Z'),
    });
    const u2 = await seedUser({
      kycStatus: 'pending',
      kycTier: 'unverified',
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
    });

    // buy: 1 completed (u1), 1 failed (u2), 1 settling (u2, STUCK). sell: 1
    // completed (u1).
    const t1 = await seedTxn({
      userId: u1,
      type: 'buy',
      status: 'completed',
      createdAt: new Date('2026-06-06T08:00:00.000Z'),
    });
    await seedTxn({
      userId: u2,
      type: 'buy',
      status: 'failed',
      createdAt: new Date('2026-06-07T08:00:00.000Z'),
    });
    await seedTxn({
      userId: u2,
      type: 'buy',
      status: 'settling',
      createdAt: new Date('2026-06-07T09:00:00.000Z'),
    });
    const t3 = await seedTxn({
      userId: u1,
      type: 'sell',
      status: 'completed',
      createdAt: new Date('2026-06-08T08:00:00.000Z'),
    });

    // Fee legs for the two completed txns: NGN 100 + NGN 50 = 150.
    await seedFeeLeg({
      txnId: t1,
      amount: '100',
      sequence: 1,
      postedAt: new Date('2026-06-06T08:00:00.000Z'),
    });
    await seedFeeLeg({
      txnId: t3,
      amount: '50',
      sequence: 2,
      postedAt: new Date('2026-06-08T08:00:00.000Z'),
    });

    // 3. GET /admin/metrics/dashboard — sane aggregates.
    const dashRes = await request(app.getHttpServer())
      .get(`/admin/metrics/dashboard?from=${FROM}&to=${TO}`)
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const dash = dashRes.body as DashboardBody;

    // txn volume: 4 txns in range; success rate = completed 2 / (2 + 1) = 0.6667
    // (the settling buy is stuck, so it stays OUT of the success-rate denominator).
    const totalTxns = dash.txnVolume.byType.reduce((s, t) => s + t.count, 0);
    expect(totalTxns).toBe(4);
    expect(dash.txnVolume.successRate).toBeCloseTo(2 / 3, 4);
    expect(dash.txnVolume.series.length).toBeGreaterThan(0);
    // The endpoint surfaces per-type stuck alongside failed (the dashboard
    // "Failed / stuck tx" card reads both). buy: 1 failed, 1 settling → stuck 1.
    const buyVol = dash.txnVolume.byType.find((t) => t.type === 'buy')!;
    expect(buyVol.failed).toBe(1);
    expect(buyVol.stuck).toBe(1);

    // revenue: NGN fees sum to 150; spread is not separately ledgered → [].
    const ngn = dash.revenue.totalFeesByCurrency.find(
      (c) => c.currency === 'NGN',
    );
    expect(ngn?.amount).toBe('150');
    expect(dash.revenue.totalSpreadByCurrency).toEqual([]);
    expect(dash.revenue.txnCount).toBe(2);

    // kyc funnel: verified + pending statuses; tier_1 + unverified tiers present.
    expect(dash.kycFunnel.byStatus.some((s) => s.status === 'verified')).toBe(
      true,
    );
    expect(dash.kycFunnel.byTier.some((t) => t.tier === 'tier_1')).toBe(true);

    // active users: u1 + u2 transacted in range = 2; total users ≥ 2.
    expect(dash.activeUsers.activeInRange).toBe(2);
    expect(dash.activeUsers.totalUsers).toBeGreaterThanOrEqual(2);

    // service health: every transactable service is present.
    const services = dash.serviceHealth.services.map((s) => s.service).sort();
    expect(services).toEqual(['buy', 'sell', 'send', 'swap']);
    const buy = dash.serviceHealth.services.find((s) => s.service === 'buy')!;
    // serviceHealth counts every in-range buy regardless of status: 1 completed,
    // 1 failed, 1 settling → total 3.
    expect(buy.total).toBe(3);
    expect(buy.completed).toBe(1);
    expect(buy.failed).toBe(1);

    // 4. Invite a 'support' admin (holds Metrics:read) and read the dashboard.
    const rolesRes = await request(app.getHttpServer())
      .get('/admin/roles')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const supportRole = (rolesRes.body as RolesBody).roles.find(
      (r) => r.name === 'support',
    );
    expect(supportRole).toBeDefined();

    const supportInvite = await request(app.getHttpServer())
      .post('/admin/invitations')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ email: SUPPORT_EMAIL, roleId: supportRole!.id })
      .expect(201);
    const supportToken = await acceptAndLogin(
      (supportInvite.body as InviteBody).invitationToken,
      SUPPORT_PASSWORD,
      SUPPORT_EMAIL,
    );

    // support CAN read the dashboard (Metrics:read granted to every built-in role).
    await request(app.getHttpServer())
      .get(`/admin/metrics/dashboard?from=${FROM}&to=${TO}`)
      .set('Authorization', `Bearer ${supportToken}`)
      .expect(200);

    // No Bearer → 401.
    await request(app.getHttpServer())
      .get('/admin/metrics/dashboard')
      .expect(401);
  }, 90_000);
});
