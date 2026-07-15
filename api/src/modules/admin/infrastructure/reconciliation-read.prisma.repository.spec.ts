/**
 * Unit tests for ReconciliationReadPrismaRepository's `missing_settlement`
 * currency projection — a stuck SettlementOutbox row degrades through the
 * joined transaction's OWN metadata fields (crypto asset, then fiat currency)
 * before falling back to the catalog's configured default. It must never
 * hardcode a currency literal (§7 / CLAUDE.md multi-currency hardening).
 */
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { PrismaService } from '../../../core/prisma/prisma.service';
import { ReconciliationReadPrismaRepository } from './reconciliation-read.prisma.repository';

const OUTBOX_ROW_ID = 'outbox-row-1';
const TXN_ID = 'txn-1';

function makePrisma(metadata: Record<string, unknown> | null) {
  return {
    compensationRecord: { findMany: jest.fn().mockResolvedValue([]) },
    settlementOutbox: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: OUTBOX_ROW_ID,
          transactionId: TXN_ID,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          transaction: { metadata },
        },
      ]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaService;
}

function makeAssetRegistry(
  defaultFiatCode: string,
): jest.Mocked<Pick<AssetRegistry, 'defaultFiat'>> {
  return { defaultFiat: jest.fn().mockReturnValue(defaultFiatCode) };
}

describe('ReconciliationReadPrismaRepository — missing_settlement currency projection', () => {
  it('prefers the metadata crypto asset when present', async () => {
    const prisma = makePrisma({ asset: 'USDT', fiatCurrency: 'USD' });
    const assetRegistry = makeAssetRegistry('USD');
    const repo = new ReconciliationReadPrismaRepository(
      prisma,
      assetRegistry as unknown as AssetRegistry,
    );

    const [brk] = await repo.listBreaks(60);

    expect(brk.asset).toBe('USDT');
    expect(assetRegistry.defaultFiat).not.toHaveBeenCalled();
  });

  it('falls back to the metadata fiatCurrency when asset is absent', async () => {
    const prisma = makePrisma({ fiatCurrency: 'USD' });
    const assetRegistry = makeAssetRegistry('NGN');
    const repo = new ReconciliationReadPrismaRepository(
      prisma,
      assetRegistry as unknown as AssetRegistry,
    );

    const [brk] = await repo.listBreaks(60);

    expect(brk.asset).toBe('USD');
    expect(assetRegistry.defaultFiat).not.toHaveBeenCalled();
  });

  it('falls back to the CONFIG default fiat (not a hardcoded NGN) when metadata has neither field', async () => {
    const prisma = makePrisma({});
    const assetRegistry = makeAssetRegistry('USD');
    const repo = new ReconciliationReadPrismaRepository(
      prisma,
      assetRegistry as unknown as AssetRegistry,
    );

    const [brk] = await repo.listBreaks(60);

    expect(brk.asset).toBe('USD');
    expect(assetRegistry.defaultFiat).toHaveBeenCalled();
  });

  it('falls back to the CONFIG default fiat when the transaction metadata is null', async () => {
    const prisma = makePrisma(null);
    const assetRegistry = makeAssetRegistry('EUR');
    const repo = new ReconciliationReadPrismaRepository(
      prisma,
      assetRegistry as unknown as AssetRegistry,
    );

    const [brk] = await repo.listBreaks(60);

    expect(brk.asset).toBe('EUR');
  });
});
