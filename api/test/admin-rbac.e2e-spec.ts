/**
 * Admin RBAC console — end-to-end acceptance test.
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives
 * the complete admin lifecycle with NO mocking of the admin/db path:
 *
 *   1.  POST /admin/bootstrap            → { invitationToken } (first super_admin)
 *   2.  POST /admin/invitations/accept   → { adminId }
 *   3.  POST /admin/auth/login           → { accessToken, admin }
 *   4.  GET  /admin/me                   → super_admin + holds POST /admin/roles:write
 *   5.  GET  /admin/roles                → find the built-in 'ops' role id
 *   6.  POST /admin/invitations          → invite an 'ops' admin
 *   7.  accept + login as ops            → opsAccessToken
 *   8.  GET  /admin/audit (ops)          → 200 (ops has Audit:read)
 *   9.  POST /admin/roles (ops)          → 403 (ops lacks Access:write, default-deny)
 *   10. GET  /admin/audit (no Bearer)    → 401
 *   11. POST /admin/audit/verify (super) → { ok: true }
 *   12. DB asserts: auditLog rows incl. a session_create action
 *   +   re-bootstrap → 403 (admins now exist)
 *
 * Bootstrap mirrors onboarding-vertical.e2e-spec.ts:
 *   - Testcontainers Postgres + prisma migrate deploy
 *   - env vars (incl. ADMIN_*) set BEFORE the AppModule dynamic import
 *   - the four external-edge fakes overridden via .overrideProvider()
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
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-admin-rbac';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-admin-rbac-fake';
const WA_APP_SECRET = 'e2e-admin-rbac-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-admin-rbac';

const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token';
const ROOT_EMAIL = 'root@e2e.test';
const ROOT_PASSWORD = 'rootPassword123!';
const OPS_EMAIL = 'ops@e2e.test';
const OPS_PASSWORD = 'opsPassword123!';

interface BootstrapBody {
  invitationId: string;
  invitationToken: string;
  expiresAt: string;
}
interface AcceptBody {
  adminId: string;
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
interface RolesBody {
  roles: { id: string; name: string }[];
}
interface InviteBody {
  invitationToken: string;
}

describe('Admin RBAC — e2e (AppModule, Testcontainers Postgres)', () => {
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

    // Set ALL required env vars BEFORE importing AppModule (ConfigModule.forRoot
    // runs validateEnv() synchronously at module decoration time).
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl,
      WHATSAPP_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: WA_ACCESS_TOKEN,
      WHATSAPP_APP_SECRET: WA_APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: WA_VERIFY_TOKEN,
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-rbac-directive-key-32bytes!!xx',
      RECEIPT_SIGNING_KEY: 'e2e-rbac-receipt-signing-key-32b!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-admin-rbac',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-rbac',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-admin-rbac',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-admin-rbac',
      JWT_SECRET: 'e2e-admin-rbac-jwt-secret-at-least-32-bytes!!',
      // Admin platform secrets — drive the REAL admin auth path.
      ADMIN_JWT_SECRET: 'e2e-admin-rbac-admin-jwt-secret-32bytes!!',
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
        address: 'TAdminRbacFakeWalletAddr123456789',
        providerReference: 'fake_blockradar_ref_admin_rbac_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-admin-rbac-stub',
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
        bankName: 'Admin RBAC Test MFB',
        providerRef: 'flw_fake_ref_admin_rbac_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_admin_rbac_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };
    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.rbac.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.rbac.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.rbac.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.rbac.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.rbac.e2e' }),
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
  // MAIN TEST — full RBAC lifecycle
  // ===========================================================================

  it('bootstrap → accept → login → RBAC-gated routes (super allows, ops denied)', async () => {
    // 1. Bootstrap the first super_admin invitation.
    const bootstrap = await request(app.getHttpServer())
      .post('/admin/bootstrap')
      .send({ token: BOOTSTRAP_TOKEN, email: ROOT_EMAIL })
      .expect(201);
    const rootInviteToken = (bootstrap.body as BootstrapBody).invitationToken;
    expect(rootInviteToken).toBeDefined();

    // 2 + 3. Accept the invitation (sets the password) and log in.
    const accept = await request(app.getHttpServer())
      .post('/admin/invitations/accept')
      .send({ token: rootInviteToken, password: ROOT_PASSWORD })
      .expect(200);
    expect((accept.body as AcceptBody).adminId).toBeDefined();

    const rootLogin = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: ROOT_EMAIL, password: ROOT_PASSWORD })
      .expect(200);
    const rootToken = (rootLogin.body as LoginBody).accessToken;
    expect(rootToken).toBeDefined();

    // 4. GET /admin/me — super_admin holds the Access:write grant.
    const me = await request(app.getHttpServer())
      .get('/admin/me')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const meBody = me.body as LoginBody['admin'];
    expect(meBody.role.name).toBe('super_admin');
    expect(meBody.permissions).toContain('api_route:POST /admin/roles:write');

    // 5. GET /admin/roles — find the built-in 'ops' role.
    const rolesRes = await request(app.getHttpServer())
      .get('/admin/roles')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    const opsRole = (rolesRes.body as RolesBody).roles.find(
      (r) => r.name === 'ops',
    );
    expect(opsRole).toBeDefined();

    // 6 + 7. Invite an 'ops' admin, accept, and log in.
    const opsInvite = await request(app.getHttpServer())
      .post('/admin/invitations')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ email: OPS_EMAIL, roleId: opsRole!.id })
      .expect(201);
    const opsToken = await acceptAndLogin(
      (opsInvite.body as InviteBody).invitationToken,
      OPS_PASSWORD,
      OPS_EMAIL,
    );

    // 8. ops CAN read the audit log (Audit:read).
    await request(app.getHttpServer())
      .get('/admin/audit')
      .set('Authorization', `Bearer ${opsToken}`)
      .expect(200);

    // 9. ops CANNOT create a role (lacks Access:write) — default-deny → 403.
    await request(app.getHttpServer())
      .post('/admin/roles')
      .set('Authorization', `Bearer ${opsToken}`)
      .send({ name: 'x', description: 'y', permissionIds: [] })
      .expect(403);

    // 10. No Bearer → 401.
    await request(app.getHttpServer()).get('/admin/audit').expect(401);

    // 11. super verifies the audit chain.
    const verify = await request(app.getHttpServer())
      .post('/admin/audit/verify')
      .set('Authorization', `Bearer ${rootToken}`)
      .expect(200);
    expect((verify.body as { ok: boolean }).ok).toBe(true);

    // 12. DB assertions — the hash-chained audit log captured the lifecycle.
    const auditCount = await prisma.auditLog.count();
    expect(auditCount).toBeGreaterThan(0);
    const sessionCreate = await prisma.auditLog.findFirst({
      where: { action: 'session_create' },
    });
    expect(sessionCreate).not.toBeNull();

    // Re-bootstrap is now forbidden (admins exist).
    await request(app.getHttpServer())
      .post('/admin/bootstrap')
      .send({ token: BOOTSTRAP_TOKEN, email: 'second@e2e.test' })
      .expect(403);
  }, 90_000);
});
