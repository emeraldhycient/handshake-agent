import { Inject, Injectable } from '@nestjs/common';
import type {
  QuoteBuyInput,
  QuoteBuyOutput,
  QuoteSellInput,
  QuoteSellOutput,
  QuoteSendInput,
  QuoteSendOutput,
} from '@handshake-agent/contracts';

import { CLOCK, type Clock } from '../../../core/common/clock';
import { computeBuyQuote, computeSellQuote } from '../domain/quote-pricing';
import { RATE_PROVIDER, type IRateProvider } from './ports/rate-provider.port';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { addDecimalStrings } from '../domain/decimal-math';

/**
 * Buy-quote use-case. Pure orchestration: pull a rate through the port, run the
 * pricing domain, stamp the time, and assemble the contract DTO. No DB, no
 * framework leakage, no side effects — quoting never moves money.
 */
@Injectable()
export class QuotesService {
  constructor(
    @Inject(RATE_PROVIDER) private readonly rateProvider: IRateProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    // AssetRegistry is optional here so the DI module can provide it without
    // changing the existing injection tokens for the buy/sell flows.
    // The send-quote path requires it; other methods do not touch the registry.
    private readonly assetRegistry?: AssetRegistry,
  ) {}

  async quoteBuy(input: QuoteBuyInput): Promise<QuoteBuyOutput> {
    const fiatCurrency = this.resolveFiatCurrency(input.fiatCurrency);
    const rate = await this.rateProvider.getRate(input.asset, fiatCurrency);

    const breakdown = computeBuyQuote({
      // Single explicit coercion at the boundary; the value is already
      // validated by the contract schema before it reaches the service.
      fiatAmount: Number(input.fiatAmount),
      baseRate: rate.baseRate,
      buySpreadBps: rate.buySpreadBps,
      processingFeeBps: rate.processingFeeBps,
      cryptoDecimals: rate.cryptoDecimals,
    });

    return {
      asset: input.asset,
      fiatAmount: input.fiatAmount,
      fiatCurrency,
      cryptoAmount: breakdown.cryptoAmount,
      // Raw pre-spread market rate — stored in the Quote row for treasury/audit.
      baseRate: String(rate.baseRate),
      // Effective (spread-inclusive) rate — used for conversion and shown to user.
      fxRate: String(breakdown.effectiveRate),
      // Reports the APPLIED (direction-specific) spread — the buy spread for buy quotes.
      spreadBps: rate.buySpreadBps,
      processingFeeBps: rate.processingFeeBps,
      quotedAt: this.clock.now().toISOString(),
      expiresInSec: rate.expiresInSec,
    };
  }

  /**
   * Send-quote use-case. Given a crypto amount the user wants to send on-chain,
   * compute the network fee and total wallet debit. No rate conversion — the
   * fee is a flat amount denominated in the same asset (e.g. 1 USDT for TRC-20).
   *
   * Validation:
   *   - The network must be enabled in the catalog.
   *   - The asset must support the given network.
   *
   * The arithmetic uses BigInt via `addDecimalStrings` to avoid float drift.
   * The fee is config-driven (catalog.networks.<id>.networkFeeCrypto.<asset>)
   * and admin-tunable without a deploy (CLAUDE.md §7).
   *
   * @throws {UnsupportedAssetError}   when the asset is disabled or unknown.
   * @throws {UnsupportedNetworkError} when the network is disabled or unknown.
   * @throws Error                     when the asset does not support the network,
   *                                   or no networkFeeCrypto entry is configured.
   */
  quoteSend(input: QuoteSendInput): QuoteSendOutput {
    if (!this.assetRegistry) {
      throw new Error(
        'QuotesService: AssetRegistry is required for quoteSend but was not injected.',
      );
    }

    const { asset, cryptoAmount, network } = input;

    // Validate network (throws UnsupportedNetworkError if disabled/unknown).
    const networkMeta = this.assetRegistry.network(network);

    // Validate asset is enabled and supports the given network.
    const assetMeta = this.assetRegistry.asset(asset);
    if (!assetMeta.networks.includes(network)) {
      throw new Error(
        `Asset ${asset} does not support network ${network}. ` +
          `Supported networks: ${assetMeta.networks.join(', ')}.`,
      );
    }

    // Resolve the flat network fee. Config-driven; the absence of a fee
    // entry is a configuration error — fail loudly so it's caught in staging.
    const networkFeeCrypto = networkMeta.networkFeeCrypto?.[asset];
    if (networkFeeCrypto === undefined) {
      throw new Error(
        `No networkFeeCrypto configured for asset ${asset} on network ${network}. ` +
          `Add catalog.networks.${network}.networkFeeCrypto.${asset} to the config.`,
      );
    }

    // Decimal-safe addition: BigInt arithmetic prevents float drift on amounts
    // like 0.000001 + 1 = 1.000001 which floats handle incorrectly at edge cases.
    const totalDebit = addDecimalStrings(cryptoAmount, networkFeeCrypto);

    // sendQuoteExpiresInSec lives in the catalog config section alongside other
    // admin-tunable send parameters (CLAUDE.md §7).
    const catalog = this.assetRegistry['catalog'];
    const expiresInSec: number =
      (catalog as { sendQuoteExpiresInSec?: number }).sendQuoteExpiresInSec ??
      30;

    return {
      asset,
      cryptoAmount,
      network,
      networkFeeCrypto,
      totalDebit,
      quotedAt: this.clock.now().toISOString(),
      expiresInSec,
    };
  }

  /**
   * Sell-quote use-case. Given a crypto amount the user wants to sell, compute
   * the NGN they receive after spread + processing fee. Spread works AGAINST the
   * user in a sell direction (reduces the effective rate). No side effects — quoting
   * never moves money.
   */
  async quoteSell(input: QuoteSellInput): Promise<QuoteSellOutput> {
    const fiatCurrency = this.resolveFiatCurrency(input.fiatCurrency);
    const rate = await this.rateProvider.getRate(input.asset, fiatCurrency);

    const breakdown = computeSellQuote({
      // Single explicit coercion at the boundary; the value is already
      // validated by the contract schema before it reaches the service.
      cryptoAmount: Number(input.cryptoAmount),
      baseRate: rate.baseRate,
      sellSpreadBps: rate.sellSpreadBps,
      processingFeeBps: rate.processingFeeBps,
    });

    return {
      asset: input.asset,
      cryptoAmount: input.cryptoAmount,
      fiatCurrency,
      netFiatAmount: String(breakdown.netFiat),
      // Raw pre-spread market rate — stored for treasury/audit.
      baseRate: String(rate.baseRate),
      // Effective (spread-reduced) rate — what the user receives per crypto unit.
      fxRate: String(breakdown.effectiveRate),
      // Reports the APPLIED (direction-specific) spread — the sell spread for sell quotes.
      spreadBps: rate.sellSpreadBps,
      processingFeeBps: rate.processingFeeBps,
      processingFeeAmount: String(breakdown.processingFeeAmount),
      quotedAt: this.clock.now().toISOString(),
      expiresInSec: rate.expiresInSec,
    };
  }

  /**
   * Single resolution point for `fiatCurrency` on the quoting vertical
   * (multi-currency ergonomics): `quote_buy`/`quote_sell` no longer force a
   * fiat choice on every caller (HTTP controller, MCP tools, the proposal
   * engine). When the caller omits it, default to the catalog base fiat —
   * never a hardcoded currency (CLAUDE.md §7) — mirroring the get_rate path.
   * AssetRegistry is only optional on this class for legacy test
   * construction; every real (DI-wired) instance has it, so an undefined
   * registry combined with an omitted fiatCurrency is a configuration bug,
   * not a case to paper over with a hardcoded fallback.
   */
  private resolveFiatCurrency(fiatCurrency: string | undefined): string {
    const resolved = fiatCurrency ?? this.assetRegistry?.defaultFiat();
    if (resolved === undefined) {
      throw new Error(
        'QuotesService: fiatCurrency was omitted and no AssetRegistry is available to resolve the catalog default.',
      );
    }
    return resolved;
  }
}
