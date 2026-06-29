import { Inject, Injectable } from '@nestjs/common';
import type {
  FiatCurrency,
  SupportedAsset,
  WalletBalancesResponse,
  DepositAddressResponse,
} from '@handshake-agent/contracts';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import {
  RATE_PROVIDER,
  type IRateProvider,
} from '../../quotes/application/ports/rate-provider.port';
import { valueAtSellRate } from '../../quotes/domain/quote-pricing';
import { WalletService } from './wallet.service';

/**
 * Read-only valuation/summary service for the web wallet surfaces.
 * Never moves money (§3.1) — it reads custodial balances and values them at the
 * realizable sell rate. Reaches pricing only through the IRateProvider port.
 */
@Injectable()
export class WalletBalanceService {
  constructor(
    private readonly wallets: WalletService,
    private readonly registry: AssetRegistry,
    @Inject(RATE_PROVIDER) private readonly rates: IRateProvider,
  ) {}

  async getBalances(userId: string): Promise<WalletBalancesResponse> {
    const fiat = this.registry.defaultFiat();
    const symbols = this.registry.enabledCryptoAssets();

    const assets = await Promise.all(
      symbols.map(async (symbol) => {
        const meta = this.registry.asset(symbol);
        const network = this.registry.defaultNetworkFor(symbol);
        const wallet = await this.wallets.getOrProvisionNetworkWallet(
          userId,
          network,
        );
        const { amount } = await this.wallets.getBalance(wallet, symbol);
        const rate = await this.rates.getRate(
          symbol as SupportedAsset,
          fiat as FiatCurrency,
        );
        const fiatValue = valueAtSellRate(
          amount,
          rate.baseRate,
          rate.sellSpreadBps,
        );
        return {
          symbol: symbol as SupportedAsset,
          displayName: meta.displayName,
          network,
          amount,
          decimals: meta.decimals,
          fiatValue,
        };
      }),
    );

    // Sum in integer minor units (kobo) so the total is exact and never
    // overstates realizable value: each per-asset fiatValue is already
    // floored to 2dp by valueAtSellRate, so float accumulation + rounding
    // (.toFixed) could add a stray 0.01 once multiple assets are enabled.
    const totalMinor = assets.reduce(
      (sum, a) => sum + Math.round(Number(a.fiatValue) * 100),
      0,
    );
    const totalFiatValue = (totalMinor / 100).toFixed(2);

    return { fiatCurrency: fiat as FiatCurrency, totalFiatValue, assets };
  }

  async getDepositAddress(
    userId: string,
    network?: string,
  ): Promise<DepositAddressResponse> {
    const asset = this.registry.defaultCryptoAsset();
    const net = network ?? this.registry.defaultNetworkFor(asset);
    const netMeta = this.registry.network(net);
    const wallet = await this.wallets.getOrProvisionNetworkWallet(userId, net);
    return {
      asset: asset as SupportedAsset,
      network: net,
      networkLabel: netMeta.displayName,
      address: wallet.address,
    };
  }
}
