/**
 * BalanceService — read-only portfolio snapshot for the agent surfaces.
 *
 * Invariants (CLAUDE.md §3):
 *   - §3.1 read-only: never provisions a wallet and never moves money — it only
 *     reads the ledger (authoritative balance) and the rate provider (valuation).
 *   - §3.2 no DB access here: wallet + ledger come through injected repository ports.
 *
 * The ledger is the single source of truth for balances (the WalletBalance snapshot
 * is provider-derived; the ledger derives from settled entries). Valuation uses the
 * realizable SELL rate (baseRate × (1 − sellSpreadBps/10000)) so the figure matches
 * the web wallet tab (D2 product decision). The FX spread is folded in and never
 * surfaced as a line item — the displayed value is what the user would receive if
 * they sold right now.
 */

import { Inject, Injectable } from '@nestjs/common';
import type {
  BalanceLine,
  BalanceSnapshot,
  FiatCurrency,
  SupportedAsset,
} from '@handshake-agent/contracts';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import {
  WALLET_REPOSITORY,
  type IWalletRepository,
} from '../../wallets/application/ports/wallet.repository.port';
import {
  LEDGER_REPOSITORY,
  type ILedgerRepository,
} from '../../transactions/application/ports/ledger.repository.port';
import {
  RATE_PROVIDER,
  type IRateProvider,
} from '../../quotes/application/ports/rate-provider.port';
import { valueAtSellRate } from '../../quotes/domain/quote-pricing';

/** Ledger account type for a user's custodial wallet (mirrors LedgerAccountType.user_wallet). */
const USER_WALLET_ACCOUNT = 'user_wallet';

@Injectable()
export class BalanceService {
  constructor(
    @Inject(WALLET_REPOSITORY)
    private readonly walletRepo: IWalletRepository,
    @Inject(LEDGER_REPOSITORY)
    private readonly ledgerRepo: ILedgerRepository,
    @Inject(RATE_PROVIDER)
    private readonly rateProvider: IRateProvider,
    private readonly assetRegistry: AssetRegistry,
  ) {}

  /**
   * Returns the user's balances. When `asset` is given the snapshot is scoped to
   * that asset (and echoes it); otherwise it enumerates every enabled crypto asset.
   * An unenabled / unknown asset yields an empty balances list (never throws).
   */
  async getBalances(userId: string, asset?: string): Promise<BalanceSnapshot> {
    const fiatCurrency = this.assetRegistry.defaultFiat();
    const fiatDecimals = this.assetRegistry.fiat(fiatCurrency).decimals;

    const enabled = this.assetRegistry.enabledCryptoAssets();
    const targets = asset ? enabled.filter((sym) => sym === asset) : enabled;

    let totalFiat = 0;
    let anyPriced = false;
    const balances: BalanceLine[] = [];

    for (const sym of targets) {
      const network = this.assetRegistry.defaultNetworkFor(sym);
      // Read-only: look up the existing wallet, never provision one. No wallet → '0'.
      const wallet = await this.walletRepo.findByUserNetwork(userId, network);
      const amount = wallet
        ? await this.ledgerRepo.getAccountBalance(
            USER_WALLET_ACCOUNT,
            wallet.id,
            sym,
          )
        : '0';

      const fiatValue = await this.valuate(sym, fiatCurrency, amount);
      if (fiatValue !== undefined) {
        anyPriced = true;
        totalFiat += parseFloat(fiatValue);
      }

      balances.push({
        asset: sym,
        network,
        amount,
        ...(fiatValue !== undefined ? { fiatValue } : {}),
      });
    }

    return {
      fiatCurrency,
      ...(asset !== undefined ? { asset } : {}),
      ...(anyPriced ? { totalFiatValue: totalFiat.toFixed(fiatDecimals) } : {}),
      balances,
    };
  }

  /**
   * Sell-rate fiat valuation of a crypto amount.
   *
   * Priority:
   *   1. getRate (fiat-tradeable assets, e.g. USDT): applies sell spread so the
   *      displayed value is the realizable sell amount.
   *   2. getValuationRate fallback (swap-only assets, e.g. TRX): getRate throws
   *      for fiatTradeable=false; getValuationRate bypasses that gate and returns
   *      a baseRate for mid-market display (spread=0).
   *   3. Both throw → returns undefined (truly unpriced asset, never sinks snapshot).
   *
   * Uses `valueAtSellRate` so the formula stays identical to the web wallet endpoint.
   * `valueAtSellRate` always floors to 2 d.p. (fiat minor units).
   */
  private async valuate(
    asset: string,
    fiatCurrency: string,
    amount: string,
  ): Promise<string | undefined> {
    try {
      const { baseRate, sellSpreadBps } = await this.rateProvider.getRate(
        asset as SupportedAsset,
        fiatCurrency as FiatCurrency,
      );
      if (!Number.isFinite(baseRate)) return undefined;
      return valueAtSellRate(amount, baseRate, sellSpreadBps);
    } catch {
      // getRate failed — try valuation rate (bypasses fiatTradeable gate for
      // swap-only assets like TRX that have a baseRate but no fiat trade).
      try {
        const vRate = await this.rateProvider.getValuationRate(
          asset as SupportedAsset,
          fiatCurrency as FiatCurrency,
        );
        if (!Number.isFinite(vRate.baseRate)) return undefined;
        return valueAtSellRate(amount, vRate.baseRate, 0);
      } catch {
        return undefined;
      }
    }
  }
}
