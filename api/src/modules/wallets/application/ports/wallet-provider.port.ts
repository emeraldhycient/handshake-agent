/**
 * DI token and port contract for the wallet provider (Blockradar WaaS).
 * Infrastructure provides the concrete adapter; application only depends on
 * this interface (clean-arch §4.1 — application must never import infrastructure).
 */
export const WALLET_PROVIDER = Symbol('WALLET_PROVIDER');

export interface ProvisionAddressInput {
  /** Opaque user reference written into the provider's metadata for audit traceability. */
  userRef: string;
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

export interface IWalletProvider {
  /**
   * Provisions a new child address under the configured master wallet.
   * Returns the provider reference id, the on-chain address, and the network name.
   */
  provisionAddress(
    input: ProvisionAddressInput,
  ): Promise<ProvisionAddressOutput>;

  /**
   * Returns the current USDT balance for the given provider address id.
   * Amount is already human-scaled (not raw integer units).
   */
  getBalance(addressId: string): Promise<GetBalanceOutput>;
}
