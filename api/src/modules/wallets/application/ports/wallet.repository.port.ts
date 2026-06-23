/**
 * DI token and port contract for the wallet repository. Infrastructure provides
 * the concrete Prisma adapter; application stays DB-agnostic (clean-arch §4.1).
 */
export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY');

/**
 * Application-level wallet record — NOT the Prisma-generated type.
 * Infrastructure maps DB rows to this shape; the application layer never sees Prisma types.
 */
export interface WalletRecord {
  id: string;
  userId: string;
  /** Asset identifier, e.g. "USDT". */
  asset: string;
  /** Network identifier, e.g. "TRON". */
  network: string;
  /** On-chain receive address. */
  address: string;
  /** Opaque Blockradar child-wallet id used for balance queries. */
  providerReference: string;
  /** Current wallet lifecycle status. */
  status: string;
}

export interface CreateWalletData {
  userId: string;
  asset: string;
  network: string;
  address: string;
  providerReference: string;
  status: string;
  provisionedAt: Date;
}

export interface IWalletRepository {
  /**
   * Returns the wallet for the given user / asset / network combination,
   * or null if it has not been provisioned yet.
   */
  findByUserAssetNetwork(
    userId: string,
    asset: string,
    network: string,
  ): Promise<WalletRecord | null>;

  /**
   * Returns the wallet for the given on-chain address, or null if none exists.
   * Used by the Blockradar deposit webhook to resolve the recipient wallet.
   */
  findByAddress(address: string): Promise<WalletRecord | null>;

  /**
   * Persists a new wallet record and returns the created WalletRecord.
   * Callers must ensure no duplicate (userId, asset, network) exists before calling.
   */
  create(data: CreateWalletData): Promise<WalletRecord>;
}
