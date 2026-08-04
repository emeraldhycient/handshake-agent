/**
 * Admin Agent console + Tickets oversight — end-to-end acceptance test
 * (Phase 4 wave 2).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives the
 * read-only controllers added in this task with NO mocking of the admin/db path:
 *
 *   1. bootstrap → accept → login as super_admin (holds every grant)
 *   2. GET /admin/agent/config           → modelId + enabled + systemPromptPreview,
 *                                           and the response carries NO api key.
 *   3. seed a Contact + Conversation + message + intent + reply via testcontainer prisma
 *   4. GET /admin/agent/conversations      → the seeded conversation appears
 *   5. GET /admin/agent/conversations/:id  → messages + intents + replies returned
 *   6. seed a User + TicketOrder
 *   7. GET /admin/tickets/orders           → the seeded order appears
 *
 * Bootstrap mirrors admin-end-users.e2e-spec.ts: Testcontainers Postgres +
 * prisma migrate deploy, all env (incl. ADMIN_*) set BEFORE importing AppModule,
 * and the four external-edge fakes overridden via .overrideProvider().
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
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-admin-agent-tickets';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-admin-agent-tickets-fake';
const WA_APP_SECRET = 'e2e-admin-agent-tickets-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-admin-agent-tickets';

const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token-agent-tickets';
const ROOT_EMAIL = 'root-agent-tickets@e2e.test';
const ROOT_PASSWORD = 'rootPassword123!';

interface BootstrapBody {
  invitationId: string;
  invitationToken: string;
  expiresAt: string;
}
interface LoginBody {
  accessToken: string;
  expiresAt: string;
  admin: {
    id: string;
    role: { id: string; name: string };
    permissions: string[];
  };
}
interface AgentConfigBody {
  modelId: string;
  enabled: boolean;
  systemPromptPreview: string;
}
interface ConversationListBody {
  items: {
    id: string;
    userId: string | null;
    contactId: string | null;
    language: string;
    status: string;
    lastMessageAt: string | null;
    createdAt: string;
  }[];
  nextCursor: string | null;
}
interface ConversationDetailBody {
  id: string;
  messages: {
    id: string;
    text: string;
    processingStatus: string;
    receivedAt: string;
    intent: { action: string; confidence: number | null } | null;
  }[];
  replies: {
    id: string;
    text: string;
    status: string;
    sentAt: string | null;
  }[];
}
interface TicketListBody {
  items: {
    id: string;
    userId: string;
    vendorKey: string;
    ticketType: string;
    quantity: number;
    totalAmount: string;
    currency: string;
  }[];
  nextCursor: string | null;
}

describe('Admin Agent console + Tickets oversight — e2e (AppModule, Testcontainers Postgres)', () => {
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
      DIRECTIVE_SIGNING_KEY: 'e2e-agent-tickets-directive-key-32by',
      RECEIPT_SIGNING_KEY: 'e2e-agent-tickets-receipt-signing-32',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-agent-tickets',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-agent-tickets',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-agent-tickets',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-agent-tickets',
      JWT_SECRET: 'e2e-agent-tickets-jwt-secret-at-least-32-bytes!!',
      ADMIN_JWT_SECRET: 'e2e-agent-tickets-admin-jwt-secret-32bytes!!',
      ADMIN_MFA_ENC_KEY: 'b'.repeat(64),
      ADMIN_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN,
      // Pin the agent model so the config endpoint returns a deterministic value.
      AGENT_MODEL: 'claude-opus-4-8',
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
        address: 'TAgentTicketsFakeWalletAddr12345',
        providerReference: 'fake_blockradar_ref_agent_tickets_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-agent-tickets-stub',
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
        bankName: 'Agent Tickets Test MFB',
        providerRef: 'flw_fake_ref_agent_tickets_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_agent_tickets_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      findPayoutByReference: jest.fn().mockResolvedValue(null),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };
    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.at.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.at.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.at.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.at.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.at.e2e' }),
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

  /** Seed a Contact + Conversation + message (with intent) + reply. Returns ids. */
  async function seedConversation(): Promise<{
    conversationId: string;
    contactId: string;
  }> {
    const contact = await prisma.contact.create({
      data: { primaryChannel: 'whatsapp', primaryAddress: '+2348012345678' },
    });
    const conversation = await prisma.conversation.create({
      data: {
        contactId: contact.id,
        language: 'en',
        lastMessageAt: new Date(),
      },
    });
    const message = await prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        externalMessageId: 'wamid.in.agent-tickets.e2e.1',
        channel: 'whatsapp',
        senderAddress: '+2348012345678',
        text: 'buy 5000 naira of usdt',
        rawUserText: 'buy 5000 naira of usdt',
        processingStatus: 'processed',
        correlationId: 'corr-agent-tickets-e2e-1',
        intent: {
          create: {
            conversationId: conversation.id,
            action: 'buy_crypto',
            payload: {
              action: 'buy_crypto',
              asset: 'USDT',
              fiatAmount: '5000',
              fiatCurrency: 'NGN',
            },
            extractionConfidence: 0.91,
          },
        },
      },
    });
    await prisma.conversationReply.create({
      data: {
        conversationId: conversation.id,
        messageId: message.id,
        text: 'Here is your quote for 5000 NGN of USDT.',
        directives: [],
        status: 'sent',
        sentAt: new Date(),
        correlationId: 'corr-agent-tickets-e2e-1',
      },
    });
    return { conversationId: conversation.id, contactId: contact.id };
  }

  /**
   * Seed a User + a TicketOrder in a NON-default currency (USD) — proves the
   * admin feed threads the order's own `currency` column through rather than
   * assuming the catalog's historical NGN default. Returns the order id.
   */
  async function seedTicketOrder(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: 'ticket-buyer@e2e.test', status: 'active' },
    });
    const order = await prisma.ticketOrder.create({
      data: {
        userId: user.id,
        eventId: 'evt-agent-tickets-e2e',
        vendorKey: 'zentry',
        ticketType: 'VIP',
        quantity: 2,
        unitPrice: '5000.00',
        platformFee: '0.00',
        totalAmount: '10000.00',
        currency: 'USD',
        idempotencyKey: '99999999-9999-9999-9999-999999999999',
      },
    });
    return order.id;
  }

  /** Bootstrap + accept the first super_admin, then log in. Run once. */
  async function bootstrapRoot(): Promise<string> {
    const bootstrap = await request(app.getHttpServer())
      .post('/admin/bootstrap')
      .send({ token: BOOTSTRAP_TOKEN, email: ROOT_EMAIL })
      .expect(201);
    const rootInviteToken = (bootstrap.body as BootstrapBody).invitationToken;

    await request(app.getHttpServer())
      .post('/admin/invitations/accept')
      .send({ token: rootInviteToken, password: ROOT_PASSWORD })
      .expect(200);

    return loginRoot();
  }

  /** Log in as the already-bootstrapped super_admin. */
  async function loginRoot(): Promise<string> {
    const rootLogin = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: ROOT_EMAIL, password: ROOT_PASSWORD })
      .expect(200);
    return (rootLogin.body as LoginBody).accessToken;
  }

  // ===========================================================================

  it('super_admin reads agent config (no api key), lists conversations + detail, and lists ticket orders', async () => {
    const rootToken = await bootstrapRoot();

    // 2. GET /admin/agent/config — model id + enablement + read-only prompt preview.
    const configRes = await request(app.getHttpServer())
      .get('/admin/agent/config')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const config = configRes.body as AgentConfigBody;
    expect(config.modelId).toBe('claude-opus-4-8');
    expect(typeof config.enabled).toBe('boolean');
    expect(config.systemPromptPreview.length).toBeGreaterThan(0);
    // The ANTHROPIC_API_KEY must NEVER cross this boundary (§3.1/§6).
    const configSerialized = JSON.stringify(config).toLowerCase();
    expect(configSerialized).not.toContain('anthropic_api_key');
    expect(configSerialized).not.toContain('api_key');
    expect(configSerialized).not.toContain('sk-ant');

    // 3. Seed a conversation thread (contact + message + intent + reply).
    const { conversationId, contactId } = await seedConversation();

    // 4. GET /admin/agent/conversations — the seeded conversation is listed.
    const listRes = await request(app.getHttpServer())
      .get('/admin/agent/conversations')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const list = listRes.body as ConversationListBody;
    const listed = list.items.find((c) => c.id === conversationId);
    expect(listed).toBeDefined();
    expect(listed!.contactId).toBe(contactId);
    expect(listed!.userId).toBeNull();
    expect(listed!.language).toBe('en');

    // 5. GET /admin/agent/conversations/:id — messages + intents + replies.
    const detailRes = await request(app.getHttpServer())
      .get(`/admin/agent/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const detail = detailRes.body as ConversationDetailBody;
    expect(detail.id).toBe(conversationId);
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0].text).toBe('buy 5000 naira of usdt');
    expect(detail.messages[0].intent).toEqual({
      action: 'buy_crypto',
      confidence: 0.91,
    });
    expect(detail.replies).toHaveLength(1);
    expect(detail.replies[0].status).toBe('sent');
    expect(detail.replies[0].sentAt).not.toBeNull();

    // Unknown conversation id → 404 (AdminNotFoundError).
    await request(app.getHttpServer())
      .get('/admin/agent/conversations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(404);

    // 6 + 7. Seed a ticket order, then GET /admin/tickets/orders — it appears.
    const orderId = await seedTicketOrder();
    const ticketRes = await request(app.getHttpServer())
      .get('/admin/tickets/orders')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const tickets = ticketRes.body as TicketListBody;
    const order = tickets.items.find((o) => o.id === orderId);
    expect(order).toBeDefined();
    expect(order!.vendorKey).toBe('zentry');
    expect(order!.ticketType).toBe('VIP');
    expect(order!.quantity).toBe(2);
    // totalAmount is a canonical decimal STRING (Prisma Decimal.toString() drops
    // padding zeros: "10000.00" → "10000"); assert by numeric value, not padding.
    expect(typeof order!.totalAmount).toBe('string');
    expect(Number(order!.totalAmount)).toBe(10000);
    // The seeded order is USD, not the catalog default (NGN) — proves the feed
    // threads the order's own currency column, never a hardcoded literal.
    expect(order!.currency).toBe('USD');
  }, 90_000);

  it('returns a well-formed ticket-orders list shape ({ items, nextCursor })', async () => {
    const rootToken = await loginRoot();
    const res = await request(app.getHttpServer())
      .get('/admin/tickets/orders')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const body = res.body as TicketListBody;
    expect(Array.isArray(body.items)).toBe(true);
    expect(body).toHaveProperty('nextCursor');
  }, 60_000);
});
