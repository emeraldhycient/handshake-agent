import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

import { PrismaClient } from '../generated/prisma/client';

/**
 * FND-02 / AUD-01 integration test — proves the full multi-file schema migrates
 * onto a REAL Postgres (via Testcontainers) and that the safety-critical,
 * DB-enforced invariants actually hold:
 *   • the migration applies cleanly (all tables + native enums materialize)
 *   • ids are client-generated, time-sortable uuid v7 (@default(uuid(7)))
 *   • the AuditLog hash chain links row→row (prevHash == previous currentHash)
 *   • a Conversation must key on exactly ONE identity — Contact XOR User (CHECK)
 *   • active-row uniqueness on channel identities is a PARTIAL unique
 *     (a soft-deleted duplicate is allowed; an active duplicate is not)
 *   • idempotency keys are unique (at-most-once execution, NFR-7)
 *
 * Requires Docker (Testcontainers). Runs in the `test:e2e` lane, NOT the default
 * unit `test` gate, so a Docker-less machine does not fail `pnpm test`.
 */
const API_ROOT = join(__dirname, '..');
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

jest.setTimeout(180_000);

describe('Prisma schema (integration, Testcontainers Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const url = container.getConnectionUri();

    // Apply the committed migration to the fresh container. dotenv (in
    // prisma.config.ts) does not override an already-set env var, so the
    // container URL wins over the .env placeholder.
    execSync('node_modules/.bin/prisma migrate deploy', {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    });

    // Prisma 7's `prisma-client` generator connects via a driver adapter, not a
    // baked-in engine — the same pattern FND-02's PrismaService will use.
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
    });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('materializes every model and native enum', async () => {
    const [{ tables }] = await prisma.$queryRawUnsafe<{ tables: bigint }[]>(
      `SELECT count(*)::bigint AS tables FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    // Every domain table + Prisma's _prisma_migrations bookkeeping table. Post-sync
    // = the union of the platform-hardening migrations and main's webhook_events
    // (Track A durable-webhook queue). The fiat_currency enum-widen (go-readiness #8)
    // adds VALUES, not a table, so it does not affect this count. +2 for recon_runs
    // + recon_breaks (go-readiness #3 durable recon log). +1 for
    // personal_access_tokens (go-live Wave C — PAT/MCP surface).
    expect(Number(tables)).toBe(63);

    const [{ enums }] = await prisma.$queryRawUnsafe<{ enums: bigint }[]>(
      `SELECT count(DISTINCT t.typname)::bigint AS enums
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid`,
    );
    // Every native enum TYPE the schema declares. supported_asset was dropped when
    // asset columns moved to TEXT (migration 20260629200000). +2 for webhook_provider
    // + webhook_event_status (Track A). The fiat_currency widen adds VALUES to an
    // existing TYPE, so this DISTINCT-type count is unaffected. +4 for
    // recon_run_type/recon_run_status/recon_break_type/recon_break_status
    // (go-readiness #3 durable recon log). personal_access_tokens (Wave C)
    // stores scopes as TEXT[] — no new enum TYPE.
    expect(Number(enums)).toBe(82);
  });

  it('generates time-sortable uuid v7 ids on the client (the only sanctioned DB door)', async () => {
    const setting = await prisma.appSetting.create({
      data: {
        key: 'crypto.buy.spread_bps',
        value: 150,
        description: 'launch spread',
      },
    });
    expect(setting.id).toMatch(UUID_V7);
  });

  it('links the AuditLog hash chain row to row', async () => {
    const genesis = await prisma.auditLog.create({
      data: {
        correlationId: 'corr-chain-1',
        actor: 'system',
        subject: 'AppSetting:crypto.buy.spread_bps',
        action: 'config_change',
        details: {},
        prevHash: '0'.repeat(64),
        currentHash: 'a'.repeat(64),
      },
    });
    const next = await prisma.auditLog.create({
      data: {
        correlationId: 'corr-chain-1',
        actor: 'system',
        subject: 'AppSetting:crypto.buy.spread_bps',
        action: 'config_change',
        details: {},
        prevHash: genesis.currentHash,
        currentHash: 'b'.repeat(64),
      },
    });
    expect(next.prevHash).toBe(genesis.currentHash);
  });

  it('rejects a Conversation that sets BOTH contact and user (Contact XOR User)', async () => {
    const user = await prisma.user.create({ data: {} });
    const contact = await prisma.contact.create({
      data: { primaryChannel: 'whatsapp', primaryAddress: '+2348000000010' },
    });

    // Exactly one identity → allowed.
    await expect(
      prisma.conversation.create({
        data: { user: { connect: { id: user.id } } },
      }),
    ).resolves.toBeDefined();

    // Both identities → violates the XOR CHECK constraint.
    await expect(
      prisma.conversation.create({
        data: {
          user: { connect: { id: user.id } },
          contact: { connect: { id: contact.id } },
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces active-row partial uniqueness on channel identities', async () => {
    const addr = '+2348000000020';
    await prisma.channelIdentity.create({
      data: { channel: 'whatsapp', channelAddress: addr },
    });

    // A second ACTIVE row with the same (channel, address) is rejected.
    await expect(
      prisma.channelIdentity.create({
        data: { channel: 'whatsapp', channelAddress: addr },
      }),
    ).rejects.toThrow();

    // A soft-deleted duplicate is allowed (partial unique WHERE deletedAt IS NULL).
    await expect(
      prisma.channelIdentity.create({
        data: {
          channel: 'whatsapp',
          channelAddress: addr,
          deletedAt: new Date(),
        },
      }),
    ).resolves.toBeDefined();
  });

  it('enforces idempotency-key uniqueness on transactions (NFR-7, at-most-once)', async () => {
    const user = await prisma.user.create({ data: {} });
    const idempotencyKey = randomUUID();
    const base = {
      userId: user.id,
      type: 'buy' as const,
      idempotencyKey,
      requestChecksum: 'x'.repeat(64),
      metadata: {},
    };

    await prisma.transaction.create({ data: base });
    await expect(prisma.transaction.create({ data: base })).rejects.toThrow();
  });
});
