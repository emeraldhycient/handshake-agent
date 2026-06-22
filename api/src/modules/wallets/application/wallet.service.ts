import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type Clock } from '../../../core/common/clock';
import {
  WALLET_PROVIDER,
  type IWalletProvider,
  type GetBalanceOutput,
} from './ports/wallet-provider.port';
import {
  WALLET_REPOSITORY,
  type IWalletRepository,
  type WalletRecord,
} from './ports/wallet.repository.port';

/** Canonical asset / network for the USDT-on-TRON custodial wallet at launch. */
const USDT_TRON_ASSET = 'USDT';
const USDT_TRON_NETWORK = 'TRON';
const WALLET_STATUS_ACTIVE = 'active';

/**
 * Application-layer wallet service. Exposes idempotent get-or-provision and
 * balance-read operations. It never touches the DB or the provider directly —
 * both are injected ports (clean-arch §4.1, CLAUDE.md §3.2).
 *
 * Invariant (§3.1): this service only manages the custodial address record
 * and balance reads. The execution engine (Task 4.5) is responsible for
 * crediting / debiting this wallet — this service does NOT move money.
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
  ) {}

  /**
   * Returns the user's USDT-on-TRON custodial wallet, provisioning it on first
   * call (idempotent — a second call for the same user returns the existing row
   * without contacting the provider again).
   */
  async getOrProvisionUsdtTronWallet(userId: string): Promise<WalletRecord> {
    const existing = await this.repo.findByUserAssetNetwork(
      userId,
      USDT_TRON_ASSET,
      USDT_TRON_NETWORK,
    );

    if (existing !== null) {
      return existing;
    }

    // Provision a new child address at the WaaS provider.
    const provisioned = await this.provider.provisionAddress({
      userRef: userId,
    });

    // Persist and return.
    return this.repo.create({
      userId,
      asset: USDT_TRON_ASSET,
      network: USDT_TRON_NETWORK,
      address: provisioned.address,
      providerReference: provisioned.providerReference,
      status: WALLET_STATUS_ACTIVE,
      provisionedAt: this.clock.now(),
    });
  }

  /**
   * Reads the current USDT balance for the given wallet from the provider.
   * Delegates to the `WALLET_PROVIDER` port via the wallet's `providerReference`.
   */
  async getBalance(wallet: WalletRecord): Promise<GetBalanceOutput> {
    return this.provider.getBalance(wallet.providerReference);
  }
}
