/**
 * Admin transactions + ledger oversight (Phase 3, sub-area A) — end-to-end
 * acceptance test. READ-ONLY: no money mutations.
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives
 * the controllers added in this task with NO mocking of the admin/db path:
 *
 *   1. bootstrap → accept → login as super_admin (holds every grant)
 *   2. seed Transactions (different statuses) + their LedgerEntry legs via the
 *      testcontainer prisma (one balanced txn, one deliberately unbalanced)
 *   3. GET  /admin/transactions?status=settling   → filters to the settling txn
 *   4. GET  /admin/transactions/:id               → returns legs + timeline
 *   5. POST /admin/ledger/verify/:transactionId   → balanced=true for a balanced
 *                                                    txn; balanced=false otherwise
 *
 * Bootstrap mirrors admin-end-users.e2e-spec.ts.
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
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-admin-txnov';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-admin-txnov-fake';
const WA_APP_SECRET = 'e2e-admin-txnov-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-admin-txnov';

const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token-txnov';
const ROOT_EMAIL = 'root-txnov@e2e.test';
const ROOT_PASSWORD = 'rootPassword123!';
const USER_EMAIL = 'amara-txnov@e2e.test';

interface BootstrapBody {
  invitationToken: string;
}
interface LoginBody {
  accessToken: string;
}
interface TxnListItem {
  id: string;
  userId: string;
  userEmail: string | null;
  type: string;
  status: string;
  asset: string | null;
  amount: string | null;
  fiatAmount: string | null;
  fiatCurrency: string | null;
  idempotencyKey: string;
}
interface TxnListBody {
  items: TxnListItem[];
  nextCursor: string | null;
  counts: { all: number; stuck: number; failed: number; refunds: number };
}
interface TxnDetailBody {
  id: string;
  userEmail: string | null;
  economics: {
    asset: string | null;
    amount: string | null;
    fiatAmount: string | null;
    fiatCurrency: string | null;
    rate: string | null;
    processingFee: string | null;
    fxSpreadBps: string | null;
    internalMargin: string | null;
  };
  ledgerLegs: {
    currency: string;
    direction: string;
    amount: string;
    sequence: number;
  }[];
  timeline: { status: string; at: string }[];
  providerReferences: { provider: string; reference: string }[];
}
interface IntegrityBody {
  transactionId: string;
  balanced: boolean;
  legCount: number;
  brokenAt: string | null;
}

describe('Admin transactions + ledger oversight — e2e (AppModule, Testcontainers Postgres)', () => {
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
      DIRECTIVE_SIGNING_KEY: 'e2e-txnov-directive-key-32bytes!xxx',
      RECEIPT_SIGNING_KEY: 'e2e-txnov-receipt-signing-key32xx',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-txnov',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-txnov',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-txnov',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-txnov',
      JWT_SECRET: 'e2e-txnov-jwt-secret-at-least-32-bytes!!',
      ADMIN_JWT_SECRET: 'e2e-txnov-admin-jwt-secret-32bytes!!',
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
        address: 'TTxnOvFakeWalletAddr123456789',
        providerReference: 'fake_blockradar_ref_txnov_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-txnov-stub',
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
        bankName: 'Txn Ov Test MFB',
        providerRef: 'flw_fake_ref_txnov_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_txnov_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };
    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.txnov.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.txnov.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.txnov.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.txnov.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.txnov.e2e' }),
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

    userId = (await prisma.user.create({ data: { email: USER_EMAIL } })).id;
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await stopContainer?.();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function seedTxn(
    type: string,
    status: string,
    createdAt: Date,
    extra?: {
      metadata?: Record<string, unknown>;
      processorTxRef?: string;
      onChainTxHash?: string;
    },
  ): Promise<string> {
    const txn = await prisma.transaction.create({
      data: {
        userId,
        type: type as never,
        status: status as never,
        idempotencyKey: randomUUID(),
        requestChecksum: `chk-${randomUUID()}`,
        metadata: (extra?.metadata ?? {}) as never,
        ...(extra?.processorTxRef !== undefined
          ? { processorTxRef: extra.processorTxRef }
          : {}),
        ...(extra?.onChainTxHash !== undefined
          ? { onChainTxHash: extra.onChainTxHash }
          : {}),
        createdAt,
        ...(status === 'settling' ? { executedAt: createdAt } : {}),
        ...(status === 'completed'
          ? { executedAt: createdAt, completedAt: createdAt }
          : {}),
      },
      select: { id: true },
    });
    return txn.id;
  }

  async function seedLeg(
    txnId: string,
    currency: string,
    amount: string,
    direction: 'debit' | 'credit',
    sequence: number,
    accountType = 'user_wallet',
    accountId = 'wallet-1',
  ): Promise<void> {
    await prisma.ledgerEntry.create({
      data: {
        transactionId: txnId,
        accountType: accountType as never,
        accountId,
        currency,
        amount,
        direction: direction as never,
        description: 'e2e seed',
        balanceAfter: '0',
        sequence,
        postedAt: new Date(),
      },
    });
  }

  // ===========================================================================
  // MAIN TEST — super_admin lists, reads detail, and verifies integrity
  // ===========================================================================

  it('super_admin lists/filters txns, reads detail (legs+timeline), and verifies integrity', async () => {
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

    // 2. Seed txns: a balanced settling one and an unbalanced completed one.
    const balancedTxnId = await seedTxn(
      'send',
      'settling',
      new Date('2026-03-01T00:00:00.000Z'),
    );
    // Balanced USDT legs: -10 (debit) + 10 (credit) = 0. `sequence` is
    // per-(accountType, accountId), so the credit leg lives on a different account.
    await seedLeg(balancedTxnId, 'USDT', '-10', 'debit', 1);
    await seedLeg(
      balancedTxnId,
      'USDT',
      '10',
      'credit',
      1,
      'platform_float',
      'float-1',
    );

    const unbalancedTxnId = await seedTxn(
      'buy',
      'completed',
      new Date('2026-03-02T00:00:00.000Z'),
      {
        metadata: {
          asset: 'USDT',
          cryptoAmount: '10.5',
          fiatAmount: '16500.00',
          fiatCurrency: 'NGN',
          fxRate: '1571.43',
          baseRate: '1548.00',
          processingFeeAmount: '82.50',
          spreadBps: '150',
          providerRef: 'br_wd_e2e_123',
        },
        processorTxRef: 'flw-ref-e2e',
      },
    );
    // Unbalanced NGN: only a single -5 debit leg. Distinct account so its
    // per-account sequence does not collide with the balanced txn's legs.
    await seedLeg(
      unbalancedTxnId,
      'NGN',
      '-5',
      'debit',
      1,
      'user_wallet',
      'wallet-ngn',
    );

    // 3. GET /admin/transactions?status=settling → only the settling txn.
    const listRes = await request(app.getHttpServer())
      .get('/admin/transactions?status=settling')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const list = listRes.body as TxnListBody;
    expect(list.items.every((t) => t.status === 'settling')).toBe(true);
    expect(list.items.some((t) => t.id === balancedTxnId)).toBe(true);
    expect(list.items.some((t) => t.id === unbalancedTxnId)).toBe(false);

    // 4. GET /admin/transactions/:id → legs + derived timeline.
    const detailRes = await request(app.getHttpServer())
      .get(`/admin/transactions/${balancedTxnId}`)
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const detail = detailRes.body as TxnDetailBody;
    expect(detail.id).toBe(balancedTxnId);
    expect(detail.ledgerLegs).toHaveLength(2);
    // Timeline derived from createdAt (created) + executedAt (settling).
    expect(detail.timeline.map((e) => e.status)).toEqual([
      'created',
      'settling',
    ]);

    // 4b. Phase 6b enrichment on the UNBALANCED (buy) txn: the list row now
    //     carries the joined user email + itemized amount leg + idem key, and
    //     the response carries the four view-tab counts.
    const allRes = await request(app.getHttpServer())
      .get('/admin/transactions')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const all = allRes.body as TxnListBody;
    expect(all.counts.all).toBeGreaterThanOrEqual(2);
    expect(all.counts.stuck).toBeGreaterThanOrEqual(1); // the settling txn
    const buyRow = all.items.find((t) => t.id === unbalancedTxnId)!;
    expect(buyRow.userEmail).toBe(USER_EMAIL);
    expect(buyRow.asset).toBe('USDT');
    expect(buyRow.amount).toBe('10.5');
    expect(buyRow.fiatAmount).toBe('16500.00');
    expect(buyRow.fiatCurrency).toBe('NGN');
    expect(buyRow.idempotencyKey).toBeTruthy();

    // 4c. Free-text q search matches the Flutterwave ref (string column).
    const qRes = await request(app.getHttpServer())
      .get('/admin/transactions?q=flw-ref-e2e')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const qBody = qRes.body as TxnListBody;
    expect(qBody.items.map((t) => t.id)).toContain(unbalancedTxnId);
    expect(qBody.items.map((t) => t.id)).not.toContain(balancedTxnId);

    // 4d. Detail economics + provider references on the buy txn. internalMargin
    //     = (fxRate − baseRate) × cryptoAmount = 23.43 × 10.5 = 246.015.
    const buyDetailRes = await request(app.getHttpServer())
      .get(`/admin/transactions/${unbalancedTxnId}`)
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const buyDetail = buyDetailRes.body as TxnDetailBody;
    expect(buyDetail.userEmail).toBe(USER_EMAIL);
    expect(buyDetail.economics).toEqual({
      asset: 'USDT',
      amount: '10.5',
      fiatAmount: '16500.00',
      fiatCurrency: 'NGN',
      rate: '1571.43',
      processingFee: '82.50',
      fxSpreadBps: '150',
      internalMargin: '246.015',
    });
    expect(buyDetail.providerReferences).toEqual([
      { provider: 'flutterwave', reference: 'flw-ref-e2e' },
      { provider: 'blockradar', reference: 'br_wd_e2e_123' },
    ]);
    // Ledger legs now project the per-account sequence.
    expect(detail.ledgerLegs.every((l) => typeof l.sequence === 'number')).toBe(
      true,
    );

    // 5a. POST /admin/ledger/verify/:id → balanced=true for the balanced txn.
    const okRes = await request(app.getHttpServer())
      .post(`/admin/ledger/verify/${balancedTxnId}`)
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const ok = okRes.body as IntegrityBody;
    expect(ok.transactionId).toBe(balancedTxnId);
    expect(ok.balanced).toBe(true);
    expect(ok.legCount).toBe(2);
    expect(ok.brokenAt).toBeNull();

    // 5b. → balanced=false for the deliberately-unbalanced txn.
    const badRes = await request(app.getHttpServer())
      .post(`/admin/ledger/verify/${unbalancedTxnId}`)
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const bad = badRes.body as IntegrityBody;
    expect(bad.balanced).toBe(false);
    expect(bad.brokenAt).toBe('NGN');

    // 6. GET /admin/ledger → per-account history reads (READ-ONLY).
    const histRes = await request(app.getHttpServer())
      .get(
        '/admin/ledger?accountType=user_wallet&accountId=wallet-1&currency=USDT',
      )
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const hist = histRes.body as { entries: { currency: string }[] };
    expect(hist.entries.every((e) => e.currency === 'USDT')).toBe(true);
  }, 90_000);
});
