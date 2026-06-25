import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import type {
  IWalletProvider,
  ProvisionAddressInput,
  ProvisionAddressOutput,
  GetBalanceOutput,
  WithdrawInput,
  WithdrawOutput,
  GetWithdrawalStatusInput,
  GetWithdrawalStatusOutput,
} from '../application/ports/wallet-provider.port';

// ---------------------------------------------------------------------------
// Blockradar response shapes
// ---------------------------------------------------------------------------

interface BlockradarErrorBody {
  message: string;
  statusCode?: number;
}

interface ProvisionAddressResponseData {
  id: string;
  address: string;
  blockchain: {
    name: string;
  };
}

interface BlockradarProvisionResponse {
  data: ProvisionAddressResponseData;
}

interface BalanceResponseData {
  balance: string; // Human-scaled decimal string (e.g. "6.500000")
  asset: {
    asset: {
      decimals: number;
    };
  };
}

interface BlockradarBalanceResponse {
  data: BalanceResponseData;
}

// ---------------------------------------------------------------------------
// withdraw — confirmed against docs.blockradar.co/llms-full.txt (task N1)
// POST /wallets/{masterWalletId}/addresses/{addressId}/withdraw
// Response status values from Blockradar: SUCCESS | PENDING | FAILED
// ---------------------------------------------------------------------------

interface WithdrawResponseData {
  /** Provider-assigned transaction id. */
  id: string;
  /**
   * Blockradar lifecycle status string.
   * Known values (docs.blockradar.co): 'SUCCESS' | 'PENDING' | 'FAILED'.
   * Typed as `string` so future Blockradar status additions do not break the
   * type; `mapStatus` handles the conversion to our lowercase port union.
   */
  status: string;
  /** Echoed caller reference (if supplied). */
  reference?: string;
  /** On-chain tx hash — may be absent while pending. */
  txHash?: string;
}

interface BlockradarWithdrawResponse {
  data: WithdrawResponseData;
}

// ---------------------------------------------------------------------------
// getWithdrawalStatus — list address transactions, match by reference
// GET /wallets/{masterWalletId}/addresses/{addressId}/transactions
// Response: { data: Array<{ id, status, reference?, hash? }> }
// ---------------------------------------------------------------------------

interface AddressTransactionItem {
  id: string;
  /**
   * Blockradar lifecycle status string.
   * Known values: 'SUCCESS' | 'PENDING' | 'FAILED'.
   */
  status: string;
  /** Echoed caller reference — matches what was supplied at withdrawal time. */
  reference?: string;
  /** On-chain tx hash — populated once the transaction is confirmed. */
  hash?: string;
}

interface BlockradarAddressTransactionsResponse {
  data: AddressTransactionItem[];
}

/**
 * Blockradar WaaS adapter — implements `IWalletProvider`.
 *
 * All configuration (base URL, API key, per-network master wallet ids) is read
 * from ConfigService / AssetRegistry so tests can stub it without real network
 * calls. Mirrors the `CloudApiSender` pattern (modules/whatsapp/infrastructure/).
 *
 * WN-1: master wallet id is now resolved per-network from the AssetRegistry
 * (catalog.networks[network].masterWalletId). A new network only needs an entry
 * in the catalog — no code change here (registry-driven §7).
 *
 * Auth: Blockradar uses `x-api-key` header (NOT Bearer).
 */
@Injectable()
export class BlockradarProvider implements IWalletProvider {
  private readonly baseUrl: string;
  private readonly apiKeyHeader: string;

  constructor(
    private readonly http: HttpService,
    // Bare ConfigService so env keys (BLOCKRADAR_*) can be read without
    // type-narrowing issues.
    private readonly config: ConfigService,
    // AssetRegistry for per-network master wallet id resolution (WN-1).
    private readonly assetRegistry: AssetRegistry,
  ) {
    this.baseUrl =
      this.config.get<string>('BLOCKRADAR_BASE_URL') ??
      'https://api.blockradar.co/v1';
    this.apiKeyHeader = this.config.get<string>('BLOCKRADAR_API_KEY') ?? '';
  }

  // ---------------------------------------------------------------------------
  // IWalletProvider
  // ---------------------------------------------------------------------------

  async provisionAddress(
    input: ProvisionAddressInput,
  ): Promise<ProvisionAddressOutput> {
    const masterWalletId = this.resolveMasterWalletId(input.network);
    const url = `${this.baseUrl}/wallets/${masterWalletId}/addresses`;
    const body = {
      metadata: { userRef: input.userRef },
    };

    try {
      const response = await firstValueFrom(
        this.http.post<BlockradarProvisionResponse>(url, body, {
          headers: this.headers(),
        }),
      );

      const { id, address, blockchain } = response.data.data;
      return {
        providerReference: id,
        address,
        network: blockchain.name,
      };
    } catch (err: unknown) {
      throw this.wrapError('provisionAddress', err);
    }
  }

  async getBalance(
    addressId: string,
    assetId: string,
    network: string,
  ): Promise<GetBalanceOutput> {
    const masterWalletId = this.resolveMasterWalletId(network);
    const url = `${this.baseUrl}/wallets/${masterWalletId}/addresses/${addressId}/balance`;
    const params = { assetId };

    try {
      const response = await firstValueFrom(
        this.http.get<BlockradarBalanceResponse>(url, {
          headers: this.headers(),
          params,
        }),
      );

      const { balance, asset } = response.data.data;
      return {
        amount: balance,
        decimals: asset.asset.decimals,
      };
    } catch (err: unknown) {
      throw this.wrapError('getBalance', err);
    }
  }

  /**
   * Initiates an on-chain withdrawal from a child address.
   *
   * Endpoint (confirmed docs.blockradar.co/llms-full.txt, task N1):
   *   POST /wallets/{masterWalletId}/addresses/{addressId}/withdraw
   *
   * WN-1: masterWalletId is now resolved per-network from the AssetRegistry.
   *
   * The call returns immediately with PENDING status; Blockradar delivers
   * the final status (SUCCESS | FAILED) via webhook. The execution engine
   * updates the settlement record on webhook receipt (§3.1).
   */
  async withdraw(input: WithdrawInput): Promise<WithdrawOutput> {
    const { addressId, toAddress, amount, assetId, network, reference } = input;
    const masterWalletId = this.resolveMasterWalletId(network);
    const url = `${this.baseUrl}/wallets/${masterWalletId}/addresses/${addressId}/withdraw`;

    // Build body; only include reference when the caller supplied one so the
    // request stays minimal when no idempotency key is provided.
    const body: Record<string, string> = {
      address: toAddress,
      amount,
      assetId,
    };
    if (reference !== undefined) {
      body['reference'] = reference;
    }

    try {
      const response = await firstValueFrom(
        this.http.post<BlockradarWithdrawResponse>(url, body, {
          headers: this.headers(),
        }),
      );

      const { id, status, txHash } = response.data.data;
      return {
        providerReference: id,
        txHash,
        status: this.mapStatus(status),
      };
    } catch (err: unknown) {
      throw this.wrapError('withdraw', err);
    }
  }

  /**
   * Queries the withdrawal status for a given caller reference by listing
   * the address-scoped transactions and finding the matching entry.
   *
   * Endpoint (confirmed docs.blockradar.co):
   *   GET /wallets/{masterWalletId}/addresses/{addressId}/transactions
   *
   * WN-1: masterWalletId is now resolved per-network from the AssetRegistry.
   *
   * The `reference` field on each transaction item is the value the caller
   * supplied when initiating the withdrawal. We filter client-side because
   * Blockradar does not document a `?reference=` query parameter.
   *
   * Fail-safe: any provider error (network, 4xx, 5xx) returns `{ status: 'pending' }`
   * so the reconciler leaves the outbox row open rather than refunding prematurely.
   */
  async getWithdrawalStatus(
    input: GetWithdrawalStatusInput,
  ): Promise<GetWithdrawalStatusOutput> {
    const { reference, addressId, network } = input;

    // addressId is required to scope the request; without it we cannot query.
    // Return pending so the row is not refunded on a missing addressId.
    if (!addressId) {
      return { status: 'pending' };
    }

    // network is required to resolve the master wallet id; without it fail-safe pending.
    if (!network) {
      return { status: 'pending' };
    }

    let masterWalletId: string;
    try {
      masterWalletId = this.resolveMasterWalletId(network);
    } catch {
      // No configured master wallet for this network — fail-safe pending.
      return { status: 'pending' };
    }

    const url = `${this.baseUrl}/wallets/${masterWalletId}/addresses/${addressId}/transactions`;

    try {
      const response = await firstValueFrom(
        this.http.get<BlockradarAddressTransactionsResponse>(url, {
          headers: this.headers(),
        }),
      );

      const items: AddressTransactionItem[] = response.data.data ?? [];
      const match = items.find((item) => item.reference === reference);

      if (!match) {
        // Reference not found yet — the withdrawal may still be queued.
        return { status: 'pending' };
      }

      const status = this.mapStatus(match.status);
      return {
        status,
        ...(status === 'success' && match.hash
          ? { onChainTxHash: match.hash }
          : {}),
      };
    } catch {
      // Any provider error → fail-safe pending so reconciler does not refund.
      return { status: 'pending' };
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolves the Blockradar master wallet id for the given network from the
   * AssetRegistry catalog. Throws a clear error if no master wallet id is
   * configured for the network (fail-closed — misconfiguration must not
   * silently fallback to a wrong wallet).
   */
  private resolveMasterWalletId(network: string): string {
    return this.assetRegistry.networkMasterWalletId(network);
  }

  /**
   * Maps Blockradar's uppercase status strings to the port's lowercase union.
   * Unknown values default to 'pending' (fail-safe; the engine re-checks on webhook).
   * Accepts `string` (not a literal union) because the response type is widened
   * to allow for new status values without a compile error.
   */
  private mapStatus(raw: string): 'success' | 'pending' | 'failed' {
    switch (raw) {
      case 'SUCCESS':
        return 'success';
      case 'FAILED':
        return 'failed';
      default:
        return 'pending';
    }
  }

  /** Common Blockradar auth headers. */
  private headers(): Record<string, string> {
    return {
      'x-api-key': this.apiKeyHeader,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Translates an Axios rejection into a descriptive Error. Blockradar returns
   * error bodies with a `message` field on non-2xx responses.
   */
  private wrapError(operation: string, err: unknown): Error {
    const axiosErr = err as AxiosError<BlockradarErrorBody>;
    const body = axiosErr?.response?.data;
    if (body?.message) {
      const status = axiosErr.response?.status ?? 'unknown';
      return new Error(
        `Blockradar ${operation} error (HTTP ${status}): ${body.message}`,
      );
    }
    // Non-Blockradar error (network timeout, etc.) — re-throw as-is.
    return err instanceof Error ? err : new Error(String(err));
  }
}
