import { Injectable, Logger } from '@nestjs/common';

import type {
  IWalletProvider,
  ProvisionAddressInput,
  ProvisionAddressOutput,
  GetBalanceOutput,
  WithdrawInput,
  WithdrawOutput,
  GetWithdrawalStatusOutput,
  DiscoveredAsset,
} from '../application/ports/wallet-provider.port';

/**
 * Mock wallet provider — the default adapter when `WALLET_MOCK_MODE=true`
 * (the env-schema default). Lets receive/send/buy flows be exercised locally and
 * in tests WITHOUT a live Blockradar call or real keys. The real
 * `BlockradarProvider` is selected by `WalletsModule` when the flag is 'false'.
 *
 * Safety (root §3.1): `withdraw` / `getWithdrawalStatus` ALWAYS report `pending`
 * — a mock never broadcasts a real on-chain transaction, so the engine must
 * never finalise (or, on the reconciler path, refund) off a fabricated status.
 *
 * No HttpService dependency — it makes no network calls.
 */
@Injectable()
export class MockWalletProvider implements IWalletProvider {
  private readonly logger = new Logger(MockWalletProvider.name);

  // A deterministic, TRON-address-shaped placeholder (matches the receive
  // address pattern) so the receive card / QR renders. NOT a real address —
  // never send real funds here.
  private static readonly MOCK_ADDRESS = `TMockAddr${'1'.repeat(25)}`;

  provisionAddress(
    input: ProvisionAddressInput,
  ): Promise<ProvisionAddressOutput> {
    this.logger.warn(
      `[mock-wallet] provisionAddress userRef=${input.userRef} network=${input.network} — NO real Blockradar call (WALLET_MOCK_MODE=true)`,
    );
    return Promise.resolve({
      providerReference: `mock-addr-${input.userRef}`,
      address: MockWalletProvider.MOCK_ADDRESS,
      network: input.network,
    });
  }

  // Params omitted intentionally (still satisfies IWalletProvider).
  getBalance(): Promise<GetBalanceOutput> {
    // USDT has 6 decimals; a fresh mock address holds nothing.
    return Promise.resolve({ amount: '0', decimals: 6 });
  }

  withdraw(input: WithdrawInput): Promise<WithdrawOutput> {
    this.logger.warn(
      `[mock-wallet] withdraw to=${input.toAddress} amount=${input.amount} — NO real on-chain broadcast (WALLET_MOCK_MODE=true)`,
    );
    return Promise.resolve({
      providerReference: `mock-wd-${input.reference ?? input.addressId}`,
      status: 'pending',
    });
  }

  // Param omitted intentionally (still satisfies IWalletProvider).
  getWithdrawalStatus(): Promise<GetWithdrawalStatusOutput> {
    // Fail-safe pending: a mock has no real on-chain outcome to report.
    return Promise.resolve({ status: 'pending' });
  }

  /**
   * Returns a static, plausible asset set for TRON — USDT and TRX — with
   * fake but well-formed UUIDs.  Tests and WALLET_MOCK_MODE boots get a
   * predictable catalog without a real Blockradar call.
   *
   * These ids intentionally look different from the old hardcoded
   * 'f56d297c-…' so tests confirm the catalog now uses discovered ids.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  listWalletAssets(_masterWalletId: string): Promise<DiscoveredAsset[]> {
    return Promise.resolve([
      {
        assetId: 'mock-usdt-tron-asset-id-0000000000001',
        symbol: 'USDT',
        name: 'Tether USD',
        network: 'TRON',
        contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        decimals: 6,
        isMainnet: false, // testnet wallet in mock/dev mode
        logoUrl: null, // mock provider has no logo source; UI falls back to text badge
      },
      {
        assetId: 'mock-trx-tron-asset-id-00000000000002',
        symbol: 'TRX',
        name: 'TRON',
        network: 'TRON',
        contractAddress: null, // native asset, no contract address
        decimals: 6,
        isMainnet: false,
        logoUrl: null,
      },
    ]);
  }
}
