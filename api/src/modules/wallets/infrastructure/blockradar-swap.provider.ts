import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import type {
  ISwapProvider,
  GetSwapQuoteInput,
  GetSwapQuoteOutput,
  ExecuteSwapInput,
  ExecuteSwapOutput,
} from '../application/ports/swap-provider.port';

// ---------------------------------------------------------------------------
// Blockradar response shapes (confirmed docs.blockradar.co)
// ---------------------------------------------------------------------------

interface BlockradarErrorBody {
  message: string;
  statusCode?: number;
}

/**
 * Blockradar GET /wallets/{walletId}/addresses/{addressId}/swaps/quote
 * Relevant data fields from docs.blockradar.co/api-reference/swap/child-address-get-quote
 */
interface BlockradarSwapQuoteData {
  /** Estimated amount of toAsset to receive (decimal string). */
  amount: string;
  /** Exchange rate: 1 fromAsset = rate toAsset. */
  rate: string;
  /** Minimum received with slippage (decimal string). */
  minAmount: string;
  /** Slippage percentage string (e.g. "0.5"). Converted to bps by the adapter. */
  slippage: string;
  /** On-chain network / gas fee (decimal string). */
  networkFee: string;
  /** Platform transaction fee. Docs return a number; we normalise to string. */
  transactionFee: number | string;
  /** Estimated time for swap to complete, in seconds. */
  estimatedArrivalTime: number;
}

interface BlockradarSwapQuoteResponse {
  data: BlockradarSwapQuoteData;
  message?: string;
  statusCode?: number;
}

/**
 * Blockradar POST /wallets/{walletId}/addresses/{addressId}/swaps/execute
 * Relevant data fields from docs.blockradar.co/api-reference/swap/child-address-execute
 */
interface BlockradarSwapExecuteData {
  /** Provider-assigned swap id. */
  id: string;
  /**
   * Lifecycle status. Known values: 'PENDING' | 'SUCCESS' | 'FAILED'.
   * Typed as string so new statuses do not cause a compile error.
   */
  status: string;
  /** On-chain tx hash — absent while the swap is still pending. */
  hash?: string;
}

interface BlockradarSwapExecuteResponse {
  data: BlockradarSwapExecuteData;
  message?: string;
  statusCode?: number;
}

/**
 * BlockradarSwapProvider — implements `ISwapProvider` for crypto-to-crypto swaps.
 *
 * Endpoints (confirmed against docs.blockradar.co):
 *   POST /v1/wallets/{walletId}/addresses/{addressId}/swaps/quote
 *   POST /v1/wallets/{walletId}/addresses/{addressId}/swaps/execute
 *
 * Auth: `x-api-key` header (same key as BlockradarProvider for wallet ops).
 * The master wallet id is resolved per-network from AssetRegistry (same as
 * BlockradarProvider — WN-1 pattern).
 *
 * Invariant (root CLAUDE.md §3.1): `execute` is NON-BLOCKING. Blockradar
 * returns PENDING immediately; the final status arrives via webhook. The
 * engine updates settlement on webhook receipt.
 */
@Injectable()
export class BlockradarSwapProvider implements ISwapProvider {
  private readonly baseUrl: string;
  private readonly apiKeyHeader: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly assetRegistry: AssetRegistry,
  ) {
    this.baseUrl =
      this.config.get<string>('BLOCKRADAR_BASE_URL') ??
      'https://api.blockradar.co/v1';
    this.apiKeyHeader = this.config.get<string>('BLOCKRADAR_API_KEY') ?? '';
  }

  // ---------------------------------------------------------------------------
  // ISwapProvider
  // ---------------------------------------------------------------------------

  /**
   * Fetches a real-time swap quote from Blockradar.
   *
   * POST /v1/wallets/{walletId}/addresses/{addressId}/swaps/quote
   *
   * Response mapping:
   *   toAmount         ← data.amount
   *   rate             ← data.rate
   *   minAmount        ← data.minAmount
   *   slippage         ← parseFloat(data.slippage) * 100  (% → bps, rounded)
   *   networkFee       ← data.networkFee
   *   transactionFee   ← String(data.transactionFee)
   *   estimatedArrivalSec ← data.estimatedArrivalTime
   */
  async getQuote(input: GetSwapQuoteInput): Promise<GetSwapQuoteOutput> {
    const { addressId, fromAssetId, toAssetId, amount, order } = input;
    // Use TRON as the default network for swap; when multi-network swaps land
    // the addressId lookup will carry the network. For now we have one network.
    const masterWalletId = this.resolveMasterWalletId('TRON');
    const url = `${this.baseUrl}/wallets/${masterWalletId}/addresses/${addressId}/swaps/quote`;

    const body: Record<string, string> = { fromAssetId, toAssetId, amount };
    if (order !== undefined) {
      body['order'] = order;
    }

    try {
      const response = await firstValueFrom(
        this.http.post<BlockradarSwapQuoteResponse>(url, body, {
          headers: this.headers(),
        }),
      );

      const d = response.data.data;
      // Blockradar returns slippage as a percentage string (e.g. "0.5"); convert
      // to integer basis points (0.5% → 50 bps). Round to avoid fractional bps.
      const slippagePct = parseFloat(d.slippage ?? '0');
      const slippageBps = Math.round(slippagePct * 100);

      return {
        toAmount: d.amount,
        rate: d.rate,
        minAmount: d.minAmount,
        slippage: slippageBps,
        networkFee: d.networkFee,
        transactionFee: String(d.transactionFee),
        estimatedArrivalSec: d.estimatedArrivalTime,
      };
    } catch (err: unknown) {
      throw this.wrapError('getQuote', err);
    }
  }

  /**
   * Initiates a crypto-to-crypto swap.
   *
   * POST /v1/wallets/{walletId}/addresses/{addressId}/swaps/execute
   *
   * Response mapping:
   *   providerSwapId ← data.id
   *   status         ← mapStatus(data.status)   ('PENDING' → 'pending')
   *   hash           ← data.hash                (absent while pending)
   */
  async execute(input: ExecuteSwapInput): Promise<ExecuteSwapOutput> {
    const { addressId, fromAssetId, toAssetId, amount, reference, order } =
      input;
    const masterWalletId = this.resolveMasterWalletId('TRON');
    const url = `${this.baseUrl}/wallets/${masterWalletId}/addresses/${addressId}/swaps/execute`;

    const body: Record<string, string> = {
      fromAssetId,
      toAssetId,
      amount,
      reference,
    };
    if (order !== undefined) {
      body['order'] = order;
    }

    try {
      const response = await firstValueFrom(
        this.http.post<BlockradarSwapExecuteResponse>(url, body, {
          headers: this.headers(),
        }),
      );

      const d = response.data.data;
      return {
        providerSwapId: d.id,
        status: this.mapStatus(d.status),
        ...(d.hash !== undefined ? { hash: d.hash } : {}),
      };
    } catch (err: unknown) {
      throw this.wrapError('execute', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolves the Blockradar master wallet id for the given network via
   * AssetRegistry (WN-1 pattern — same as BlockradarProvider).
   */
  private resolveMasterWalletId(network: string): string {
    return this.assetRegistry.networkMasterWalletId(network);
  }

  /**
   * Maps Blockradar's uppercase status strings to the port's lowercase union.
   * Unknown values default to 'pending' (fail-safe; the engine re-checks on webhook).
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

  /** Common Blockradar auth headers (x-api-key — NOT Bearer). */
  private headers(): Record<string, string> {
    return {
      'x-api-key': this.apiKeyHeader,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Translates an Axios rejection into a descriptive Error.
   * Blockradar returns error bodies with a `message` field on non-2xx responses.
   */
  private wrapError(operation: string, err: unknown): Error {
    const axiosErr = err as AxiosError<BlockradarErrorBody>;
    const body = axiosErr?.response?.data;
    if (body?.message) {
      const status = axiosErr.response?.status ?? 'unknown';
      return new Error(
        `Blockradar swap ${operation} error (HTTP ${status}): ${body.message}`,
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
