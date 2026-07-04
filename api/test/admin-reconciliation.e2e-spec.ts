/**
 * Admin RECONCILIATION run-history + break lifecycle (Go-readiness #3) — e2e.
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest, with NO mocking
 * of the admin/db path, and drives the durable-reconciliation surface added in this
 * task:
 *
 *   1. bootstrap → accept → login as super_admin (holds every grant)
 *   2. seed a persisted ReconRun + a detected ReconBreak via the testcontainer prisma
 *   3. GET  /admin/reconciliation/runs → lists the run (keyset page)
 *   4. GET  /admin/reconciliation/runs/:id → run + its breaks
 *   5. GET  /admin/reconciliation/run-breaks/:id → break detail
 *   6. POST .../run-breaks/:id/resolve → 403 without step-up, then step-up → 200;
 *      DB status='resolved' + approvedByAdminId set + reason set + an admin_review
 *      audit row; the DETECTED FACTS (breakType/delta/currency) are IMMUTABLE
 *
 * Bootstrap mirrors admin-compliance.e2e-spec.ts.
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
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-admin-recon';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-admin-recon-fake';
const WA_APP_SECRET = 'e2e-admin-recon-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-admin-recon';

const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token-recon';
const ROOT_EMAIL = 'root-recon@e2e.test';
const ROOT_PASSWORD = 'rootPassword123!';

interface BootstrapBody {
  invitationToken: string;
}
interface LoginBody {
  accessToken: string;
}
interface RunListBody {
  items: { id: string; runType: string; status: string }[];
  nextCursor: string | null;
}
interface RunDetailBody {
  run: { id: string; runType: string; breaksDetected: number };
  breaks: { id: string; breakType: string; status: string; delta: string }[];
}
interface BreakBody {
  id: string;
  breakType: string;
  status: string;
  delta: string;
  currency: string;
  approvedByAdminId: string | null;
  reason: string | null;
}

describe('Admin reconciliation history — e2e (AppModule, Testcontainers Postgres)', () => {
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
      DIRECTIVE_SIGNING_KEY: 'e2e-recon-directive-key-32bytes!xxx',
      RECEIPT_SIGNING_KEY: 'e2e-recon-receipt-signing-key-32x',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-recon',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-recon',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-recon',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-recon',
      JWT_SECRET: 'e2e-recon-jwt-secret-at-least-32-bytes!!',
      ADMIN_JWT_SECRET: 'e2e-recon-admin-jwt-secret-32bytes!!',
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
        address: 'TReconFakeWalletAddr123456789',
        providerReference: 'fake_blockradar_ref_recon_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-recon-stub',
        status: 'pending' as const,
      }),
      getWithdrawalStatus: jest
        .fn()
        .mockResolvedValue({ status: 'pending' as const }),
      listWalletAssets: jest.fn().mockResolvedValue([]),
    };
    const fakePaymentProvider: jest.Mocked<IPaymentProvider> = {
      createCollection: jest.fn(),
      verify: jest.fn(),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };
    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.recon.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.recon.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.recon.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.recon.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.recon.e2e' }),
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

  async function seedRunWithBreak(): Promise<{
    runId: string;
    breakId: string;
  }> {
    const run = await prisma.reconRun.create({
      data: {
        runType: 'wallet_deposit',
        status: 'completed',
        totalChecked: 1,
        breaksDetected: 1,
        startedAt: new Date(),
        completedAt: new Date(),
      },
      select: { id: true },
    });
    const brk = await prisma.reconBreak.create({
      data: {
        reconRunId: run.id,
        breakType: 'over_credit',
        userId: (await prisma.user.create({ data: {} })).id,
        walletId: (await prisma.user.create({ data: {} })).id,
        currency: 'USDT',
        delta: '-50.5',
        status: 'detected',
      },
      select: { id: true },
    });
    return { runId: run.id, breakId: brk.id };
  }

  // ===========================================================================
  // MAIN TEST
  // ===========================================================================

  it('lists persisted runs, reads a break, and resolves it (step-up) — annotation-only + audited + immutable facts', async () => {
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

    // 2. Seed a persisted run + a detected break.
    const { runId, breakId } = await seedRunWithBreak();

    // 3. GET /admin/reconciliation/runs → lists the run.
    const runsRes = await request(app.getHttpServer())
      .get('/admin/reconciliation/runs?limit=10')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const runs = runsRes.body as RunListBody;
    expect(runs.items.some((r) => r.id === runId)).toBe(true);

    // 4. GET /admin/reconciliation/runs/:id → run + breaks.
    const detailRes = await request(app.getHttpServer())
      .get(`/admin/reconciliation/runs/${runId}`)
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const detail = detailRes.body as RunDetailBody;
    expect(detail.run.id).toBe(runId);
    expect(detail.breaks).toHaveLength(1);
    expect(detail.breaks[0].id).toBe(breakId);
    expect(detail.breaks[0].delta).toBe('-50.5');

    // 5. GET /admin/reconciliation/run-breaks/:id → break detail.
    const breakRes = await request(app.getHttpServer())
      .get(`/admin/reconciliation/run-breaks/${breakId}`)
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const brk = breakRes.body as BreakBody;
    expect(brk.status).toBe('detected');
    expect(brk.breakType).toBe('over_credit');

    // 6a. POST resolve WITHOUT step-up → 403.
    await request(app.getHttpServer())
      .post(`/admin/reconciliation/run-breaks/${breakId}/resolve`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ reason: 'Confirmed lagged provider balance.' })
      .expect(403);

    // 6b. Complete the step-up challenge.
    await request(app.getHttpServer())
      .post('/admin/auth/step-up')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ password: ROOT_PASSWORD })
      .expect(204);

    // 6c. POST resolve → 200, status='resolved'.
    const resolveRes = await request(app.getHttpServer())
      .post(`/admin/reconciliation/run-breaks/${breakId}/resolve`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ reason: 'Confirmed lagged provider balance.' })
      .expect(200);
    const resolved = resolveRes.body as BreakBody;
    expect(resolved.status).toBe('resolved');
    expect(resolved.approvedByAdminId).not.toBeNull();
    expect(resolved.reason).toBe('Confirmed lagged provider balance.');
    // Detected facts unchanged over the wire.
    expect(resolved.breakType).toBe('over_credit');
    expect(resolved.delta).toBe('-50.5');
    expect(resolved.currency).toBe('USDT');

    // DB: annotation applied; detected facts IMMUTABLE.
    const dbBreak = await prisma.reconBreak.findUniqueOrThrow({
      where: { id: breakId },
    });
    expect(dbBreak.status).toBe('resolved');
    expect(dbBreak.approvedByAdminId).not.toBeNull();
    expect(dbBreak.reason).toBe('Confirmed lagged provider balance.');
    expect(dbBreak.actionAt).not.toBeNull();
    expect(dbBreak.breakType).toBe('over_credit');
    expect(dbBreak.delta.toString()).toBe('-50.5');
    expect(dbBreak.currency).toBe('USDT');

    // DB: an admin_review audit row exists for this break.
    const reviewAudit = await prisma.auditLog.findFirst({
      where: { action: 'admin_review', subject: `ReconBreak:${breakId}` },
    });
    expect(reviewAudit).not.toBeNull();
  }, 90_000);
});
