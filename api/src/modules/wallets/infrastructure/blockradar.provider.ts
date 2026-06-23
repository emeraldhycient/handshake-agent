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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
