/**
 * Admin transaction TRIAGE — end-to-end acceptance test (Phase 3, sub-area B).
 *
 * THIS PROVES THE MONEY PATH. It boots the REAL AppModule (Testcontainers
 * Postgres) via supertest and drives POST /admin/transactions/:id/mark-failed
 * end-to-end with NO mocking of the admin/db/engine path:
 *
 *   1. bootstrap → accept → login as super_admin (holds every grant)
 *   2. via the testcontainer SettlementPrismaRepository.createSellSettlingWithReserveAtomic,
 *      create a SETTLING sell: posts the USDT reserve (user_wallet → clearing).
 *   3. record the user_wallet ledger balance AFTER the reserve (and the pre-reserve seed).
 *   4. POST /admin/auth/step-up → stamp the session (the route requires a fresh step-up).
 *   5. POST /admin/transactions/:id/mark-failed { reason } → assert HTTP 200 + {refunded:true},
 *      then DB: Transaction.status='failed', the user_wallet ledger balance is RESTORED to
 *      its pre-reserve value (the clearing reserve was reversed), a CompensationRecord exists,
 *      and an AuditLog 'admin_override' row for the txn exists.
 *   6. POST mark-failed AGAIN → idempotent: still failed, and the ledger balance did NOT
 *      change again (no double-credit).
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

import { SettlementPrismaRepository } from '../src/modules/transactions/infrastructure/settlement.prisma.repository';
import { AssetRegistry } from '../src/core/catalog/asset-registry';
import configuration from '../src/core/config/configuration';
import type { PrismaService } from '../src/core/prisma/prisma.service';

/**
 * Minimal catalog-bearing config source for the AssetRegistry the settlement
 * repo now requires. Triage refunds render no fiat amounts, so the registry is
 * never dereferenced here — it only needs to construct.
 */
const catalogConfigSource = {
  get: <T>(key: string): T | undefined =>
    key === 'catalog' ? (configuration().catalog as unknown as T) : undefined,
};

jest.setTimeout(180_000);

const API_ROOT = join(__dirname, '..');
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-txn-triage';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-txn-triage-fake';
const WA_APP_SECRET = 'e2e-txn-triage-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-txn-triage';
const RECEIPT_SIGNING_KEY = 'e2e-txn-triage-receipt-signing-key32';

const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token-txn-triage';
const ROOT_EMAIL = 'root-txn-triage@e2e.test';
const ROOT_PASSWORD = 'rootPassword123!';

const RESERVE_AMOUNT = 16; // USDT reserved by the sell
const SEED_CREDIT = 100; // USDT seeded into the wallet before the reserve

interface BootstrapBody {
  invitationToken: string;
}
interface LoginBody {
  accessToken: string;
}
interface TriageBody {
  transactionId: string;
  status: string;
  refunded: boolean;
}

/** Minimal ConfigService stub the SettlementPrismaRepository constructor reads. */
class StubConfigService {
  get<T = unknown>(key: string): T {
    if (key === 'RECEIPT_SIGNING_KEY') return RECEIPT_SIGNING_KEY as T;
    return undefined as T;
  }
}

describe('Admin transaction triage — e2e (AppModule, Testcontainers Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let settlementRepo: SettlementPrismaRepository;
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

    settlementRepo = new SettlementPrismaRepository(
      prisma as unknown as PrismaService,
      new StubConfigService() as never,
      new AssetRegistry(catalogConfigSource),
    );

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
      DIRECTIVE_SIGNING_KEY: 'e2e-txn-triage-directive-key-32bytes!',
      RECEIPT_SIGNING_KEY,
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-txn-triage',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-txn-triage',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-txn-triage',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-txn-triage',
      JWT_SECRET: 'e2e-txn-triage-jwt-secret-at-least-32-bytes!!',
      ADMIN_JWT_SECRET: 'e2e-txn-triage-admin-jwt-secret-32bytes!',
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
        address: 'TTriageFakeWalletAddr123456789',
        providerReference: 'fake_blockradar_ref_txn_triage_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-triage-stub',
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

  /** The latest user_wallet ledger balance for a wallet (numeric), or 0. */
  async function userWalletBalance(walletId: string): Promise<number> {
    const latest = await prisma.ledgerEntry.findFirst({
      where: { accountType: 'user_wallet', accountId: walletId },
      orderBy: { sequence: 'desc' },
    });
    return latest?.balanceAfter ? Number(latest.balanceAfter) : 0;
  }

  /**
   * Seeds a KYC-verified user with a TRON wallet, a USDT ledger credit, and a sell
   * Proposal, then creates a SETTLING sell with its reserve posted (user_wallet →
   * clearing) via the engine's atomic create. Returns ids + the pre-reserve balance.
   */
  async function seedSettlingSell(): Promise<{
    txnId: string;
    walletId: string;
    balanceBeforeReserve: number;
  }> {
    const user = await prisma.user.create({
      data: { status: 'active', kycStatus: 'verified', kycTier: 'tier_1' },
    });

    const wallet = await prisma.wallet.create({
      data: {
        userId: user.id,
        network: 'TRON',
        address: `TTriageWallet${randomUUID().slice(0, 12)}`,
        providerReference: 'fake-provider-ref-triage',
        status: 'active',
      },
    });

    // Seed a USDT credit so the wallet has balance to reserve against.
    const seedTxn = await prisma.transaction.create({
      data: {
        userId: user.id,
        type: 'buy',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: 'seed-triage',
        fxRateSnapshot: '1600',
        metadata: {},
        pinVerifiedAt: new Date(),
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        transactionId: seedTxn.id,
        accountType: 'user_wallet',
        accountId: wallet.id,
        currency: 'USDT',
        direction: 'credit',
        amount: `${SEED_CREDIT}.000000`,
        description: 'seed credit for triage e2e',
        balanceAfter: `${SEED_CREDIT}.000000`,
        sequence: 1,
        postedAt: new Date(),
      },
    });

    const balanceBeforeReserve = await userWalletBalance(wallet.id);

    // A Proposal is required — the atomic create flips it to 'executing'.
    const proposal = await prisma.proposal.create({
      data: {
        userId: user.id,
        type: 'sell',
        status: 'confirmed',
        parameters: {},
        parametersChecksum: 'sum-triage',
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });

    const now = new Date();
    const { txn } = await settlementRepo.createSellSettlingWithReserveAtomic({
      txnData: {
        proposalId: proposal.id,
        userId: user.id,
        type: 'sell',
        status: 'settling',
        idempotencyKey: randomUUID(),
        requestChecksum: 'req-triage',
        fxRateSnapshot: '1600',
        metadata: {
          asset: 'USDT',
          cryptoAmount: `${RESERVE_AMOUNT}.000000`,
          walletId: wallet.id,
          fiatCurrency: 'NGN',
          netFiatAmount: '25000',
        },
        pinVerifiedAt: now,
      },
      proposalId: proposal.id,
      confirmedAt: now,
      velocityIncrement: {
        userId: user.id,
        fiatCurrency: 'NGN',
        fiatAmountStr: '25000',
        now,
      },
      walletId: wallet.id,
      cryptoAmount: `${RESERVE_AMOUNT}.000000`,
      asset: 'USDT',
      now,
    });

    return { txnId: txn.id, walletId: wallet.id, balanceBeforeReserve };
  }

  // ===========================================================================

  it('marks a settling sell failed, refunds the reserve, audits — and is idempotent', async () => {
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

    // 2. Seed a SETTLING sell with its reserve posted.
    const { txnId, walletId, balanceBeforeReserve } = await seedSettlingSell();

    // 3. The reserve debited the wallet by RESERVE_AMOUNT.
    const afterReserve = await userWalletBalance(walletId);
    expect(balanceBeforeReserve - afterReserve).toBeCloseTo(RESERVE_AMOUNT, 6);

    // 4. The route requires a fresh step-up — without it, 403.
    await request(app.getHttpServer())
      .post(`/admin/transactions/${txnId}/mark-failed`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ reason: 'payout provider confirmed cancelled' })
      .expect(403);

    // Complete the step-up challenge with the password.
    await request(app.getHttpServer())
      .post('/admin/auth/step-up')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ password: ROOT_PASSWORD })
      .expect(204);

    // 5. POST mark-failed → 200, refunded:true.
    const triageRes = await request(app.getHttpServer())
      .post(`/admin/transactions/${txnId}/mark-failed`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ reason: 'payout provider confirmed cancelled' })
      .expect(200);
    const triage = triageRes.body as TriageBody;
    expect(triage).toEqual({
      transactionId: txnId,
      status: 'failed',
      refunded: true,
    });

    // DB: Transaction.status === 'failed'.
    const txn = await prisma.transaction.findUniqueOrThrow({
      where: { id: txnId },
    });
    expect(txn.status).toBe('failed');

    // DB: the user_wallet ledger balance is RESTORED to its pre-reserve value.
    const afterRefund = await userWalletBalance(walletId);
    expect(afterRefund).toBeCloseTo(balanceBeforeReserve, 6);

    // DB: a CompensationRecord exists for this txn.
    const compensation = await prisma.compensationRecord.findFirst({
      where: { originatingTransactionId: txnId },
    });
    expect(compensation).not.toBeNull();

    // DB: an AuditLog 'admin_override' row references this txn.
    const audit = await prisma.auditLog.findFirst({
      where: { subject: `Transaction:${txnId}`, action: 'admin_override' },
    });
    expect(audit).not.toBeNull();

    // 6. POST mark-failed AGAIN → idempotent (still failed, NO double-credit).
    const repeatRes = await request(app.getHttpServer())
      .post(`/admin/transactions/${txnId}/mark-failed`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ reason: 'retry' })
      .expect(200);
    expect((repeatRes.body as TriageBody).status).toBe('failed');
    expect((repeatRes.body as TriageBody).refunded).toBe(true);

    // Balance did NOT change again — the second call short-circuited (no refund).
    const afterSecond = await userWalletBalance(walletId);
    expect(afterSecond).toBeCloseTo(balanceBeforeReserve, 6);
  }, 120_000);
});
