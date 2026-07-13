/**
 * Treasury operator PAYOUT-RETRY (go-readiness #2, WRITE) — end-to-end acceptance.
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives the
 * new endpoint with NO mocking of the admin/db path:
 *
 *   1. bootstrap → accept → login as super_admin (holds every grant, incl. the
 *      newly-cataloged POST /admin/treasury/payouts/:id/retry permission)
 *   2. seed a verified user + a settling SELL txn + a pending processor_payout
 *      outbox row → POST retry: 403 without step-up, then step-up → 200
 *      retry_enqueued; the outbox row is reset to `pending`; an admin_override
 *      audit row is written for the transaction (append-only)
 *   3. a COMPLETED sell payout → 409 (no double-pay), outbox untouched
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
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-payout-retry';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-payout-retry-fake';
const WA_APP_SECRET = 'e2e-payout-retry-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-payout-retry';

const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token-payout-retry';
const ROOT_EMAIL = 'root-payout-retry@e2e.test';
const ROOT_PASSWORD = 'rootPassword123!';

interface BootstrapBody {
  invitationToken: string;
}
interface LoginBody {
  accessToken: string;
}
interface RetryBody {
  payoutId: string;
  transactionId: string;
  status: string;
  reChecked: boolean;
}

interface SeededPayout {
  outboxId: string;
  transactionId: string;
  userId: string;
}

describe('Treasury payout-retry — e2e (AppModule, Testcontainers Postgres)', () => {
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
      DIRECTIVE_SIGNING_KEY: 'e2e-payout-retry-directive-key-32byte',
      RECEIPT_SIGNING_KEY: 'e2e-payout-retry-receipt-signing-32x',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-payout-retry',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-pr',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-payout-retry',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-payout-retry',
      JWT_SECRET: 'e2e-payout-retry-jwt-secret-at-least-32-bytes!',
      ADMIN_JWT_SECRET: 'e2e-payout-retry-admin-jwt-secret-32b!',
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
        address: 'TPayoutRetryFakeWalletAddr123456789',
        providerReference: 'fake_blockradar_ref_pr_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-pr-stub',
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
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.pr.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.pr.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.pr.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.pr.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.pr.e2e' }),
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

  /**
   * Seed a verified user + a SELL or SEND transaction in the given status + its
   * outbox row (processor_payout / onchain_send, status in_progress so the payout
   * queue surfaces it). velocityFiatAmount is the fiat value the re-check reads —
   * present on both real sell + send metadata. Returns the outbox id (the endpoint's
   * :id), the txn id, and the user id.
   */
  async function seedPayout(
    type: 'sell' | 'send',
    txnStatus: 'settling' | 'completed',
  ): Promise<SeededPayout> {
    const user = await prisma.user.create({
      data: { status: 'active', kycStatus: 'verified', kycTier: 'tier_2' },
    });
    const idempotencyKey = randomUUID();
    const metadata =
      type === 'sell'
        ? {
            asset: 'USDT',
            netFiatAmount: '10000',
            fiatCurrency: 'NGN',
            velocityFiatAmount: '10000',
            velocityFiatCurrency: 'NGN',
            cryptoAmount: '6.25',
            walletId: 'wallet-e2e',
            providerRef: idempotencyKey,
          }
        : {
            asset: 'USDT',
            velocityFiatAmount: '10000',
            velocityFiatCurrency: 'NGN',
            totalDebit: '6.30',
            walletId: 'wallet-e2e',
            toAddress: 'TSendDestAddrE2E123456789',
            network: 'TRON',
            providerRef: idempotencyKey,
          };
    const txn = await prisma.transaction.create({
      data: {
        userId: user.id,
        type,
        status: txnStatus,
        idempotencyKey,
        requestChecksum: 'e2e-checksum',
        metadata,
      },
    });
    const outbox = await prisma.settlementOutbox.create({
      data: {
        transactionId: txn.id,
        settlementType: type === 'sell' ? 'processor_payout' : 'onchain_send',
        payload: { reference: idempotencyKey },
        idempotencyKey,
        status: 'in_progress',
        processorRef: type === 'sell' ? 'flw_transfer_e2e' : 'br_withdraw_e2e',
      },
    });
    return { outboxId: outbox.id, transactionId: txn.id, userId: user.id };
  }

  async function stepUp(token: string): Promise<void> {
    await request(app.getHttpServer())
      .post('/admin/auth/step-up')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: ROOT_PASSWORD })
      .expect(204);
  }

  // ===========================================================================
  // MAIN TEST
  // ===========================================================================

  it('retries a stuck settling sell + send payout (step-up), resets the outbox + audits; rejects a completed one (no double-pay)', async () => {
    // 1. Bootstrap + accept + login as super_admin (holds every grant).
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

    // 2. Seed a stuck settling SELL payout.
    const stuck = await seedPayout('sell', 'settling');

    // 2a. POST retry WITHOUT step-up → 403 (the write is step-up-gated).
    await request(app.getHttpServer())
      .post(`/admin/treasury/payouts/${stuck.outboxId}/retry`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ reason: 'Payout stuck after a missed webhook' })
      .expect(403);

    // 2b. Step-up, then retry → 200 retry_enqueued.
    await stepUp(rootToken);
    const retryRes = await request(app.getHttpServer())
      .post(`/admin/treasury/payouts/${stuck.outboxId}/retry`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ reason: 'Payout stuck after a missed webhook' })
      .expect(200);
    const retry = retryRes.body as RetryBody;
    expect(retry.status).toBe('retry_enqueued');
    expect(retry.transactionId).toBe(stuck.transactionId);
    expect(retry.reChecked).toBe(true);

    // DB: the outbox row was re-armed to `pending` for the reconciliation worker.
    const rearmed = await prisma.settlementOutbox.findUniqueOrThrow({
      where: { id: stuck.outboxId },
    });
    expect(rearmed.status).toBe('pending');

    // DB: an append-only admin_override audit row exists for this transaction.
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'admin_override',
        subject: `Transaction:${stuck.transactionId}`,
      },
    });
    expect(audit).not.toBeNull();

    // 3. A stuck settling SEND payout retries too (re-screens the destination
    //    address via the real ComplianceService, then re-arms the onchain_send row).
    const send = await seedPayout('send', 'settling');
    await stepUp(rootToken);
    const sendRes = await request(app.getHttpServer())
      .post(`/admin/treasury/payouts/${send.outboxId}/retry`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ reason: 'On-chain send stuck; re-driving' })
      .expect(200);
    expect((sendRes.body as RetryBody).status).toBe('retry_enqueued');
    const sendRearmed = await prisma.settlementOutbox.findUniqueOrThrow({
      where: { id: send.outboxId },
    });
    expect(sendRearmed.status).toBe('pending');

    // 4. A COMPLETED payout must be rejected (no double-pay) — the outbox row is
    //    left untouched. Step up again to pass the guard chain.
    const done = await seedPayout('sell', 'completed');
    await stepUp(rootToken);
    await request(app.getHttpServer())
      .post(`/admin/treasury/payouts/${done.outboxId}/retry`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ reason: 'Attempt to retry a completed payout' })
      .expect(409);

    const untouched = await prisma.settlementOutbox.findUniqueOrThrow({
      where: { id: done.outboxId },
    });
    expect(untouched.status).toBe('in_progress');
  }, 90_000);
});
