import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';

import type {
  IWalletProvider,
  ProvisionAddressInput,
  ProvisionAddressOutput,
  GetBalanceOutput,
  WithdrawInput,
  WithdrawOutput,
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

/**
 * Blockradar WaaS adapter — implements `IWalletProvider`.
 *
 * All configuration (base URL, API key, master wallet id, asset id) is read
 * from ConfigService so tests can stub it without real network calls. Mirrors
 * the `CloudApiSender` pattern (modules/whatsapp/infrastructure/).
 *
 * Auth: Blockradar uses `x-api-key` header (NOT Bearer).
 */
@Injectable()
export class BlockradarProvider implements IWalletProvider {
  private readonly baseUrl: string;
  private readonly apiKeyHeader: string;
  private readonly masterWalletId: string;

  constructor(
    private readonly http: HttpService,
    // Bare ConfigService so env keys (BLOCKRADAR_*) can be read without
    // type-narrowing issues. The usdtTronAssetId previously read from the
    // providers.blockradar config section has been removed — the catalog
    // (AssetRegistry) is now the single source of truth (task X3).
    private readonly config: ConfigService,
  ) {
    this.baseUrl =
      this.config.get<string>('BLOCKRADAR_BASE_URL') ??
      'https://api.blockradar.co/v1';
    this.apiKeyHeader = this.config.get<string>('BLOCKRADAR_API_KEY') ?? '';
    this.masterWalletId =
      this.config.get<string>('BLOCKRADAR_MASTER_WALLET_ID') ?? '';
  }

  // ---------------------------------------------------------------------------
  // IWalletProvider
  // ---------------------------------------------------------------------------

  async provisionAddress(
    input: ProvisionAddressInput,
  ): Promise<ProvisionAddressOutput> {
    const url = `${this.baseUrl}/wallets/${this.masterWalletId}/addresses`;
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
  ): Promise<GetBalanceOutput> {
    const url = `${this.baseUrl}/wallets/${this.masterWalletId}/addresses/${addressId}/balance`;
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
   * The call returns immediately with PENDING status; Blockradar delivers
   * the final status (SUCCESS | FAILED) via webhook. The execution engine
   * updates the settlement record on webhook receipt (§3.1).
   */
  async withdraw(input: WithdrawInput): Promise<WithdrawOutput> {
    const { addressId, toAddress, amount, assetId, reference } = input;
    const url = `${this.baseUrl}/wallets/${this.masterWalletId}/addresses/${addressId}/withdraw`;

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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
