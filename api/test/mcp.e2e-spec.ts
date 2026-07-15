/**
 * MCP surface — end-to-end acceptance test (Wave C, PAT/MCP).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) and drives the stateless
 * Streamable-HTTP `POST /mcp` endpoint the way an external AI client would:
 *
 *   1. mint a tier_1 session user (+ PIN)
 *   2. POST /profile/tokens (Bearer JWT, PIN-gated) → raw `hsk_pat_…` token
 *   3. POST /mcp (Bearer PAT) initialize / tools/list / tools/call
 *
 * The invariants under test mirror root CLAUDE.md §3.1 / §3.5 / §6:
 *   - PAT-only auth: a session JWT is rejected on /mcp (401) BEFORE any handling.
 *   - tools/list exposes READ tools + the single `send_chat_message` propose
 *     tool, and NOTHING that executes/authorizes/enters a PIN — a leaked PAT can
 *     never move money.
 *   - scope gates invocation: a `read`-only PAT cannot call the propose tool.
 *   - the propose tool runs the same WebChatService turn as the web surface
 *     (regression guard: a rate turn must persist + reply, not 500).
 *
 * Bootstrap mirrors web-chat.e2e-spec.ts (Testcontainers + external-edge fakes +
 * env-before-AppModule-import). The LLM fake keeps the agent deterministic.
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

import { WalletService } from '../src/modules/wallets/application/wallet.service';
import { AssetRegistry } from '../src/core/catalog/asset-registry';
import { seedRegistryAssets } from './helpers/seed-registry-assets';
import { mintTier1User } from './helpers/mint-verified-user';

jest.setTimeout(180_000);

const API_ROOT = join(__dirname, '..');
const MCP_ACCEPT = 'application/json, text/event-stream';

/** A JSON-RPC 2.0 result envelope as the stateless transport returns it. */
interface JsonRpcResult<T> {
  jsonrpc: '2.0';
  id: number;
  result: T;
  error?: { code: number; message: string };
}

describe('MCP surface — e2e (AppModule, Testcontainers Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stopContainer: () => Promise<void>;
  let fakeLlmProvider: jest.Mocked<LlmProvider>;
  let fakeWalletProvider: jest.Mocked<IWalletProvider>;
  let fakePaymentProvider: jest.Mocked<IPaymentProvider>;
  let fakeSender: jest.Mocked<IWhatsAppSender>;

  // Minted once in beforeAll (after app.init), reused across tests.
  let sessionJwt: string;
  let fullPat: string; // scopes: read + chat:propose
  let readOnlyPat: string; // scopes: read

  /** POST one JSON-RPC message to /mcp as the given PAT. */
  function callMcp(pat: string, body: unknown) {
    return request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', `Bearer ${pat}`)
      .set('Accept', MCP_ACCEPT)
      .send(body as object);
  }

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
      WHATSAPP_PHONE_NUMBER_ID: 'test-pnid-e2e-mcp',
      WHATSAPP_ACCESS_TOKEN: 'e2e-wa-access-token-mcp-fake',
      WHATSAPP_APP_SECRET: 'e2e-mcp-app-secret-123',
      WHATSAPP_VERIFY_TOKEN: 'e2e-verify-token-mcp',
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-mcp-directive-key-32bytes!!xxxx',
      RECEIPT_SIGNING_KEY: 'e2e-mcp-receipt-signing-key-32b!!!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-mcp',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-mcp',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-mcp',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-mcp',
      JWT_SECRET: 'e2e-mcp-jwt-secret-at-least-32-bytes-long!!',
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    delete process.env.ANTHROPIC_API_KEY;

    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    fakeLlmProvider = {
      // Default intent is inert; rate/other tests override per-call.
      extractIntent: jest.fn().mockResolvedValue({ action: 'none' }),
    };

    let addrSeq = 0;
    fakeWalletProvider = {
      provisionAddress: jest.fn().mockImplementation(() => {
        addrSeq += 1;
        return Promise.resolve({
          address: `TMcpFakeAddr${addrSeq.toString().padStart(10, '0')}`,
          providerReference: `fake-ref-mcp-${addrSeq}`,
        });
      }),
      getBalance: jest.fn().mockResolvedValue({ balances: [] }),
      withdraw: jest
        .fn()
        .mockResolvedValue({ txHash: 'fake-hash', reference: 'ref' }),
      getWithdrawalStatus: jest
        .fn()
        .mockResolvedValue({ status: 'confirmed', txHash: 'fake-hash' }),
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
        accountNumber: '0091234568',
        bankName: 'MCP Test MFB',
        providerRef: 'flw_fake_ref_mcp_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_mcp_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    fakeSender = {
      sendText: jest.fn().mockResolvedValue({ externalMessageId: 'wamid.mcp' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.mcp.t' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.mcp.c' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.mcp.f' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.mcp.b' }),
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

    // Mint the session user + two PATs (full and read-only) through the real
    // PIN-gated mint endpoint.
    const minted = await mintTier1User(app, {
      email: `mcp_e2e_${Date.now()}@test.com`,
      pin: '2468',
    });
    sessionJwt = minted.accessToken;

    const fullRes = await request(app.getHttpServer())
      .post('/profile/tokens')
      .set('Authorization', `Bearer ${sessionJwt}`)
      .send({
        label: 'mcp-e2e-full',
        pin: '2468',
        scopes: ['read', 'chat:propose'],
      })
      .expect(201);
    fullPat = (fullRes.body as { token: string }).token;

    const readRes = await request(app.getHttpServer())
      .post('/profile/tokens')
      .set('Authorization', `Bearer ${sessionJwt}`)
      .send({ label: 'mcp-e2e-read', pin: '2468', scopes: ['read'] })
      .expect(201);
    readOnlyPat = (readRes.body as { token: string }).token;

    expect(fullPat).toMatch(/^hsk_pat_/);
    expect(readOnlyPat).toMatch(/^hsk_pat_/);
  }, 180_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await stopContainer?.();
  });

  const listBody = { jsonrpc: '2.0', id: 2, method: 'tools/list' };

  // ── Auth boundary (§3.5) ───────────────────────────────────────────────────

  it('rejects a session JWT on /mcp (PAT-only surface)', async () => {
    await callMcp(sessionJwt, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    }).expect(401);
  });

  it('rejects an anonymous /mcp call', async () => {
    await request(app.getHttpServer())
      .post('/mcp')
      .set('Accept', MCP_ACCEPT)
      .send(listBody)
      .expect(401);
  });

  // ── tools/list: read + propose only, never execute (§3.1/§6) ────────────────

  it('lists read tools + the single propose tool, and NOTHING that moves money', async () => {
    const res = await callMcp(fullPat, listBody).expect(200);
    const body = res.body as JsonRpcResult<{ tools: Array<{ name: string }> }>;
    const names = body.result.tools.map((t) => t.name);

    // Read tools + the one propose tool are present.
    expect(names).toEqual(
      expect.arrayContaining(['get_balances', 'list_rates']),
    );
    expect(names).toContain('send_chat_message');

    // The §3.1 invariant: no execute/authorize/PIN surface exists over MCP.
    for (const name of names) {
      expect(name).not.toMatch(/execut|authoriz|confirm|\bpin\b|settle/i);
    }
  });

  // ── tools/call: a read tool returns real data ───────────────────────────────

  it('tools/call list_rates → returns the priced pairs (read-only, no proposal)', async () => {
    const res = await callMcp(fullPat, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_rates', arguments: {} },
    }).expect(200);

    const body = res.body as JsonRpcResult<{
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }>;
    expect(body.error).toBeUndefined();
    expect(body.result.isError).toBeFalsy();
    // The launch catalog prices USDT — it must appear in the folded rate list.
    expect(body.result.content[0].text).toMatch(/USDT/);
  });

  // ── tools/call: the propose tool runs a real WebChatService turn ────────────

  it('tools/call send_chat_message → runs a propose turn (rate intent persists, no 500)', async () => {
    // Same path as the web surface: a resolved list_rates intent must persist to
    // the intent_action enum and reply — never throw an opaque error.
    fakeLlmProvider.extractIntent.mockResolvedValueOnce({
      action: 'list_rates',
    });

    const res = await callMcp(fullPat, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'send_chat_message',
        arguments: { text: 'what are the rates?' },
      },
    }).expect(200);

    const body = res.body as JsonRpcResult<{
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }>;
    expect(body.error).toBeUndefined();
    expect(body.result.isError).toBeFalsy();
    expect(body.result.content[0].text).toMatch(/rate/i);
  });

  // ── scope gate: read-only PAT cannot invoke the propose tool (§6) ───────────

  it('a read-only PAT cannot call send_chat_message (scope-gated)', async () => {
    const res = await callMcp(readOnlyPat, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'send_chat_message',
        arguments: { text: 'buy 5 USDT' },
      },
    }).expect(200);

    // The dispatch surfaces a scope denial as a tool error, not a silent run.
    const body = res.body as JsonRpcResult<{
      content?: Array<{ type: string; text: string }>;
      isError?: boolean;
    }>;
    // Out-of-scope and unknown-tool are the same client answer (no scope
    // probing) — an isError result, never a silent run of the propose turn.
    const errored =
      body.result?.isError === true ||
      body.error != null ||
      /unknown tool|scope|not permitted|unauthor/i.test(
        body.result?.content?.[0]?.text ?? '',
      );
    expect(errored).toBe(true);
  });

  it('a read-only PAT can still call a read tool (get_capabilities)', async () => {
    const res = await callMcp(readOnlyPat, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'get_capabilities', arguments: {} },
    }).expect(200);
    const body = res.body as JsonRpcResult<{ isError?: boolean }>;
    expect(body.error).toBeUndefined();
    expect(body.result.isError).toBeFalsy();
  });

  // ── internal transfer over MCP: propose-only + read own PayID (§3.1 / §6) ────
  // An MCP client naming a peer's `@payId` yields an internal_transfer PROPOSAL
  // (the handle is resolved SERVER-SIDE, never model free-text) — and NOTHING
  // executes over MCP. get_profile round-trips the caller's own PayID.

  /** Parses the single text content block of a tool result as JSON. */
  function toolJson<T>(
    body: JsonRpcResult<{
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }>,
  ): T {
    expect(body.error).toBeUndefined();
    expect(body.result.isError).toBeFalsy();
    return JSON.parse(body.result.content[0].text) as T;
  }

  let transferSeq = 0;

  /**
   * Mints a tier_1 user (email-OTP + PIN), bumps to tier_2 (the crypto.transfer
   * capability floor, §3.3), and reads the PayID minted at signup (Task 3).
   */
  async function mintTier2WithPayId(
    role: string,
  ): Promise<{ accessToken: string; userId: string; payId: string }> {
    transferSeq += 1;
    const email =
      `mcp_it_${role}_${transferSeq}_${Date.now()}@test.com`.toLowerCase();
    const { accessToken, userId } = await mintTier1User(app, {
      email,
      pin: '2468',
    });
    await prisma.user.update({
      where: { id: userId },
      data: { kycTier: 'tier_2' },
    });
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { payId: true },
    });
    if (!row?.payId) throw new Error(`user '${role}' has no minted payId`);
    return { accessToken, userId, payId: row.payId };
  }

  /** PIN-gated PAT mint (POST /profile/tokens). */
  async function mintPat(
    accessToken: string,
    scopes: string[],
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/profile/tokens')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ label: `mcp-it-${scopes.join('-')}`, pin: '2468', scopes })
      .expect(201);
    return (res.body as { token: string }).token;
  }

  /** Seeds a settled USDT credit on the user's TRON wallet ledger. */
  async function seedUsdtBalance(
    userId: string,
    amount: number,
  ): Promise<void> {
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
        description: 'seed credit for mcp internal-transfer e2e',
        balanceAfter: (before + amount).toFixed(6),
        sequence: seq,
        postedAt: new Date(),
      },
    });
  }

  it('send_chat_message "send 3 USDT to @<B.payId>" → internal_transfer PROPOSAL (destinationKind internal_user), and get_profile round-trips the caller PayID', async () => {
    // No CatalogSync ran here — seed the AssetRegistry provider-id overlay so any
    // asset lookup on the transfer path resolves (mirrors internal-transfer.e2e).
    seedRegistryAssets(app.get(AssetRegistry, { strict: false }));

    const a = await mintTier2WithPayId('a');
    const b = await mintTier2WithPayId('b');
    await seedUsdtBalance(a.userId, 100);
    const pat = await mintPat(a.accessToken, ['read', 'chat:propose']);

    // The @handle is resolved SERVER-SIDE (§3.1) — the model only names it.
    fakeLlmProvider.extractIntent.mockResolvedValueOnce({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '3',
      network: 'TRON',
      recipientNickname: `@${b.payId}`,
    });

    const proposeRes = await callMcp(pat, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'send_chat_message',
        arguments: { text: `send 3 USDT to @${b.payId}` },
      },
    }).expect(200);

    const proposePayload = toolJson<{
      outcome: { kind: string; proposalId?: string };
    }>(
      proposeRes.body as JsonRpcResult<{
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      }>,
    );
    expect(proposePayload.outcome.kind).toBe('proposal');
    const proposalId = proposePayload.outcome.proposalId;
    expect(proposalId).toBeTruthy();

    // The PERSISTED proposal is a genuine internal_transfer resolved to B's
    // userId — NO on-chain address; destinationKind internal_user.
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId! },
    });
    expect(proposal?.type).toBe('internal_transfer');
    const params = proposal?.parameters as Record<string, unknown>;
    expect(params.destinationKind).toBe('internal_user');
    expect(params.recipientUserId).toBe(b.userId);
    expect(params.toAddress).toBeUndefined();

    // get_profile round-trips the caller's OWN PayID (format-valid).
    const profileRes = await callMcp(pat, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'get_profile', arguments: {} },
    }).expect(200);
    const profile = toolJson<{ payId?: string }>(
      profileRes.body as JsonRpcResult<{
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      }>,
    );
    expect(profile.payId).toBe(a.payId);
    expect(profile.payId).toMatch(/^[a-z0-9_]{3,30}$/);
  }, 120_000);
});
