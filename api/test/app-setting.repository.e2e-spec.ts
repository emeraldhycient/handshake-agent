import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { AppSettingPrismaRepository } from '../src/core/config/infrastructure/app-setting.prisma.repository';
import type { UpsertAppSettingInput } from '../src/core/config/application/ports/app-setting.repository.port';

import { startTestPostgres } from './helpers/pg-testcontainer';

let prisma: PrismaClient;
let stop: () => Promise<void>;
let repo: AppSettingPrismaRepository;

const adminId = randomUUID();

function input(
  over: Partial<UpsertAppSettingInput> = {},
): UpsertAppSettingInput {
  return {
    key: 'pricing.processingFeeBps',
    value: 100,
    scope: 'global',
    scopeValue: null,
    isSecret: false,
    isEditable: true,
    updatedByAdminId: adminId,
    ...over,
  };
}

beforeAll(async () => {
  const t = await startTestPostgres();
  prisma = t.prisma;
  stop = t.stop;
  repo = new AppSettingPrismaRepository(prisma as unknown as PrismaService);
}, 180_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  await prisma.appSetting.deleteMany();
});

describe('AppSettingPrismaRepository (integration)', () => {
  it('upsert is idempotent by (key, scope, scopeValue) — second upsert updates, not duplicates', async () => {
    await repo.upsert(input({ value: 100 }));
    const second = await repo.upsert(input({ value: 250 }));

    expect(second.value).toBe(250);
    const all = await prisma.appSetting.findMany({
      where: { key: 'pricing.processingFeeBps' },
    });
    expect(all).toHaveLength(1);
    expect(all[0]?.value).toBe(250);
  });

  it('the same key under a different scopeValue is a distinct row', async () => {
    await repo.upsert(
      input({
        key: 'limits.perTxFiatMax',
        scope: 'tier',
        scopeValue: 'tier_1',
      }),
    );
    await repo.upsert(
      input({
        key: 'limits.perTxFiatMax',
        scope: 'tier',
        scopeValue: 'tier_2',
      }),
    );
    const rows = await prisma.appSetting.findMany({
      where: { key: 'limits.perTxFiatMax' },
    });
    expect(rows).toHaveLength(2);
  });

  it('findAllEditable excludes an isEditable:false row', async () => {
    await repo.upsert(input({ key: 'editable.one', isEditable: true }));
    await repo.upsert(input({ key: 'locked.two', isEditable: false }));

    const editable = await repo.findAllEditable();
    const keys = editable.map((r) => r.key);
    expect(keys).toContain('editable.one');
    expect(keys).not.toContain('locked.two');

    const all = await repo.findAll();
    expect(all.map((r) => r.key)).toEqual(
      expect.arrayContaining(['editable.one', 'locked.two']),
    );
  });

  it('round-trips JSON values of every shape (number, boolean, string[], object)', async () => {
    await repo.upsert(input({ key: 'v.number', value: 1600 }));
    await repo.upsert(input({ key: 'v.boolean', value: true }));
    await repo.upsert(
      input({ key: 'v.array', value: ['audio/webm', 'audio/mp4'] }),
    );
    await repo.upsert(input({ key: 'v.object', value: { NGN: 1_000_000 } }));

    expect((await repo.findByKey('v.number', 'global', null))?.value).toBe(
      1600,
    );
    expect((await repo.findByKey('v.boolean', 'global', null))?.value).toBe(
      true,
    );
    expect((await repo.findByKey('v.array', 'global', null))?.value).toEqual([
      'audio/webm',
      'audio/mp4',
    ]);
    expect((await repo.findByKey('v.object', 'global', null))?.value).toEqual({
      NGN: 1_000_000,
    });
  });

  it('findByKey resolves a row whose scopeValue is null', async () => {
    await repo.upsert(input({ key: 'global.only', scopeValue: null }));
    const row = await repo.findByKey('global.only', 'global', null);
    expect(row).not.toBeNull();
    expect(row?.scopeValue).toBeNull();
    expect(row?.scope).toBe('global');
  });

  it('findByKey returns null for a missing key', async () => {
    expect(await repo.findByKey('does.not.exist', 'global', null)).toBeNull();
  });

  it('maps every row field onto AppSettingRow', async () => {
    await repo.upsert(input({ key: 'mapped.row', value: 42 }));
    const row = await repo.findByKey('mapped.row', 'global', null);
    expect(row).toEqual({
      key: 'mapped.row',
      value: 42,
      scope: 'global',
      scopeValue: null,
      isSecret: false,
      isEditable: true,
    });
  });
});
