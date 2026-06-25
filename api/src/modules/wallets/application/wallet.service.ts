import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type Clock } from '../../../core/common/clock';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { UnsupportedNetworkForAssetError } from '../../../core/catalog/catalog-errors';
import {
  WALLET_PROVIDER,
  type IWalletProvider,
  type GetBalanceOutput,
  type WithdrawOutput,
  type GetWithdrawalStatusOutput,
} from './ports/wallet-provider.port';
import {
  WALLET_REPOSITORY,
  type IWalletRepository,
  type WalletRecord,
} from './ports/wallet.repository.port';

const WALLET_STATUS_ACTIVE = 'active';

/**
 * Application-layer wallet service. Exposes idempotent get-or-provision and
 * balance-read operations. It never touches the DB or the provider directly —
 * both are injected ports (clean-arch §4.1, CLAUDE.md §3.2).
 *
 * Invariant (§3.1): this service only manages the custodial address record
 * and balance reads. The execution engine (Task 4.5) is responsible for
 * crediting / debiting this wallet — this service does NOT move money.
 *
 * WN-1 model: one wallet per (user, network). A Blockradar child address
 * receives ALL assets on its chain, so asset is NOT part of the wallet identity.
 * Per-asset balances are tracked in WalletBalance records.
 */
@Injectable()
export class WalletService {
  constructor(
    @Inject(WALLET_PROVIDER)
    private readonly provider: IWalletProvider,
    @Inject(WALLET_REPOSITORY)
    private readonly repo: IWalletRepository,
    @Inject(CLOCK)
    private readonly clock: Clock,
    private readonly assetRegistry: AssetRegistry,
  ) {}

  /**
   * Returns the user's custodial wallet for the given network, provisioning it
   * on first call (idempotent — a second call for the same user/network pair
   * returns the existing row without contacting the provider again).
   *
   * Validates that the network is enabled in the registry before provisioning.
   *
   * @throws {UnsupportedNetworkError} when the network is not registered or disabled.
   */
  async getOrProvisionNetworkWallet(
    userId: string,
    network: string,
  ): Promise<WalletRecord> {
    // Validate via registry — throws UnsupportedNetworkError on failure.
    this.assetRegistry.network(network);

    const existing = await this.repo.findByUserNetwork(userId, network);

    if (existing !== null) {
      return existing;
    }

    // Provision a new child address at the WaaS provider for this network.
    const provisioned = await this.provider.provisionAddress({
      userRef: userId,
      network,
    });

    // Persist and return.
    return this.repo.create({
      userId,
      network,
      address: provisioned.address,
      providerReference: provisioned.providerReference,
      status: WALLET_STATUS_ACTIVE,
      provisionedAt: this.clock.now(),
    });
  }

  /**
   * Provisions wallets for all enabled networks in the registry (idempotent).
   * Iterates `AssetRegistry.enabledNetworks()` and calls
   * `getOrProvisionNetworkWallet` for each. New networks are covered by config
   * entry alone — no code change here (registry-driven §7).
   *
   * Used at KYC completion to pre-provision all receive addresses.
   */
  async provisionAllEnabledNetworks(userId: string): Promise<WalletRecord[]> {
    const networks = this.assetRegistry.enabledNetworks();
    const wallets = await Promise.all(
      networks.map((network) =>
        this.getOrProvisionNetworkWallet(userId, network),
      ),
    );
    return wallets;
  }

  /**
   * @deprecated Use `getOrProvisionNetworkWallet(userId, network)` instead.
   *
   * Backward-compat shim: resolves asset→network (asserts the asset supports
   * that network via the registry) and delegates to `getOrProvisionNetworkWallet`.
   * Kept so existing callers (proposals, execution, conversations) compile until
   * WN-2 migrates them to the per-network API.
   *
   * @throws {UnsupportedAssetError}            when the asset is not registered or disabled.
   * @throws {UnsupportedNetworkError}           when the network is not registered or disabled.
   * @throws {UnsupportedNetworkForAssetError}   when the asset does not list the network.
   */
  async getOrProvisionWallet(
    userId: string,
    asset: string,
    network: string,
  ): Promise<WalletRecord> {
    // Validate asset is registered and lists the network (backward-compat guard).
    const assetMeta = this.assetRegistry.asset(asset);
    this.assetRegistry.network(network); // throws UnsupportedNetworkError if absent/disabled
    if (!assetMeta.networks.includes(network)) {
      throw new UnsupportedNetworkForAssetError(network, asset);
    }

    return this.getOrProvisionNetworkWallet(userId, network);
  }

  /**
   * Returns the user's USDT-on-TRON custodial wallet, provisioning it on first
   * call. Thin delegate to `getOrProvisionNetworkWallet` using the registry default
   * asset and network (task X3 backward-compat shim for callers not yet updated).
   */
  async getOrProvisionUsdtTronWallet(userId: string): Promise<WalletRecord> {
    const asset = this.assetRegistry.defaultCryptoAsset();
    const network = this.assetRegistry.defaultNetworkFor(asset);
    return this.getOrProvisionNetworkWallet(userId, network);
  }

  /**
   * Reads the current balance for a specific asset on the given wallet from the
   * provider. Delegates to the `WALLET_PROVIDER` port using the wallet's
   * `providerReference`, the provider-specific asset id resolved from the
   * registry, and the wallet's network for master-wallet resolution.
   */
  async getBalance(
    wallet: WalletRecord,
    asset: string,
  ): Promise<GetBalanceOutput> {
    const assetId = this.assetRegistry.assetProviderId(asset, 'blockradar');
    return this.provider.getBalance(
      wallet.providerReference,
      assetId,
      wallet.network,
    );
  }

  /**
   * Initiates an on-chain withdrawal from the given wallet to an external address.
   *
   * Delegates to the `WALLET_PROVIDER` port. This is a NON-BLOCKING call:
   * the provider returns a providerReference immediately with a pending status.
   * The deterministic execution engine (§3.1) holds the idempotency key and
   * updates the settlement record on webhook receipt.
   *
   * @param wallet    - The custodial wallet to withdraw from.
   * @param toAddress - The on-chain destination address.
   * @param amount    - Human-scaled amount string (e.g. "10.5" for 10.5 USDT).
   * @param assetId   - Provider-specific asset id from AssetRegistry.assetProviderId.
   * @param reference - Optional caller-supplied idempotency key for the provider.
   */
  async withdraw(
    wallet: WalletRecord,
    toAddress: string,
    amount: string,
    assetId: string,
    reference?: string,
  ): Promise<WithdrawOutput> {
    return this.provider.withdraw({
      addressId: wallet.providerReference,
      toAddress,
      amount,
      assetId,
      network: wallet.network,
      reference,
    });
  }

  /**
   * Queries the current status of an on-chain withdrawal by its caller-supplied
   * reference. Delegates to `IWalletProvider.getWithdrawalStatus`.
   *
   * Used by the reconciler to safely handle missed webhooks. The `wallet` is
   * needed to scope the provider query to the correct child address (the
   * `providerReference` field is the Blockradar child address id) and to resolve
   * the correct master wallet id via `wallet.network`.
   *
   * This method never throws: the provider implementation returns `{ status: 'pending' }`
   * on any error so the reconciler leaves the outbox row open rather than refunding.
   *
   * @param wallet    - The custodial wallet the withdrawal was sent from.
   * @param reference - The caller-supplied idempotency reference from executeSend.
   */
  async getWithdrawalStatus(
    wallet: WalletRecord,
    reference: string,
  ): Promise<GetWithdrawalStatusOutput> {
    return this.provider.getWithdrawalStatus({
      reference,
      addressId: wallet.providerReference,
      network: wallet.network,
    });
  }
}
