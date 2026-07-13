/**
 * Web chat — check_balance end-to-end acceptance test.
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives:
 *
 *   signup → verify-email → login → kyc/submit (verified; wallets provisioned)
 *   → seed a settled USDT ledger entry on the user's TRON wallet
 *   → POST /chat/messages "what's my balance"  (LLM fake → check_balance)
 *       → 200, outcome.kind === 'balance', balances has USDT 12.5 on TRON, valued
 *   → POST /chat/messages "what's my USDT balance" (LLM fake → check_balance + asset)
 *       → 200, outcome.asset === 'USDT', a single balance line
 *
 * The ledger is the authoritative balance source (the wallet provider's getBalance
 * is irrelevant here), so we seed a Transaction + LedgerEntry directly. The real
 * ConfigRateProvider supplies the mid-market valuation (no override).
 *
 * Bootstrap mirrors web-chat.e2e-spec.ts.
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
import { mintTier1User } from './helpers/mint-verified-user';

jest.setTimeout(180_000);

const API_ROOT = join(__dirname, '..');

interface BalanceLine {
  asset: string;
  network: string;
  amount: string;
  fiatValue?: string;
}
interface BalanceOutcome {
  kind: string;
  fiatCurrency: string;
  asset?: string;
  totalFiatValue?: string;
  balances: BalanceLine[];
}

describe('Web chat check_balance — e2e (AppModule, Testcontainers Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stopContainer: () => Promise<void>;
  let fakeLlmProvider: jest.Mocked<LlmProvider>;

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
      WHATSAPP_PHONE_NUMBER_ID: 'test-pnid-e2e-web-balance',
      WHATSAPP_ACCESS_TOKEN: 'e2e-wa-access-token-web-balance-fake',
      WHATSAPP_APP_SECRET: 'e2e-web-balance-app-secret-123',
      WHATSAPP_VERIFY_TOKEN: 'e2e-verify-token-web-balance',
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-wb-directive-key-32bytes!!xxxx',
      RECEIPT_SIGNING_KEY: 'e2e-wb-receipt-signing-key-32b!!!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-web-balance',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-wb',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-web-balance',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-web-balance',
      JWT_SECRET: 'e2e-web-balance-jwt-secret-at-least-32-bytes!!',
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    delete process.env.ANTHROPIC_API_KEY;

    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    // Default: the agent extracts a check_balance intent (all assets). Individual
    // requests override with mockResolvedValueOnce for the asset-scoped case.
    fakeLlmProvider = {
      extractIntent: jest.fn().mockResolvedValue({ action: 'check_balance' }),
    };

    const fakeWalletProvider: jest.Mocked<IWalletProvider> = {
      provisionAddress: jest.fn().mockResolvedValue({
        address: 'TWebBalanceFakeAddr1234567',
        providerReference: 'fake-ref-web-balance',
      }),
      getBalance: jest.fn().mockResolvedValue({ balances: [] }),
      withdraw: jest.fn().mockResolvedValue({ txHash: 'h', reference: 'r' }),
      getWithdrawalStatus: jest
        .fn()
        .mockResolvedValue({ status: 'confirmed', txHash: 'h' }),
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

    const fakePaymentProvider: jest.Mocked<IPaymentProvider> = {
      createCollection: jest.fn(),
      verify: jest.fn(),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest.fn().mockResolvedValue({ externalMessageId: 'wamid.x' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.x' }),
      sendCtaUrl: jest.fn().mockResolvedValue({ externalMessageId: 'wamid.x' }),
      sendFlow: jest.fn().mockResolvedValue({ externalMessageId: 'wamid.x' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.x' }),
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

  // Monotonic counter so each onboarding uses a distinct email / phone / device
  // fingerprint (phone is a unique ChannelIdentity; the device binds per user).
  let onboardSeq = 0;

  /** Mints a verified tier_1 user and returns the access token + userId. */
  async function onboardVerifiedUser(): Promise<{
    accessToken: string;
    userId: string;
  }> {
    const seq = ++onboardSeq;
    const email = `e2e_wb_${Date.now()}_${seq}@test.com`;

    const { accessToken, userId } = await mintTier1User(app, {
      email,
      pin: '1357',
    });

    return { accessToken, userId };
  }

  it('seeded USDT balance → balance outcome (all assets) then single-asset scope', async () => {
    const { accessToken, userId } = await onboardVerifiedUser();

    // The new onboarding provisions wallets LAZILY (legacy /kyc/submit eager
    // WN-3 provisioning is retired) — hit the deposit-address endpoint once to
    // provision this user's TRON wallet, then seed a settled USDT ledger entry
    // on it (the ledger is authoritative).
    await request(app.getHttpServer())
      .get('/wallets/deposit-address')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ network: 'TRON' })
      .expect(200);
    const wallet = await prisma.wallet.findFirst({
      where: { userId, network: 'TRON' },
    });
    expect(wallet).not.toBeNull();

    const txn = await prisma.transaction.create({
      data: {
        userId,
        type: 'deposit',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: 'e2e-balance-seed-checksum',
        metadata: { asset: 'USDT', amount: '12.5', seeded: true },
      },
    });

    await prisma.ledgerEntry.create({
      data: {
        transactionId: txn.id,
        accountType: 'user_wallet',
        accountId: wallet!.id,
        currency: 'USDT',
        amount: '12.5',
        direction: 'credit',
        description: 'e2e seed deposit',
        balanceAfter: '12.5',
        sequence: 1,
        postedAt: new Date(),
      },
    });

    // 1. All assets — LLM fake returns { action: 'check_balance' }.
    const all = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: "what's my balance" })
      .expect(200);

    const allOutcome = (all.body as { outcome: BalanceOutcome }).outcome;
    expect(allOutcome.kind).toBe('balance');
    expect(allOutcome.fiatCurrency).toBe('NGN');
    expect(allOutcome.asset).toBeUndefined();

    const usdt = allOutcome.balances.find((b) => b.asset === 'USDT');
    expect(usdt).toBeDefined();
    expect(usdt!.network).toBe('TRON');
    expect(usdt!.amount).toBe('12.5');
    // The mid-market valuation is present (exact figure depends on config rate).
    expect(usdt!.fiatValue).toBeTruthy();
    expect(allOutcome.totalFiatValue).toBeTruthy();
    // The reply text lists the holding (no FX-spread line).
    const allReply = (all.body as { reply: { text: string } }).reply.text;
    expect(allReply).toContain('USDT');
    expect(allReply.toLowerCase()).not.toContain('spread');

    // 2. Single asset — LLM fake returns { action: 'check_balance', asset: 'USDT' }.
    fakeLlmProvider.extractIntent.mockResolvedValueOnce({
      action: 'check_balance',
      asset: 'USDT',
    });
    const one = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: "what's my USDT balance" })
      .expect(200);

    const oneOutcome = (one.body as { outcome: BalanceOutcome }).outcome;
    expect(oneOutcome.kind).toBe('balance');
    expect(oneOutcome.asset).toBe('USDT');
    expect(oneOutcome.balances).toHaveLength(1);
    expect(oneOutcome.balances[0].asset).toBe('USDT');
    expect(oneOutcome.balances[0].amount).toBe('12.5');
  }, 120_000);

  it('verified user with no holdings → balance outcome with zero amounts', async () => {
    const { accessToken } = await onboardVerifiedUser();

    const res = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'show my assets' })
      .expect(200);

    const outcome = (res.body as { outcome: BalanceOutcome }).outcome;
    expect(outcome.kind).toBe('balance');
    const usdt = outcome.balances.find((b) => b.asset === 'USDT');
    expect(usdt).toBeDefined();
    expect(usdt!.amount).toBe('0');
  }, 120_000);

  it('unverified user → needs_kyc (balance is KYC-gated)', async () => {
    // In the redesigned onboarding a logged-in user is always at least tier_1
    // (email verification grants it), so a genuinely `unverified` account can
    // only be produced by dropping the tier. Seed that to exercise the
    // below-tier_1 balance gate (check_balance → needs_kyc).
    const { accessToken, userId } = await mintTier1User(app, {
      email: `e2e_wb_unverified_${Date.now()}@test.com`,
    });
    await prisma.user.update({
      where: { id: userId },
      data: { kycTier: 'unverified' },
    });

    const res = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: "what's my balance" })
      .expect(200);

    expect((res.body as { outcome: { kind: string } }).outcome.kind).toBe(
      'needs_kyc',
    );
  }, 120_000);
});
