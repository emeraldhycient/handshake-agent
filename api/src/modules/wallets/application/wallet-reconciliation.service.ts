/**
 * WalletReconciliationService — safe, idempotent deposit reconciliation.
 *
 * Handles the case where a Blockradar deposit webhook was never delivered but
 * the on-chain balance updated (testnet and production reliability gap).
 *
 * Algorithm (per user, per enabled asset):
 *   1. Fetch on-chain balance from the wallet provider (authoritative custodial figure).
 *   2. Fetch ledger balance via LEDGER_REPOSITORY (the custodial single source of truth).
 *   3a. on-chain > ledger  → credit the DELTA through the SAME atomic
 *       settleDepositAtomic path. Idempotency key derived from the reconciliation
 *       snapshot (recon:<walletId>:<asset>:<onChainBalance>) prevents double-credit
 *       when this method is called again with unchanged balances.
 *   3b. on-chain < ledger  → DO NOT auto-debit (too risky). Log + flag for
 *       manual review only.
 *   3c. on-chain === ledger → in-sync, nothing to do.
 *
 * Safety properties (CLAUDE.md §3):
 *   §3.1 — the model proposes, the engine disposes: this service never moves
 *     money outside the existing settleDepositAtomic kernel.
 *   §3.2 — no DB credentials or Prisma imports here: uses port interfaces only.
 *   §3.3 — server-side gate: this method is triggered by the admin-guarded
 *     endpoint (POST /admin/wallets/reconcile), not by any LLM or user input.
 *   No auto-debit path: over-credit is flagged for manual review (too risky to
 *     auto-correct — a forged / lagged provider balance could wipe funds).
 *
 * The result of each asset reconciliation is returned as a typed record so the
 * admin controller can surface actionable information to the operator.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import {
  WALLET_PROVIDER,
  type IWalletProvider,
} from './ports/wallet-provider.port';
import {
  WALLET_REPOSITORY,
  type IWalletRepository,
} from './ports/wallet.repository.port';
import {
  LEDGER_REPOSITORY,
  type ILedgerRepository,
} from '../../transactions/application/ports/ledger.repository.port';
import {
  DEPOSIT_SETTLEMENT_REPOSITORY,
  type IDepositSettlementRepository,
} from './ports/deposit-settlement.repository.port';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Ledger account type for a user's custodial wallet (mirrors LedgerAccountType.user_wallet). */
const USER_WALLET_ACCOUNT = 'user_wallet';

export type ReconciliationAction =
  | 'credited' // delta credited in this call
  | 'already_credited' // idempotent replay — settleDepositAtomic returned deposited:false
  | 'in_sync' // on-chain === ledger — nothing to do
  | 'over_credit_flagged'; // ledger > on-chain — flagged for manual review, no debit

export interface AssetReconciliationResult {
  /** Asset symbol (e.g. "USDT"). */
  asset: string;
  /** Network the wallet is on (e.g. "TRON"). */
  network: string;
  /** Wallet id. */
  walletId: string;
  /** On-chain balance string from the provider. */
  onChain: string;
  /** Ledger balance string from the custodial ledger. */
  ledger: string;
  /**
   * Signed difference (on-chain − ledger), as a decimal string.
   * Positive = missing credit; negative = over-credit.
   */
  delta: string;
  /** Action taken (or not taken) for this asset. */
  action: ReconciliationAction;
  /**
   * Whether the settleDepositAtomic call actually wrote new entries.
   * Only meaningful when action === 'credited' | 'already_credited'.
   */
  deposited?: boolean;
  /** Receipt number minted, when credited. */
  receiptNumber?: string;
}

export interface ReconcileUserAssetInput {
  userId: string;
  walletId: string;
  providerReference: string;
  assetSymbol: string;
  network: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class WalletReconciliationService {
  private readonly logger = new Logger(WalletReconciliationService.name);

  constructor(
    @Inject(WALLET_PROVIDER)
    private readonly walletProvider: IWalletProvider,
    @Inject(WALLET_REPOSITORY)
    private readonly walletRepo: IWalletRepository,
    @Inject(LEDGER_REPOSITORY)
    private readonly ledgerRepo: ILedgerRepository,
    @Inject(DEPOSIT_SETTLEMENT_REPOSITORY)
    private readonly settlementRepo: IDepositSettlementRepository,
    private readonly registry: AssetRegistry,
  ) {}

  /**
   * Reconciles ALL enabled assets for the given user.
   *
   * Iterates every enabled crypto asset in the registry; for each asset,
   * looks up the user's provisioned wallet for that network and calls
   * `reconcileUserAsset`. Assets with no provisioned wallet are skipped.
   *
   * @param userId - the user to reconcile.
   * @returns array of per-asset reconciliation results (one entry per enabled
   *   asset that has a provisioned wallet).
   */
  async reconcileUser(userId: string): Promise<AssetReconciliationResult[]> {
    const enabledAssets = this.registry.enabledCryptoAssets();
    const userWallets = await this.walletRepo.findByUser(userId);

    // Index user wallets by network for O(1) lookup per asset.
    const walletByNetwork = new Map(userWallets.map((w) => [w.network, w]));

    const results: AssetReconciliationResult[] = [];

    for (const assetSymbol of enabledAssets) {
      let network: string;
      try {
        network = this.registry.defaultNetworkFor(assetSymbol);
      } catch {
        this.logger.warn(
          { assetSymbol },
          'reconcileUser: no enabled network for asset — skipping',
        );
        continue;
      }

      const wallet = walletByNetwork.get(network);
      if (!wallet) {
        this.logger.debug(
          { userId, assetSymbol, network },
          'reconcileUser: no provisioned wallet for user/network — skipping',
        );
        continue;
      }

      const result = await this.reconcileUserAsset({
        userId,
        walletId: wallet.id,
        providerReference: wallet.providerReference,
        assetSymbol,
        network,
      });

      results.push(result);
    }

    return results;
  }

  /**
   * Reconciles a single (wallet, asset) pair.
   *
   * Fetches the on-chain balance from the provider and the ledger balance
   * from the custodial ledger, then takes the appropriate action:
   *
   *   - on-chain > ledger → credit delta via settleDepositAtomic.
   *   - on-chain < ledger → flag for manual review, no auto-debit.
   *   - on-chain === ledger → in-sync, no action.
   */
  async reconcileUserAsset(
    input: ReconcileUserAssetInput,
  ): Promise<AssetReconciliationResult> {
    const { userId, walletId, providerReference, assetSymbol, network } = input;

    // ── 1. Resolve provider asset id ────────────────────────────────────────
    let assetId: string;
    try {
      assetId = this.registry.assetProviderId(assetSymbol, 'blockradar');
    } catch {
      // If asset has no provider binding, we can't query the on-chain balance.
      this.logger.warn(
        { userId, walletId, assetSymbol },
        'reconcileUserAsset: no blockradar provider id for asset — skipping',
      );
      // Return a safe no-op result.
      return {
        asset: assetSymbol,
        network,
        walletId,
        onChain: '0',
        ledger: '0',
        delta: '0',
        action: 'in_sync',
      };
    }

    // ── 2. Fetch on-chain balance (authoritative custodial figure) ───────────
    const { amount: onChainAmount } = await this.walletProvider.getBalance(
      providerReference,
      assetId,
      network,
    );

    // ── 3. Fetch ledger balance (custodial single source of truth) ───────────
    const ledgerAmount = await this.ledgerRepo.getAccountBalance(
      USER_WALLET_ACCOUNT,
      walletId,
      assetSymbol,
    );

    // ── 4. Compute delta (on-chain − ledger) using big-decimal arithmetic ────
    // All amounts are decimal strings. We use scaled integer arithmetic to
    // avoid floating-point rounding errors:
    //   multiply by 10^6 (max USDT / TRX decimals) → compare as BigInt.
    const SCALE = 1_000_000n; // sufficient for 6-decimal assets
    const onChainScaled = BigInt(
      Math.round(parseFloat(onChainAmount) * 1_000_000),
    );
    const ledgerScaled = BigInt(
      Math.round(parseFloat(ledgerAmount) * 1_000_000),
    );
    const deltaScaled = onChainScaled - ledgerScaled;

    const deltaStr =
      (Number(deltaScaled) / Number(SCALE)).toFixed(6).replace(/\.?0+$/, '') ||
      '0';

    this.logger.log(
      {
        userId,
        walletId,
        assetSymbol,
        onChainAmount,
        ledgerAmount,
        delta: deltaStr,
      },
      'reconcileUserAsset: balance comparison',
    );

    // ── 5. Act on the delta ──────────────────────────────────────────────────

    if (deltaScaled === 0n) {
      // Balances match — nothing to do.
      return {
        asset: assetSymbol,
        network,
        walletId,
        onChain: onChainAmount,
        ledger: ledgerAmount,
        delta: '0',
        action: 'in_sync',
      };
    }

    if (deltaScaled < 0n) {
      // Ledger > on-chain: over-credit scenario.
      // NEVER auto-debit — a forged or temporarily-lagged provider balance
      // could wipe funds. Flag for manual review.
      this.logger.warn(
        {
          userId,
          walletId,
          assetSymbol,
          onChainAmount,
          ledgerAmount,
          delta: deltaStr,
        },
        'reconcileUserAsset: OVER-CREDIT detected — ledger exceeds on-chain balance. ' +
          'Flagged for manual review. No auto-debit will be performed.',
      );
      return {
        asset: assetSymbol,
        network,
        walletId,
        onChain: onChainAmount,
        ledger: ledgerAmount,
        delta: deltaStr,
        action: 'over_credit_flagged',
      };
    }

    // deltaScaled > 0: on-chain > ledger → credit the missing delta.
    //
    // Idempotency key: derived from a reconciliation snapshot so a re-run with
    // the exact same on-chain balance produces the SAME txHash and
    // settleDepositAtomic's DepositConfirmation(txHash) dedup prevents
    // double-credit.
    //
    // Key format: recon:<walletId>:<assetSymbol>:<onChainBalance>
    // This encodes:
    //   - which wallet (walletId)
    //   - which asset (assetSymbol)
    //   - at which on-chain level the reconciliation fired (onChainAmount)
    // Two calls with the same key will both hit the existing DepositConfirmation
    // and return { deposited: false } on the second call — no double-credit.
    const idempotencyTxHash = `recon:${walletId}:${assetSymbol}:${onChainAmount}`;

    const creditAmount = (Number(deltaScaled) / Number(SCALE))
      .toFixed(6)
      .replace(/\.?0+$/, '');

    this.logger.log(
      { userId, walletId, assetSymbol, creditAmount, idempotencyTxHash },
      'reconcileUserAsset: crediting missing on-chain delta via settleDepositAtomic',
    );

    const settlement = await this.settlementRepo.settleDepositAtomic({
      walletId,
      userId,
      cryptoAmount: creditAmount,
      asset: assetSymbol,
      txHash: idempotencyTxHash,
      sourceAddress: undefined,
      providerWebhookId: undefined,
      postedAt: new Date(),
    });

    if (settlement.deposited) {
      this.logger.log(
        {
          userId,
          walletId,
          assetSymbol,
          creditAmount,
          newBalance: settlement.newBalance,
          receiptNumber: settlement.receiptNumber,
        },
        'reconcileUserAsset: delta credited successfully',
      );
      return {
        asset: assetSymbol,
        network,
        walletId,
        onChain: onChainAmount,
        ledger: ledgerAmount,
        delta: creditAmount,
        action: 'credited',
        deposited: true,
        receiptNumber: settlement.receiptNumber,
      };
    }

    // settleDepositAtomic returned deposited:false — idempotent replay.
    this.logger.log(
      { userId, walletId, assetSymbol, idempotencyTxHash },
      'reconcileUserAsset: idempotent replay — already credited, no new entry written',
    );
    return {
      asset: assetSymbol,
      network,
      walletId,
      onChain: onChainAmount,
      ledger: ledgerAmount,
      delta: creditAmount,
      action: 'already_credited',
      deposited: false,
    };
  }
}
