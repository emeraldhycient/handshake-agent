/**
 * Web sell + send + beneficiary-endpoints end-to-end acceptance test.
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives
 * the complete web HTTP paths added in Phase 5:
 *
 *   - POST /beneficiaries/bank-account   (name-enquiry → resolved name persisted)
 *   - POST /beneficiaries/crypto-address (address-pattern + first-use cooling-off)
 *   - GET  /beneficiaries?type=...       (list)
 *   - POST /chat/messages → sell/send proposal
 *   - POST /chat/proposals/:id/authorize → directive
 *   - POST /chat/proposals/:id/execute   → sell settling (payout) / send settling (onChain)
 *   - GET  /transactions/:id
 *
 * Failure paths:
 *   - invalid crypto address → 422 on POST /beneficiaries/crypto-address
 *   - sell execute when balance was spent after the proposal (TOCTOU) → 422
 *
 * Harness mirrors web-buy.e2e-spec.ts (same env + provider overrides). The LLM
 * fake returns buy/sell/send by inspecting the message text — no real Anthropic
 * call. Balance is seeded directly into the ledger (as a settled buy would).
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

import { WalletService } from '../src/modules/wallets/application/wallet.service';
import { mintTier1User } from './helpers/mint-verified-user';
import { LLM_PROVIDER } from '../src/modules/agent/application/ports/agent.port';
import { WALLET_PROVIDER } from '../src/modules/wallets/application/ports/wallet-provider.port';
import { AssetRegistry } from '../src/core/catalog/asset-registry';
import { seedRegistryAssets } from './helpers/seed-registry-assets';
import { PAYMENT_PROVIDER } from '../src/modules/treasury/application/ports/payment-provider.port';
import { WHATSAPP_SENDER } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';
import type { LlmProvider } from '../src/modules/agent/core/ports/llm-provider.port';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';
import type { IWhatsAppSender } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';

jest.setTimeout(180_000);

const API_ROOT = join(__dirname, '..');
const FLUTTERWAVE_WEBHOOK_SECRET = 'e2e-flw-webhook-secret-web-sellsend';

const FAKE_WALLET_ADDRESS = 'TWebSellSendFakeWalletAddr12345xx';
const FAKE_BLOCKRADAR_REF = 'fake_blockradar_ref_web_sellsend';
const FAKE_WITHDRAW_REF = 'e2e-onchain-withdraw-ref-stub';
const FAKE_PAYOUT_REF = 'payout_fake_ref_web_sellsend';
// Valid TRON address (matches ^T[1-9A-HJ-NP-Za-km-z]{33}$ — 34 chars).
const VALID_TRON_ADDRESS = 'TSendE2EBeneficiaryTronAddress1234';

// ===========================================================================

describe('Web sell + send + beneficiaries — e2e', () => {
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
      WHATSAPP_PHONE_NUMBER_ID: 'test-pnid-e2e-web-ss',
      WHATSAPP_ACCESS_TOKEN: 'e2e-wa-access-token-web-ss-fake',
      WHATSAPP_APP_SECRET: 'e2e-web-ss-app-secret-123',
      WHATSAPP_VERIFY_TOKEN: 'e2e-verify-token-web-ss',
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-web-ss-directive-key-32bytes!',
      RECEIPT_SIGNING_KEY: 'e2e-web-ss-receipt-key-32bytes!!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-web-ss',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-web-ss',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-web-ss',
      FLUTTERWAVE_WEBHOOK_SECRET,
      JWT_SECRET: 'e2e-web-ss-jwt-secret-at-least-32-bytes!!',
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    delete process.env.ANTHROPIC_API_KEY;

    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    // LLM fake — returns the intent matching the message text.
    fakeLlmProvider = {
      extractIntent: jest.fn().mockImplementation((text: string) => {
        if (/sell/i.test(text)) {
          return Promise.resolve({
            action: 'sell_crypto',
            asset: 'USDT',
            cryptoAmount: /\b8\b/.test(text) ? '8' : '10',
            fiatCurrency: 'NGN',
          });
        }
        if (/send/i.test(text)) {
          return Promise.resolve({
            action: 'send_crypto',
            asset: 'USDT',
            cryptoAmount: '5',
            network: 'TRON',
          });
        }
        return Promise.resolve({
          action: 'buy_crypto',
          asset: 'USDT',
          fiatAmount: '5000',
          fiatCurrency: 'NGN',
        });
      }),
    };

    // Each provision returns a UNIQUE address — the Wallet.address column is
    // globally unique, so multiple users in one DB cannot share an address.
    let walletCounter = 0;
    const fakeWalletProvider: jest.Mocked<IWalletProvider> = {
      provisionAddress: jest.fn().mockImplementation(() => {
        walletCounter += 1;
        return Promise.resolve({
          address: `${FAKE_WALLET_ADDRESS}${walletCounter}`,
          providerReference: `${FAKE_BLOCKRADAR_REF}-${walletCounter}`,
          network: 'TRON',
        });
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: FAKE_WITHDRAW_REF,
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

    const fakePaymentProvider: jest.Mocked<IPaymentProvider> = {
      createCollection: jest.fn().mockResolvedValue({
        accountNumber: '0089876543',
        bankName: 'Web SS Test MFB',
        providerRef: `va_${Date.now()}`,
        amount: '5000',
        currency: 'NGN',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_ss',
      }),
      verifyWebhookSignature: jest
        .fn()
        .mockImplementation(
          (header: unknown) => header === FLUTTERWAVE_WEBHOOK_SECRET,
        ),
      createPayout: jest
        .fn()
        .mockResolvedValue({ providerRef: FAKE_PAYOUT_REF }),
      verifyPayout: jest.fn().mockResolvedValue({
        status: 'successful',
        providerRef: FAKE_PAYOUT_REF,
        amount: '10',
        currency: 'NGN',
      }),
    };

    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.ss' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.ss' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.ss' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.ss' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.ss' }),
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
    seedRegistryAssets(app.get(AssetRegistry, { strict: false }));
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await stopContainer?.();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function setupVerifiedUser(
    userEmail: string,
    pin = '1357',
  ): Promise<{ accessToken: string; userId: string }> {
    const { accessToken, userId } = await mintTier1User(app, {
      email: userEmail,
      pin,
    });

    // mintTier1User grants tier_1 (email-verified). Sell/send/swap require
    // tier_2 (doc + liveness) — bump here to represent completed Sumsub
    // verification for these e2e users (a direct DB seed, the established
    // pattern across the money-path suites).
    await prisma.user.update({
      where: { id: userId },
      data: { kycTier: 'tier_2' },
    });

    return { accessToken, userId };
  }

  /** Seeds a USDT credit on the user's TRON wallet ledger (as a settled buy would). */
  async function seedUsdtBalance(
    userId: string,
    amount: number,
  ): Promise<string> {
    // Ensure the (user, TRON) wallet row exists (idempotent — the lazy path the
    // buy/sell/send flows use). KYC eager-provisioning is best-effort, so do not
    // rely on it here.
    const walletService = app.get(WalletService, { strict: false });
    await walletService.getOrProvisionNetworkWallet(userId, 'TRON');

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

    const latest = await prisma.ledgerEntry.findFirst({
      where: { accountType: 'user_wallet', accountId: wallet.id },
      orderBy: { sequence: 'desc' },
    });
    const seq = (latest?.sequence ?? 0) + 1;
    const before = latest?.balanceAfter ? Number(latest.balanceAfter) : 0;

    await prisma.ledgerEntry.create({
      data: {
        transactionId: seedTxn.id,
        accountType: 'user_wallet',
        accountId: wallet.id,
        currency: 'USDT',
        direction: 'credit',
        amount: amount.toFixed(6),
        description: 'seed credit for web sell/send e2e',
        balanceAfter: (before + amount).toFixed(6),
        sequence: seq,
        postedAt: new Date(),
      },
    });
    return wallet.id;
  }

  /** Posts a debit entry dropping the user_wallet USDT balance to `newBalance`. */
  async function debitUsdtBalanceTo(
    walletId: string,
    userId: string,
    newBalance: number,
  ): Promise<void> {
    const latest = await prisma.ledgerEntry.findFirst({
      where: { accountType: 'user_wallet', accountId: walletId },
      orderBy: { sequence: 'desc' },
    });
    const seq = (latest?.sequence ?? 0) + 1;
    const before = latest?.balanceAfter ? Number(latest.balanceAfter) : 0;

    const seedTxn = await prisma.transaction.create({
      data: {
        userId,
        type: 'send',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: 'spend',
        fxRateSnapshot: null,
        metadata: {},
        pinVerifiedAt: new Date(),
      },
    });

    await prisma.ledgerEntry.create({
      data: {
        transactionId: seedTxn.id,
        accountType: 'user_wallet',
        accountId: walletId,
        currency: 'USDT',
        direction: 'debit',
        amount: (before - newBalance).toFixed(6),
        description: 'simulated concurrent spend (TOCTOU) for e2e',
        balanceAfter: newBalance.toFixed(6),
        sequence: seq,
        postedAt: new Date(),
      },
    });
  }

  /** Authorizes the proposal then executes it; resolves with the execute Response. */
  async function authorizeAndExecute(
    accessToken: string,
    proposalId: string,
    deviceFingerprint?: string,
  ): Promise<import('supertest').Response> {
    const authRes = await request(app.getHttpServer())
      .post(`/chat/proposals/${proposalId}/authorize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    const { directiveId, nonce } = authRes.body as {
      directiveId: string;
      nonce: string;
    };

    const body: Record<string, unknown> = {
      directiveId,
      nonce,
      pin: '1357',
      idempotencyKey: randomUUID(),
    };
    if (deviceFingerprint) body.deviceFingerprint = deviceFingerprint;

    return request(app.getHttpServer())
      .post(`/chat/proposals/${proposalId}/execute`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);
  }

  // ── Tests: beneficiary endpoints ────────────────────────────────────────────

  it('beneficiary endpoints: add bank-account + crypto-address, list, reject invalid address', async () => {
    const { accessToken } = await setupVerifiedUser(
      `e2e_ss_ben_${Date.now()}@test.com`,
    );

    // Add bank account → 201, resolved name persisted (mock name-enquiry).
    const bankRes = await request(app.getHttpServer())
      .post('/beneficiaries/bank-account')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        accountNumber: '0123456789',
        bankCode: '058',
        label: 'My GTB',
        currency: 'NGN',
        pin: '1357',
      })
      .expect(201);
    const bank = bankRes.body as {
      id: string;
      type: string;
      accountHolderName: string;
      isDefault: boolean;
    };
    expect(bank.type).toBe('bank_account');
    expect(bank.accountHolderName).toBeTruthy();
    expect(bank.isDefault).toBe(true);

    // Add crypto address → 201.
    const cryptoRes = await request(app.getHttpServer())
      .post('/beneficiaries/crypto-address')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        address: VALID_TRON_ADDRESS,
        network: 'TRON',
        asset: 'USDT',
        label: 'Cold wallet',
        pin: '1357',
      })
      .expect(201);
    const crypto = cryptoRes.body as { type: string; cryptoAddress: string };
    expect(crypto.type).toBe('crypto_address');
    expect(crypto.cryptoAddress).toBe(VALID_TRON_ADDRESS);

    // List bank accounts → only the bank shows.
    const listBank = await request(app.getHttpServer())
      .get('/beneficiaries?type=bank_account')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const listBankBody = listBank.body as {
      beneficiaries: Array<{ id: string; type: string }>;
    };
    expect(listBankBody.beneficiaries).toHaveLength(1);
    expect(listBankBody.beneficiaries[0].type).toBe('bank_account');

    // Invalid crypto address → 422.
    await request(app.getHttpServer())
      .post('/beneficiaries/crypto-address')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        address: 'not-a-tron-address',
        network: 'TRON',
        asset: 'USDT',
        label: 'bad',
        pin: '1357',
      })
      .expect(422);

    // No Bearer → 401.
    await request(app.getHttpServer())
      .get('/beneficiaries?type=bank_account')
      .expect(401);
  }, 120_000);

  // ── Tests: sell ──────────────────────────────────────────────────────────────

  it('full sell: chat → proposal → authorize → execute → settling (payout)', async () => {
    const { accessToken, userId } = await setupVerifiedUser(
      `e2e_ss_sell_${Date.now()}@test.com`,
    );

    const benRes = await request(app.getHttpServer())
      .post('/beneficiaries/bank-account')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        accountNumber: '0123456789',
        bankCode: '058',
        label: 'My GTB',
        currency: 'NGN',
        pin: '1357',
      })
      .expect(201);
    const beneficiaryId = (benRes.body as { id: string }).id;

    await seedUsdtBalance(userId, 100);

    const chatRes = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'sell 10 usdt', beneficiaryId })
      .expect(200);
    const outcome = (
      chatRes.body as {
        outcome: { kind: string; txType?: string; proposalId: string };
      }
    ).outcome;
    expect(outcome.kind).toBe('proposal');
    expect(outcome.txType).toBe('sell');

    const execRes = await authorizeAndExecute(accessToken, outcome.proposalId);
    expect(execRes.status).toBe(201);
    const execBody = execRes.body as {
      transactionId: string;
      status: string;
      payout?: { providerRef: string };
    };
    expect(execBody.status).toBe('settling');
    expect(execBody.payout?.providerRef).toBe(FAKE_PAYOUT_REF);

    const statusRes = await request(app.getHttpServer())
      .get(`/transactions/${execBody.transactionId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect((statusRes.body as { type: string }).type).toBe('sell');
  }, 120_000);

  it('sell execute after balance spent (TOCTOU) → 422', async () => {
    const { accessToken, userId } = await setupVerifiedUser(
      `e2e_ss_sell422_${Date.now()}@test.com`,
    );

    const benRes = await request(app.getHttpServer())
      .post('/beneficiaries/bank-account')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        accountNumber: '0123456789',
        bankCode: '058',
        label: 'My GTB',
        currency: 'NGN',
        pin: '1357',
      })
      .expect(201);
    const beneficiaryId = (benRes.body as { id: string }).id;

    // Enough to create the proposal for "sell 8".
    const walletId = await seedUsdtBalance(userId, 10);

    const chatRes = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'sell 8 usdt', beneficiaryId })
      .expect(200);
    const { proposalId } = (chatRes.body as { outcome: { proposalId: string } })
      .outcome;

    // Simulate a concurrent spend dropping the balance below the sell amount.
    await debitUsdtBalanceTo(walletId, userId, 5);

    const res = await authorizeAndExecute(accessToken, proposalId);
    expect(res.status).toBe(422);
  }, 120_000);

  // ── Tests: send ──────────────────────────────────────────────────────────────

  it('full send: add crypto beneficiary → chat → proposal → authorize → execute → settling (onChain)', async () => {
    const fingerprint = `e2e-web-ss-fp-send_${Date.now()}`.slice(0, 40);
    const email = `e2e_ss_send_${Date.now()}@test.com`;
    // setupVerifiedUser logs in with a derived fingerprint; the execute body
    // re-sends a fingerprint to exercise device resolution (it falls back to
    // the pinned device when it does not match, which is the case here).
    const { accessToken, userId } = await setupVerifiedUser(email);

    const benRes = await request(app.getHttpServer())
      .post('/beneficiaries/crypto-address')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        address: VALID_TRON_ADDRESS,
        network: 'TRON',
        asset: 'USDT',
        label: 'My TRON wallet',
        pin: '1357',
      })
      .expect(201);
    const beneficiaryId = (benRes.body as { id: string }).id;

    // Clear first-use cooling-off so the send is immediately permitted.
    await prisma.beneficiary.update({
      where: { id: beneficiaryId },
      data: { firstUseLockedUntil: null },
    });

    await seedUsdtBalance(userId, 100);

    const chatRes = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'send 5 usdt', beneficiaryId })
      .expect(200);
    const outcome = (
      chatRes.body as {
        outcome: { kind: string; txType?: string; proposalId: string };
      }
    ).outcome;
    expect(outcome.kind).toBe('proposal');
    expect(outcome.txType).toBe('send');

    const execRes = await authorizeAndExecute(
      accessToken,
      outcome.proposalId,
      fingerprint,
    );
    expect(execRes.status).toBe(201);
    const execBody = execRes.body as {
      transactionId: string;
      status: string;
      onChain?: { providerRef: string };
    };
    expect(execBody.status).toBe('settling');
    expect(execBody.onChain?.providerRef).toBe(FAKE_WITHDRAW_REF);

    // Step-up was recorded against the user's bound device (§3.4).
    const session = await prisma.session.findFirst({
      where: { userId, stepUpCompletedAt: { not: null } },
    });
    expect(session).not.toBeNull();

    const statusRes = await request(app.getHttpServer())
      .get(`/transactions/${execBody.transactionId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect((statusRes.body as { type: string }).type).toBe('send');
  }, 120_000);
});
