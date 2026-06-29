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
 * mid-market base rate so the figure is honest and the FX spread is never surfaced.
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

      const fiatValue = await this.valuate(
        sym,
        fiatCurrency,
        amount,
        fiatDecimals,
      );
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
   * Mid-market fiat valuation of a crypto amount. Returns `undefined` (rather than
   * throwing) when the asset cannot be priced so one unpriced asset never sinks the
   * whole snapshot. Number math is fine here — this is a display estimate, not a
   * settlement figure (the engine never reads this).
   */
  private async valuate(
    asset: string,
    fiatCurrency: string,
    amount: string,
    decimals: number,
  ): Promise<string | undefined> {
    try {
      const { baseRate } = await this.rateProvider.getRate(
        asset as SupportedAsset,
        fiatCurrency as FiatCurrency,
      );
      if (!Number.isFinite(baseRate)) return undefined;
      return (parseFloat(amount) * baseRate).toFixed(decimals);
    } catch {
      return undefined;
    }
  }
}
