import { Injectable, Logger, Optional } from '@nestjs/common';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type {
  PricingConfig,
  PricingFeedConfig,
} from '../../../core/config/configuration';
import {
  liveStoreWhenEnabled,
  resolveEffectiveBaseRate,
} from '../../transactions/application/resolve-base-rate';
import { LiveRateStore } from '../../quotes/application/live-rate.store';
import type {
  ISwapProvider,
  GetSwapQuoteInput,
  GetSwapQuoteOutput,
  ExecuteSwapInput,
  ExecuteSwapOutput,
} from '../application/ports/swap-provider.port';

/** Fallback staleness window when `pricing.feed` is absent (thin test config). */
const DEFAULT_FEED_STALENESS_SEC = 900;

/**
 * Deterministic mock swap provider — the default adapter when `SWAP_MOCK_MODE=true`
 * (the env-schema default).
 *
 * Lets swap flows be exercised locally and in tests WITHOUT a live Blockradar
 * call or real credentials. Mirrors MockWalletProvider / MockPaymentProvider.
 *
 * Quote is computed from the two assets' configured base rates in NGN:
 *   rate = baseRate(fromAsset, NGN) / baseRate(toAsset, NGN)
 *   toAmount = amount * rate
 *
 * This gives a deterministic, config-driven cross-rate that updates when an
 * admin tunes the base rates — no hardcoded numbers.
 *
 * Safety (root CLAUDE.md §3.1): `execute` ALWAYS returns 'pending' so the
 * engine never finalises off a fabricated on-chain status.
 */
@Injectable()
export class MockSwapProvider implements ISwapProvider {
  private readonly logger = new Logger(MockSwapProvider.name);

  /** Fixed flat network fee (fromAsset units). Admin-tunable in future; deterministic for tests. */
  private static readonly MOCK_NETWORK_FEE = '1';
  /** Fixed flat transaction fee (fromAsset units). */
  private static readonly MOCK_TX_FEE = '0.5';
  /** Fixed estimated arrival time in seconds. */
  private static readonly MOCK_ARRIVAL_SEC = 120;
  /** Fixed slippage bps. */
  private static readonly MOCK_SLIPPAGE_BPS = 50;

  constructor(
    private readonly config: EffectiveConfigService,
    // @Optional so the existing unit suite (which news this up with config only)
    // resolves the config cross-rate; production injects the live store.
    @Optional() private readonly liveRateStore?: LiveRateStore,
  ) {}

  /**
   * Returns a deterministic quote derived from the catalog base rates (NGN).
   *
   * rate = fromBaseRateNGN / toBaseRateNGN
   *
   * Falls back to rate=1 if either asset is missing a NGN base rate so tests
   * do not throw on an unconfigured asset pair.
   */
  getQuote(input: GetSwapQuoteInput): Promise<GetSwapQuoteOutput> {
    this.logger.warn(
      `[mock-swap] getQuote fromAssetId=${input.fromAssetId} toAssetId=${input.toAssetId} amount=${input.amount} — NO real Blockradar call (SWAP_MOCK_MODE=true)`,
    );

    const rate = this.computeCrossRate(input.fromAssetId, input.toAssetId);
    const fromAmount = parseFloat(input.amount);
    const toAmount = (fromAmount * rate).toFixed(8).replace(/\.?0+$/, '');

    return Promise.resolve({
      toAmount,
      rate: rate.toFixed(8).replace(/\.?0+$/, ''),
      minAmount: '1',
      slippage: MockSwapProvider.MOCK_SLIPPAGE_BPS,
      networkFee: MockSwapProvider.MOCK_NETWORK_FEE,
      transactionFee: MockSwapProvider.MOCK_TX_FEE,
      estimatedArrivalSec: MockSwapProvider.MOCK_ARRIVAL_SEC,
    });
  }

  /**
   * Returns a mock execute result with status 'pending'.
   *
   * Safety: NEVER returns 'success' — a mock has no real on-chain outcome to
   * report. The engine must not finalise off a fabricated status.
   */
  execute(input: ExecuteSwapInput): Promise<ExecuteSwapOutput> {
    this.logger.warn(
      `[mock-swap] execute ref=${input.reference} from=${input.fromAssetId} to=${input.toAssetId} amount=${input.amount} — NO real Blockradar call (SWAP_MOCK_MODE=true)`,
    );

    return Promise.resolve({
      providerSwapId: `mock-swap-${input.reference}`,
      status: 'pending',
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Computes a cross-rate from config base rates (NGN).
   *
   * The pricing config keys are SYMBOL-based (e.g. 'USDT', 'TRX'). The mock
   * provider receives assetIds from the caller — those are provider UUIDs in
   * the real adapter. In mock mode the assetId IS the symbol (set by
   * MockWalletProvider.listWalletAssets as 'mock-usdt-tron-asset-id-…').
   *
   * To bridge this we ask the AssetRegistry to resolve the symbol from the id.
   * If resolution fails we fall back to rate=1 (safe for unit tests that do not
   * boot the full catalog).
   */
  private computeCrossRate(fromAssetId: string, toAssetId: string): number {
    try {
      // AssetRegistry.symbolForProviderId may not exist yet; fall back on naming.
      const fromSymbol = this.resolveSymbol(fromAssetId);
      const toSymbol = this.resolveSymbol(toAssetId);

      const pricingAssets =
        this.config.get<Record<string, { baseRates?: Record<string, number> }>>(
          'pricing.assets',
        ) ?? {};

      // Route each leg through the SHARED base-rate seam so a fresh live NGN rate
      // wins over config, while an empty store is byte-identical to the previous
      // config-only read. The seam throws on a missing/0 rate → treat as 0 so the
      // legacy rate=1 fallback (below) still holds for unconfigured pairs.
      const fromRate = this.effectiveNgnRate(pricingAssets, fromSymbol);
      const toRate = this.effectiveNgnRate(pricingAssets, toSymbol);

      if (fromRate > 0 && toRate > 0) {
        return fromRate / toRate;
      }
    } catch {
      // Fall through to default
    }

    // Default: 1:1 cross-rate (safe, deterministic for tests without pricing config).
    return 1;
  }

  /**
   * Effective NGN base rate for a symbol via the shared seam (live-then-config),
   * or 0 when neither exists (missing/0/negative) — 0 drives the rate=1 fallback.
   */
  private effectiveNgnRate(
    pricingAssets: Record<string, { baseRates?: Record<string, number> }>,
    symbol: string,
  ): number {
    try {
      return resolveEffectiveBaseRate(
        { assets: pricingAssets } as unknown as PricingConfig,
        this.effectiveLiveStore(),
        symbol,
        'NGN',
        new Date(),
        this.feedStalenessSec(),
      );
    } catch {
      // BaseRateMisconfiguredError (no live + no config rate) → 0 → rate=1 fallback.
      return 0;
    }
  }

  /** Staleness window (seconds) from config, defaulting when `pricing.feed` is absent. */
  private feedStalenessSec(): number {
    const feed = this.config.get<PricingFeedConfig | undefined>('pricing.feed');
    return typeof feed?.stalenessSec === 'number'
      ? feed.stalenessSec
      : DEFAULT_FEED_STALENESS_SEC;
  }

  /** The live store honouring the admin kill-switch (null the moment enabled=false). */
  private effectiveLiveStore(): LiveRateStore | null {
    const feed = this.config.get<PricingFeedConfig | undefined>('pricing.feed');
    return liveStoreWhenEnabled(this.liveRateStore, feed);
  }

  /**
   * Resolves a symbol from an assetId.
   *
   * In mock mode the "assetId" values come from MockWalletProvider.listWalletAssets,
   * which sets them to strings like 'mock-usdt-tron-asset-id-0000000000001'.
   * We uppercase the string and check for known symbol substrings.
   *
   * In real mode, the engine passes discovered assetIds (UUIDs) from AssetRegistry.
   * MockSwapProvider is never active in real mode (SWAP_MOCK_MODE=false selects
   * BlockradarSwapProvider), so this path is test/dev only.
   */
  private resolveSymbol(assetId: string): string {
    // Fast path: treat the id as a symbol if it's already a known ticker.
    const upper = assetId.toUpperCase();
    const knownSymbols = ['USDT', 'BTC', 'TRX', 'ETH'];
    const found = knownSymbols.find((sym) => upper.includes(sym));
    return found ?? assetId;
  }
}
