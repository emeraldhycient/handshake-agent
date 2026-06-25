/**
 * DI token and port contract for the wallet provider (Blockradar WaaS).
 * Infrastructure provides the concrete adapter; application only depends on
 * this interface (clean-arch §4.1 — application must never import infrastructure).
 */
export const WALLET_PROVIDER = Symbol('WALLET_PROVIDER');

export interface ProvisionAddressInput {
  /** Opaque user reference written into the provider's metadata for audit traceability. */
  userRef: string;
  /**
   * Network to provision the child address on. Used to resolve the correct
   * Blockradar master wallet id (per-network mapping from AssetRegistry).
   * e.g. "TRON"
   */
  network: string;
}

export interface ProvisionAddressOutput {
  /** Provider-scoped id for the child address (used for balance queries). */
  providerReference: string;
  /** On-chain receive address string. */
  address: string;
  /** Network name returned by the provider (e.g. "TRON"). */
  network: string;
}

export interface GetBalanceOutput {
  /** Asset-native amount as a decimal string (already human-scaled, e.g. "6.500000"). */
  amount: string;
  /** Asset decimal precision (e.g. 6 for USDT). */
  decimals: number;
}

export interface WithdrawInput {
  /** Provider-scoped child address id (providerReference on WalletRecord). Withdraw is sent FROM this address. */
  addressId: string;
  /** On-chain destination address. */
  toAddress: string;
  /** Human-scaled amount string (e.g. "10.5" for 10.5 USDT). */
  amount: string;
  /** Provider-specific asset id (from AssetRegistry.assetProviderId). */
  assetId: string;
  /**
   * Network the wallet lives on (e.g. "TRON"). Used to resolve the correct
   * Blockradar master wallet id for the URL.
   */
  network: string;
  /**
   * Optional caller-supplied idempotency key. If provided, Blockradar uses it
   * as the `reference` field to deduplicate concurrent or retried withdrawals.
   */
  reference?: string;
}

export interface WithdrawOutput {
  /** Provider-assigned transaction / reference id. */
  providerReference: string;
  /** On-chain transaction hash. May be absent while the transaction is still pending. */
  txHash?: string;
  /** Transaction lifecycle status returned by the provider. */
  status: 'pending' | 'success' | 'failed';
}

export interface GetWithdrawalStatusInput {
  /**
   * The caller-supplied reference that was passed to `withdraw()`.
   * Blockradar echoes this as the `reference` field on the transaction.
   */
  reference: string;
  /**
   * Optional provider-scoped child address id (providerReference on WalletRecord).
   * When provided, the lookup is scoped to that address; improves accuracy and
   * avoids cross-wallet reference collisions.
   */
  addressId?: string;
  /**
   * Network the wallet lives on (e.g. "TRON"). Used to resolve the correct
   * Blockradar master wallet id for the URL. Defaults to fail-safe pending when absent.
   */
  network?: string;
}

export interface GetWithdrawalStatusOutput {
  /** Normalised withdrawal lifecycle status. */
  status: 'pending' | 'success' | 'failed';
  /** On-chain transaction hash — present only when status = 'success'. */
  onChainTxHash?: string;
}

export interface IWalletProvider {
  /**
   * Provisions a new child address under the configured master wallet.
   * Returns the provider reference id, the on-chain address, and the network name.
   */
  provisionAddress(
    input: ProvisionAddressInput,
  ): Promise<ProvisionAddressOutput>;

  /**
   * Returns the current balance for the given provider address id and asset.
   * Amount is already human-scaled (not raw integer units).
   *
   * @param addressId - The provider-scoped child address id (providerReference on WalletRecord).
   * @param assetId   - The provider-specific asset id (from AssetRegistry.assetProviderId).
   * @param network   - Network the wallet lives on (e.g. "TRON"). Used to resolve the correct master wallet id.
   */
  getBalance(
    addressId: string,
    assetId: string,
    network: string,
  ): Promise<GetBalanceOutput>;

  /**
   * Initiates an on-chain withdrawal from the given child address to an external address.
   *
   * Uses `POST /wallets/{masterWalletId}/addresses/{addressId}/withdraw` (Blockradar v1).
   * The call is NON-BLOCKING: the provider returns immediately with a pending status and
   * delivers the final status via webhook. The deterministic execution engine (§3.1)
   * holds the idempotency key and updates the settlement record on webhook receipt.
   *
   * @throws Error (with provider message) on non-2xx responses.
   */
  withdraw(input: WithdrawInput): Promise<WithdrawOutput>;

  /**
   * Queries the provider for the current status of an on-chain withdrawal by its
   * caller-supplied reference.
   *
   * Used by the reconciler to safely handle missed webhooks: before refunding a
   * `pending` onchain_send outbox row the reconciler MUST call this method to
   * verify the actual on-chain outcome rather than assuming failure.
   *
   * Endpoint (Blockradar v1):
   *   GET /wallets/{masterWalletId}/addresses/{addressId}/transactions
   *   — filter client-side by `data[].reference === input.reference`.
   *
   * Returns `pending` on any provider error so the reconciler leaves the row
   * open for the webhook (or a later tick) to finalize — fail-safe behaviour.
   *
   * @throws Never — provider errors are caught and converted to `{ status: 'pending' }`.
   */
  getWithdrawalStatus(
    input: GetWithdrawalStatusInput,
  ): Promise<GetWithdrawalStatusOutput>;
}
