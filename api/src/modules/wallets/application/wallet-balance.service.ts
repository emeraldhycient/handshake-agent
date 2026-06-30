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
import {
  WALLET_REPOSITORY,
  type IWalletRepository,
} from './ports/wallet.repository.port';
import {
  LEDGER_REPOSITORY,
  type ILedgerRepository,
} from '../../transactions/application/ports/ledger.repository.port';

/** Ledger account type for a user's custodial wallet (mirrors LedgerAccountType.user_wallet). */
const USER_WALLET_ACCOUNT = 'user_wallet';

/**
 * Read-only valuation/summary service for the web wallet surfaces.
 * Never moves money (§3.1) — it reads the LEDGER (authoritative custodial balance)
 * and values assets at the realizable sell rate.
 *
 * Amount source: ILedgerRepository.getAccountBalance — the custodial ledger is
 * the single source of truth for balances. On-chain provider.getBalance
 * (Blockradar) is intentionally NOT used here: credited deposits appear in the
 * ledger before an on-chain sync, so using the ledger ensures the wallet page
 * reflects the deposited amount immediately.
 *
 * Cycle-free dependency: ILedgerRepository and IWalletRepository are injected
 * as port tokens bound locally in WalletsModule (same self-binding pattern
 * BalancesModule uses). No TransactionsModule import is needed — PrismaService
 * is global and LedgerPrismaRepository is registered as a local provider.
 */
@Injectable()
export class WalletBalanceService {
  constructor(
    private readonly wallets: WalletService,
    private readonly registry: AssetRegistry,
    @Inject(RATE_PROVIDER) private readonly rates: IRateProvider,
    @Inject(WALLET_REPOSITORY)
    private readonly walletRepo: IWalletRepository,
    @Inject(LEDGER_REPOSITORY)
    private readonly ledgerRepo: ILedgerRepository,
  ) {}

  async getBalances(userId: string): Promise<WalletBalancesResponse> {
    const fiat = this.registry.defaultFiat();
    const fiatSymbol = this.registry.fiat(fiat).symbol;
    const symbols = this.registry.enabledCryptoAssets();

    const assets = await Promise.all(
      symbols.map(async (symbol) => {
        const meta = this.registry.asset(symbol);
        const network = this.registry.defaultNetworkFor(symbol);

        // LEDGER read: find the existing wallet (read-only — never provision here)
        // then query the ledger for the authoritative balance. No wallet → '0'.
        const wallet = await this.walletRepo.findByUserNetwork(userId, network);
        const amount = wallet
          ? await this.ledgerRepo.getAccountBalance(
              USER_WALLET_ACCOUNT,
              wallet.id,
              symbol,
            )
          : '0';

        // Valuation is best-effort. Priority:
        //   1. Try getRate (fiat-tradeable assets, e.g. USDT): applies sell spread
        //      so the displayed value is the realizable sell amount.
        //   2. Fall back to getValuationRate (swap-only, e.g. TRX): fiatTradeable=false
        //      makes getRate throw, but getValuationRate bypasses that gate and
        //      returns a baseRate for display at mid-market (no spread).
        //   3. Both throw → fiatValue: undefined (truly unpriced asset), never 500s.
        let fiatValue: string | undefined;
        try {
          const rate = await this.rates.getRate(
            symbol as SupportedAsset,
            fiat as FiatCurrency,
          );
          fiatValue = valueAtSellRate(
            amount,
            rate.baseRate,
            rate.sellSpreadBps,
          );
        } catch {
          // getRate failed — either no config or not fiat-tradeable. Try valuation rate.
          try {
            const vRate = await this.rates.getValuationRate(
              symbol as SupportedAsset,
              fiat as FiatCurrency,
            );
            // Mid-market display (spread=0) for non-tradeable assets.
            fiatValue = valueAtSellRate(amount, vRate.baseRate, 0);
          } catch {
            fiatValue = undefined;
          }
        }
        return {
          symbol: symbol as SupportedAsset,
          displayName: meta.displayName,
          network,
          amount,
          decimals: meta.decimals,
          ...(fiatValue !== undefined ? { fiatValue } : {}),
        };
      }),
    );

    // Sum in integer minor units (kobo) so the total is exact and never
    // overstates realizable value: each per-asset fiatValue is already
    // floored to 2dp by valueAtSellRate, so float accumulation + rounding
    // (.toFixed) could add a stray 0.01 once multiple assets are enabled.
    const totalMinor = assets.reduce(
      (sum, a) =>
        sum + (a.fiatValue ? Math.round(Number(a.fiatValue) * 100) : 0),
      0,
    );
    const totalFiatValue = (totalMinor / 100).toFixed(2);

    return {
      fiatCurrency: fiat as FiatCurrency,
      fiatSymbol,
      totalFiatValue,
      assets,
    };
  }

  async getDepositAddress(
    userId: string,
    network?: string,
    asset?: string,
  ): Promise<DepositAddressResponse> {
    // Use the caller-supplied asset when present; fall back to the registry
    // default. On TRON, USDT and TRX share the same address — the distinction
    // is purely in the label, not the wallet provisioning step.
    const resolvedAsset = asset ?? this.registry.defaultCryptoAsset();
    const net = network ?? this.registry.defaultNetworkFor(resolvedAsset);
    const netMeta = this.registry.network(net);
    const wallet = await this.wallets.getOrProvisionNetworkWallet(userId, net);
    return {
      asset: resolvedAsset as SupportedAsset,
      network: net,
      networkLabel: netMeta.displayName,
      address: wallet.address,
    };
  }
}
