/**
 * Wallet reads end-to-end acceptance test (Task 1).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives
 * the wallet read surfaces:
 *
 *   1. signup → verify-email → login → kyc/submit → accessToken
 *   2. GET /wallets/balances (Bearer) → 200 with fiatCurrency, assets
 *   3. GET /wallets/deposit-address (Bearer) → 200 with address
 *   4. GET /wallets/balances (no token) → 401
 *
 * Bootstrap mirrors auth.e2e-spec.ts:
 *   - Testcontainers Postgres + prisma migrate deploy
 *   - env vars set BEFORE dynamic import() of AppModule
 *   - Four provider overrides: LLM_PROVIDER, WALLET_PROVIDER, PAYMENT_PROVIDER, WHATSAPP_SENDER
 *   - WALLET_PROVIDER.getBalance returns { amount: '29.97', decimals: 6 }
 *   - WALLET_PROVIDER.provisionAddress returns { address: 'TADDR...', providerReference: 'pr' }
 */

import { execSync } from 'node:child_process';
import { join } from 'node:path';

// supertest is a CommonJS module; allowSyntheticDefaultImports lets us import it
// as a default, and ts-jest's CJS interop makes it callable as a function.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { INestApplication } from '@nestjs/common';

// Port symbol imports — these do NOT transitively import AppModule or trigger
// ConfigModule.forRoot(). They export only const symbols and interfaces.
import { LLM_PROVIDER } from '../src/modules/agent/application/ports/agent.port';
import { WALLET_PROVIDER } from '../src/modules/wallets/application/ports/wallet-provider.port';
import { AssetRegistry } from '../src/core/catalog/asset-registry';
import { seedRegistryAssets } from './helpers/seed-registry-assets';
import { mintTier1User } from './helpers/mint-verified-user';
import { randomUUID } from 'node:crypto';
import { PAYMENT_PROVIDER } from '../src/modules/treasury/application/ports/payment-provider.port';
import { WHATSAPP_SENDER } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';
import type { LlmProvider } from '../src/modules/agent/core/ports/llm-provider.port';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';
import type { IWhatsAppSender } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_ROOT = join(__dirname, '..');
const FAKE_WALLET_ADDRESS = 'TADDR...';
const FAKE_BLOCKRADAR_REF = 'pr';

// ===========================================================================
// THE TEST SUITE
// ===========================================================================

describe('Wallet reads — e2e (GET /wallets/balances + /wallets/deposit-address)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stopContainer: () => Promise<void>;
  let fakeLlmProvider: jest.Mocked<LlmProvider>;
  let fakeWalletProvider: jest.Mocked<IWalletProvider>;
  let fakePaymentProvider: jest.Mocked<IPaymentProvider>;
  let fakeSender: jest.Mocked<IWhatsAppSender>;

  // ── beforeAll: set env → import AppModule → boot ───────────────────────────

  beforeAll(async () => {
    // 1. Boot Postgres container and apply migrations
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

    // 2. Set ALL required env vars BEFORE importing AppModule.
    //    CRITICAL: ConfigModule.forRoot() calls validateEnv() synchronously
    //    at module decoration time (when app.module.ts is first required).
    //    These must be in process.env BEFORE that dynamic import() happens.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl,
      WHATSAPP_PHONE_NUMBER_ID: 'test-pnid-e2e-wallet-reads',
      WHATSAPP_ACCESS_TOKEN: 'e2e-wa-access-token-wallet-reads-fake',
      WHATSAPP_APP_SECRET: 'e2e-wallet-reads-app-secret-123',
      WHATSAPP_VERIFY_TOKEN: 'e2e-verify-token-wallet-reads',
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-wallet-reads-directive-key-32b!',
      RECEIPT_SIGNING_KEY: 'e2e-wallet-reads-receipt-key-32b!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-wallet-reads',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-wallet-reads',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-wallet-reads',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-wallet-reads',
      JWT_SECRET: 'e2e-wallet-reads-jwt-secret-at-least-32-bytes!!',
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    // Ensure ANTHROPIC_API_KEY is absent (not empty string) to pass optional validation
    delete process.env.ANTHROPIC_API_KEY;

    // 3. Dynamic import of AppModule (happens AFTER env vars are set above).
    //    Deferring this import is essential: ConfigModule.forRoot() calls
    //    validateEnv() synchronously when the module file is first required.
    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    // 4. Build fake providers with correct interface shapes
    fakeLlmProvider = {
      extractIntent: jest.fn().mockResolvedValue({
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '5000',
        fiatCurrency: 'NGN',
      }),
    };

    fakeWalletProvider = {
      provisionAddress: jest.fn().mockResolvedValue({
        address: FAKE_WALLET_ADDRESS,
        providerReference: FAKE_BLOCKRADAR_REF,
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '29.97', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-wallet-reads-stub',
        status: 'pending' as const,
      }),
      getWithdrawalStatus: jest
        .fn()
        .mockResolvedValue({ status: 'pending' as const }),
      listWalletAssets: jest.fn().mockResolvedValue([
        {
          assetId: 'e2e-usdt-tron-asset-id',
          symbol: 'USDT',
          name: 'Tether USD',
          network: 'TRON',
          contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
          decimals: 6,
          isMainnet: false,
        },
      ]),
    };

    fakePaymentProvider = {
      createCollection: jest.fn().mockResolvedValue({
        accountNumber: '0081234567',
        bankName: 'Wallet Reads Test MFB',
        providerRef: 'flw_fake_ref_wallet_reads_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_wallet_reads_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    fakeSender = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.wr.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.wr.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.wr.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.wr.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.wr.e2e' }),
    };

    // 5. Compile NestJS TestingModule with provider overrides
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
    seedRegistryAssets(app.get(AssetRegistry, { strict: false }));
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await stopContainer?.();
  });

  // ---------------------------------------------------------------------------
  // Helper: full signup → verify → login → kyc → accessToken
  // ---------------------------------------------------------------------------

  async function setupVerifiedUser(
    userEmail: string,
  ): Promise<{ accessToken: string; userId: string }> {
    const { accessToken, userId } = await mintTier1User(app, {
      email: userEmail,
      pin: '1357',
    });
    return { accessToken, userId };
  }

  // ===========================================================================
  // Test: Happy path wallet reads
  // ===========================================================================

  it('signup → verify → login → kyc → GET /wallets/balances + /wallets/deposit-address', async () => {
    const email = `e2e_wr_${Date.now()}@test.com`;
    const { accessToken, userId } = await setupVerifiedUser(email);

    // The balance endpoint reads the custodial LEDGER (not the provider's
    // getBalance — see WalletBalanceService), so seed a USDT credit on this
    // user's TRON wallet to assert it surfaces. The tier_1 mint no longer
    // eagerly provisions per-network wallets like legacy /kyc/submit did —
    // trigger lazy provisioning explicitly first.
    await request(app.getHttpServer())
      .get('/wallets/deposit-address?network=TRON')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const wallet = await prisma.wallet.findFirst({
      where: { userId, network: 'TRON' },
      select: { id: true },
    });
    if (wallet === null) throw new Error('no TRON wallet for user');
    const seedTxn = await prisma.transaction.create({
      data: {
        userId,
        type: 'buy',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: 'seed',
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
        amount: '29.97',
        description: 'seed credit for wallet-reads e2e (ledger-based balance)',
        balanceAfter: '29.97',
        sequence: 1,
        postedAt: new Date(),
      },
    });

    // GET /wallets/balances with Bearer token
    const balances = await request(app.getHttpServer())
      .get('/wallets/balances')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const balancesBody = balances.body as {
      fiatCurrency: string;
      totalFiatValue: string;
      assets: { symbol: string; amount: string }[];
    };
    expect(balancesBody.fiatCurrency).toBe('NGN');
    expect(balancesBody.assets[0]).toMatchObject({
      symbol: 'USDT',
      amount: '29.97',
    });
    expect(Number(balancesBody.totalFiatValue)).toBeGreaterThan(0);

    // GET /wallets/deposit-address with Bearer token
    const deposit = await request(app.getHttpServer())
      .get('/wallets/deposit-address')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const depositBody = deposit.body as { address: string };
    expect(depositBody.address).toBe(FAKE_WALLET_ADDRESS);

    // GET /wallets/balances without token → 401
    await request(app.getHttpServer()).get('/wallets/balances').expect(401);
  }, 120_000);
});
