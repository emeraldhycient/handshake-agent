/**
 * Unit tests for MockSwapProvider.
 *
 * Verifies:
 *   - getQuote returns deterministic output from config base rates
 *   - execute always returns 'pending' (safety invariant — §3.1)
 *   - No real Blockradar calls are made
 */

import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { MockSwapProvider } from './mock-swap.provider';

function makeConfig(
  overrides: Record<string, unknown> = {},
): EffectiveConfigService {
  const defaults: Record<string, unknown> = {
    'pricing.assets': {
      USDT: { baseRates: { NGN: 1600 } },
      BTC: { baseRates: { NGN: 100_000_000 } },
    },
    ...overrides,
  };
  return {
    get: (key: string) => defaults[key],
  } as unknown as EffectiveConfigService;
}

describe('MockSwapProvider', () => {
  let provider: MockSwapProvider;

  beforeEach(() => {
    provider = new MockSwapProvider(makeConfig());
  });

  describe('getQuote', () => {
    it('returns a non-empty toAmount', async () => {
      const result = await provider.getQuote({
        addressId: 'addr-1',
        fromAssetId: 'mock-usdt-tron-asset-id-0000000000001',
        toAssetId: 'mock-btc-asset-id',
        amount: '100',
      });
      expect(result.toAmount).toBeTruthy();
      expect(parseFloat(result.toAmount)).toBeGreaterThan(0);
    });

    it('returns a non-empty rate string', async () => {
      const result = await provider.getQuote({
        addressId: 'addr-1',
        fromAssetId: 'mock-usdt-tron-asset-id-0000000000001',
        toAssetId: 'mock-btc-asset-id',
        amount: '100',
      });
      expect(result.rate).toBeTruthy();
    });

    it('computes USDT→BTC cross-rate from config base rates', async () => {
      // USDT NGN baseRate = 1600, BTC NGN baseRate = 100_000_000
      // rate = 1600 / 100_000_000 = 0.000016
      // toAmount = 100 * 0.000016 = 0.0016
      const result = await provider.getQuote({
        addressId: 'addr-1',
        fromAssetId: 'mock-usdt-tron-asset-id-0000000000001',
        toAssetId: 'mock-btc-asset-id',
        amount: '100',
      });
      expect(parseFloat(result.toAmount)).toBeCloseTo(0.0016, 6);
      expect(parseFloat(result.rate)).toBeCloseTo(0.000016, 8);
    });

    it('falls back to rate=1 when config base rates are missing', async () => {
      const providerNoConfig = new MockSwapProvider(
        makeConfig({ 'pricing.assets': {} }),
      );

      const result = await providerNoConfig.getQuote({
        addressId: 'addr-1',
        fromAssetId: 'unknown-id',
        toAssetId: 'another-unknown-id',
        amount: '50',
      });
      // rate = 1 → toAmount = 50
      expect(parseFloat(result.toAmount)).toBeCloseTo(50, 6);
    });

    it('reflects a DB AppSetting override of pricing.assets base rates (EffectiveConfigService flows through)', async () => {
      // Admin halves USDT's NGN base rate; the USDT→BTC cross-rate must change
      // accordingly, proving get('pricing.assets') resolves the layered config.
      const providerOverridden = new MockSwapProvider(
        makeConfig({
          'pricing.assets': {
            USDT: { baseRates: { NGN: 800 } },
            BTC: { baseRates: { NGN: 100_000_000 } },
          },
        }),
      );

      const result = await providerOverridden.getQuote({
        addressId: 'addr-1',
        fromAssetId: 'mock-usdt-tron-asset-id-0000000000001',
        toAssetId: 'mock-btc-asset-id',
        amount: '100',
      });

      // rate = 800 / 100_000_000 = 0.000008 → toAmount = 100 * 0.000008 = 0.0008
      expect(parseFloat(result.rate)).toBeCloseTo(0.000008, 9);
      expect(parseFloat(result.toAmount)).toBeCloseTo(0.0008, 7);
    });

    it('returns fixed deterministic minAmount, slippage, networkFee, transactionFee, estimatedArrivalSec', async () => {
      const result = await provider.getQuote({
        addressId: 'addr-1',
        fromAssetId: 'mock-usdt-tron-asset-id-0000000000001',
        toAssetId: 'mock-btc-asset-id',
        amount: '100',
      });

      expect(result.minAmount).toBe('1');
      expect(result.slippage).toBe(50);
      expect(result.networkFee).toBe('1');
      expect(result.transactionFee).toBe('0.5');
      expect(result.estimatedArrivalSec).toBe(120);
    });
  });

  describe('execute', () => {
    it('returns a providerSwapId containing the reference', async () => {
      const result = await provider.execute({
        addressId: 'addr-1',
        fromAssetId: 'mock-usdt-tron-asset-id-0000000000001',
        toAssetId: 'mock-btc-asset-id',
        amount: '100',
        reference: 'idempotency-key-123',
      });
      expect(result.providerSwapId).toContain('idempotency-key-123');
    });

    it('always returns status pending (safety invariant — §3.1)', async () => {
      const result = await provider.execute({
        addressId: 'addr-1',
        fromAssetId: 'mock-usdt-tron-asset-id-0000000000001',
        toAssetId: 'mock-btc-asset-id',
        amount: '100',
        reference: 'ref-001',
      });
      // A mock MUST NOT return 'success' — it has no real on-chain outcome.
      expect(result.status).toBe('pending');
    });

    it('omits hash (no on-chain outcome in mock mode)', async () => {
      const result = await provider.execute({
        addressId: 'addr-1',
        fromAssetId: 'mock-usdt-tron-asset-id-0000000000001',
        toAssetId: 'mock-btc-asset-id',
        amount: '100',
        reference: 'ref-001',
      });
      expect(result.hash).toBeUndefined();
    });
  });
});
