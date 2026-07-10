/**
 * Unit tests for TreasuryReadPrismaRepository display-fallback derivations (A9).
 *
 * PrismaService is mocked (only the settlementOutbox read is exercised) and the
 * AssetRegistry is stubbed — no DB, no catalog boot. These tests pin the payout-
 * queue projection so a NON-NGN payout is never mislabeled with a hardcoded
 * 'NGN'/'USDT' fallback: the fiat fallback comes from the registry default, the
 * crypto/label fallbacks are neutral.
 *
 * TDD: written before the implementation change (red → green → refactor).
 */

import { SettlementType } from '../../../../generated/prisma/client';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { PrismaService } from '../../../core/prisma/prisma.service';
import { TreasuryReadPrismaRepository } from './treasury-read.prisma.repository';

interface PayoutRow {
  id: string;
  transactionId: string;
  settlementType: SettlementType;
  processorRef: string | null;
  createdAt: Date;
  transaction: { metadata: unknown } | null;
}

function payoutRow(overrides: Partial<PayoutRow> = {}): PayoutRow {
  return {
    id: 'ob_1',
    transactionId: 'tx_12345678abcdef',
    settlementType: SettlementType.processor_payout,
    processorRef: null,
    createdAt: new Date('2026-07-09T00:00:00.000Z'),
    transaction: { metadata: {} },
    ...overrides,
  };
}

describe('TreasuryReadPrismaRepository — payout-queue display fallbacks (A9)', () => {
  let findMany: jest.Mock;
  let findFirst: jest.Mock;
  let defaultFiat: jest.Mock;
  let repo: TreasuryReadPrismaRepository;

  beforeEach(() => {
    findMany = jest.fn();
    findFirst = jest.fn();
    defaultFiat = jest.fn(() => 'GHS');
    const prisma = {
      settlementOutbox: { findMany, findFirst },
    } as unknown as PrismaService;
    const registry = { defaultFiat } as unknown as AssetRegistry;
    repo = new TreasuryReadPrismaRepository(prisma, registry);
  });

  it('a processor_payout with no fiatCurrency/asset in metadata uses the REGISTRY default fiat, not a hardcoded NGN', async () => {
    findMany.mockResolvedValue([payoutRow({ transaction: { metadata: {} } })]);

    const [rec] = await repo.listPayoutQueue();

    expect(rec.asset).toBe('GHS');
    expect(rec.method).toBe('GHS payout · Flutterwave');
    expect(rec.beneficiaryLabel).toBe('Bank payout');
    expect(defaultFiat).toHaveBeenCalled();
  });

  it('a processor_payout reads the ACTUAL fiatCurrency from metadata for the method label', async () => {
    findMany.mockResolvedValue([
      payoutRow({
        transaction: {
          metadata: { fiatCurrency: 'KES', beneficiaryName: 'Wanjiru' },
        },
      }),
    ]);

    const [rec] = await repo.listPayoutQueue();

    expect(rec.method).toBe('KES payout · Flutterwave');
    expect(rec.beneficiaryLabel).toBe('Wanjiru');
  });

  it('respects an explicit asset in metadata (no fallback applied)', async () => {
    findMany.mockResolvedValue([
      payoutRow({
        transaction: { metadata: { asset: 'USDT', beneficiaryName: 'X' } },
      }),
    ]);

    const [rec] = await repo.listPayoutQueue();

    expect(rec.asset).toBe('USDT');
  });

  it('an onchain_send with no asset in metadata uses a NEUTRAL label — never a hardcoded USDT/NGN', async () => {
    findMany.mockResolvedValue([
      payoutRow({
        settlementType: SettlementType.onchain_send,
        transaction: { metadata: {} },
      }),
    ]);

    const [rec] = await repo.listPayoutQueue();

    expect(rec.asset).toBe('unknown');
    expect(rec.method).toBe('unknown · Blockradar');
    expect(rec.beneficiaryLabel).toBe('Crypto withdrawal');
  });

  it('does not crash the read path when no fiat is enabled — falls back to a neutral label', async () => {
    defaultFiat.mockImplementation(() => {
      throw new Error('no enabled fiat registered');
    });
    findMany.mockResolvedValue([payoutRow({ transaction: { metadata: {} } })]);

    const [rec] = await repo.listPayoutQueue();

    expect(rec.asset).toBe('unknown');
    expect(rec.method).toBe('unknown payout · Flutterwave');
  });

  it('findPayoutQueueItem applies the SAME registry-default fallback as listPayoutQueue', async () => {
    findFirst.mockResolvedValue(payoutRow({ transaction: { metadata: {} } }));

    const rec = await repo.findPayoutQueueItem('ob_1');

    expect(rec?.asset).toBe('GHS');
    expect(rec?.method).toBe('GHS payout · Flutterwave');
  });
});
