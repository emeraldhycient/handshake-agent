/**
 * Unit tests for BlockradarSwapProvider.
 *
 * HttpService is mocked — no real network calls.
 * ConfigService is stubbed to return fixed env values.
 * AssetRegistry is stubbed to return a TRON master wallet id.
 *
 * Verifies:
 *   - getQuote: URL, x-api-key header, request body, response mapping
 *   - execute: URL, x-api-key header, request body, response mapping
 *   - error wrapping on non-2xx responses
 */

import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import type { AxiosError, AxiosResponse } from 'axios';

import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import { BlockradarSwapProvider } from './blockradar-swap.provider';
import { SwapUnavailableError } from '../../transactions/domain/execution-errors';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_URL = 'https://api.blockradar.co/v1';
const API_KEY = 'test-swap-api-key';
const MASTER_WALLET_ID = 'master-wallet-uuid-tron';
const ADDRESS_ID = 'child-address-id-1';
const FROM_ASSET_ID = 'usdt-asset-uuid-001';
const TO_ASSET_ID = 'trx-asset-uuid-002';

function makeConfig(): ConfigService {
  return {
    get: (key: string) => {
      const values: Record<string, unknown> = {
        BLOCKRADAR_BASE_URL: BASE_URL,
        BLOCKRADAR_API_KEY: API_KEY,
      };
      return values[key];
    },
  } as unknown as ConfigService;
}

function makeAssetRegistry(): jest.Mocked<AssetRegistry> {
  return {
    networkMasterWalletId: jest.fn().mockImplementation((network: string) => {
      if (network === 'TRON') return MASTER_WALLET_ID;
      throw new Error(`No master wallet id for network "${network}"`);
    }),
  } as unknown as jest.Mocked<AssetRegistry>;
}

function axiosOk<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: {} as never },
  };
}

function axiosErr(status: number, message: string): AxiosError {
  const err = new Error(message) as AxiosError;
  err.response = {
    data: { message, statusCode: status },
    status,
    statusText: 'Error',
    headers: {},
    config: { headers: {} as never },
  } as AxiosResponse;
  return err;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BlockradarSwapProvider', () => {
  let http: jest.Mocked<HttpService>;
  let provider: BlockradarSwapProvider;
  let assetRegistry: jest.Mocked<AssetRegistry>;

  beforeEach(() => {
    http = {
      post: jest.fn(),
      get: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;
    assetRegistry = makeAssetRegistry();
    provider = new BlockradarSwapProvider(http, makeConfig(), assetRegistry);
  });

  // ── getQuote ────────────────────────────────────────────────────────────────

  describe('getQuote', () => {
    const QUOTE_RESPONSE = {
      data: {
        amount: '950.123456',
        rate: '9.50123456',
        minAmount: '10',
        slippage: '0.5', // 0.5% = 50 bps
        networkFee: '1',
        transactionFee: 0.5,
        estimatedArrivalTime: 120,
      },
      message: 'Quote fetched',
      statusCode: 200,
    };

    it('resolves the TRON master wallet id from AssetRegistry', async () => {
      http.post.mockReturnValue(of(axiosOk(QUOTE_RESPONSE)));

      await provider.getQuote({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
      });

      expect(assetRegistry.networkMasterWalletId).toHaveBeenCalledWith('TRON');
    });

    it('POSTs to /wallets/{masterWalletId}/addresses/{addressId}/swaps/quote with x-api-key', async () => {
      http.post.mockReturnValue(of(axiosOk(QUOTE_RESPONSE)));

      await provider.getQuote({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
      });

      const [url, , config] = http.post.mock.calls[0] as [
        string,
        Record<string, string>,
        { headers: Record<string, string> },
      ];
      expect(url).toBe(
        `${BASE_URL}/wallets/${MASTER_WALLET_ID}/addresses/${ADDRESS_ID}/swaps/quote`,
      );
      expect(config.headers['x-api-key']).toBe(API_KEY);
    });

    it('sends fromAssetId, toAssetId, and amount in the request body', async () => {
      http.post.mockReturnValue(of(axiosOk(QUOTE_RESPONSE)));

      await provider.getQuote({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
      });

      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        { fromAssetId: FROM_ASSET_ID, toAssetId: TO_ASSET_ID, amount: '100' },
        expect.any(Object),
      );
    });

    it('includes order in the request body when provided', async () => {
      http.post.mockReturnValue(of(axiosOk(QUOTE_RESPONSE)));

      await provider.getQuote({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
        order: 'FASTEST',
      });

      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ order: 'FASTEST' }),
        expect.any(Object),
      );
    });

    it('omits order from the body when not provided', async () => {
      http.post.mockReturnValue(of(axiosOk(QUOTE_RESPONSE)));

      await provider.getQuote({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
      });

      const [, body] = http.post.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(body).not.toHaveProperty('order');
    });

    it('maps response data.amount → toAmount', async () => {
      http.post.mockReturnValue(of(axiosOk(QUOTE_RESPONSE)));

      const result = await provider.getQuote({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
      });

      expect(result.toAmount).toBe('950.123456');
    });

    it('maps response data.rate → rate', async () => {
      http.post.mockReturnValue(of(axiosOk(QUOTE_RESPONSE)));

      const result = await provider.getQuote({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
      });

      expect(result.rate).toBe('9.50123456');
    });

    it('maps response data.slippage % string → integer bps (0.5% = 50 bps)', async () => {
      http.post.mockReturnValue(of(axiosOk(QUOTE_RESPONSE)));

      const result = await provider.getQuote({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
      });

      expect(result.slippage).toBe(50);
    });

    it('maps response data.networkFee → networkFee', async () => {
      http.post.mockReturnValue(of(axiosOk(QUOTE_RESPONSE)));

      const result = await provider.getQuote({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
      });

      expect(result.networkFee).toBe('1');
    });

    it('maps data.transactionFee (number) → transactionFee string', async () => {
      http.post.mockReturnValue(of(axiosOk(QUOTE_RESPONSE)));

      const result = await provider.getQuote({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
      });

      expect(result.transactionFee).toBe('0.5');
    });

    it('maps data.estimatedArrivalTime → estimatedArrivalSec', async () => {
      http.post.mockReturnValue(of(axiosOk(QUOTE_RESPONSE)));

      const result = await provider.getQuote({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
      });

      expect(result.estimatedArrivalSec).toBe(120);
    });

    it('wraps a Blockradar error response into a descriptive Error', async () => {
      http.post.mockReturnValue(
        throwError(() => axiosErr(422, 'Insufficient balance')),
      );

      await expect(
        provider.getQuote({
          addressId: ADDRESS_ID,
          fromAssetId: FROM_ASSET_ID,
          toAssetId: TO_ASSET_ID,
          amount: '100',
        }),
      ).rejects.toThrow(
        'Blockradar swap getQuote error (HTTP 422): Insufficient balance',
      );
    });

    it('throws SwapUnavailableError on HTTP 404 (wallet not found or swap not active)', async () => {
      http.post.mockReturnValue(
        throwError(() => axiosErr(404, 'Wallet not found or not active')),
      );

      const rejection = provider.getQuote({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
      });

      await expect(rejection).rejects.toBeInstanceOf(SwapUnavailableError);
      await expect(rejection).rejects.toThrow('Wallet not found or not active');
    });

    it('throws SwapUnavailableError on HTTP 400 (no swap quotes available — no route/liquidity)', async () => {
      // Blockradar returns 400 "No swap quotes available" when no quote can be
      // produced for the pair+amount (e.g. testnet, unsupported pair). No funds
      // move at quote time → degrade gracefully, not an opaque 500.
      http.post.mockReturnValue(
        throwError(() => axiosErr(400, 'No swap quotes available')),
      );

      const rejection = provider.getQuote({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
      });

      await expect(rejection).rejects.toBeInstanceOf(SwapUnavailableError);
      await expect(rejection).rejects.toThrow('No swap quotes available');
    });

    it('builds URL using masterWalletId and addressId (Blockradar UUIDs, not on-chain addresses)', async () => {
      http.post.mockReturnValue(of(axiosOk(QUOTE_RESPONSE)));

      const blockradarAddressUuid = 'br-addr-uuid-1234';
      await provider.getQuote({
        addressId: blockradarAddressUuid,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
      });

      const [url] = http.post.mock.calls[0] as [string, ...unknown[]];
      expect(url).toBe(
        `${BASE_URL}/wallets/${MASTER_WALLET_ID}/addresses/${blockradarAddressUuid}/swaps/quote`,
      );
    });
  });

  // ── execute ─────────────────────────────────────────────────────────────────

  describe('execute', () => {
    const EXECUTE_RESPONSE = {
      data: {
        id: 'swap-provider-id-abc123',
        status: 'PENDING',
      },
      message: 'Swap initiated',
      statusCode: 200,
    };

    it('POSTs to /wallets/{masterWalletId}/addresses/{addressId}/swaps/execute with x-api-key', async () => {
      http.post.mockReturnValue(of(axiosOk(EXECUTE_RESPONSE)));

      await provider.execute({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
        reference: 'idempotency-key-xyz',
      });

      const [url, , config] = http.post.mock.calls[0] as [
        string,
        Record<string, string>,
        { headers: Record<string, string> },
      ];
      expect(url).toBe(
        `${BASE_URL}/wallets/${MASTER_WALLET_ID}/addresses/${ADDRESS_ID}/swaps/execute`,
      );
      expect(config.headers['x-api-key']).toBe(API_KEY);
    });

    it('sends fromAssetId, toAssetId, amount, and reference in the body', async () => {
      http.post.mockReturnValue(of(axiosOk(EXECUTE_RESPONSE)));

      await provider.execute({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
        reference: 'idempotency-key-xyz',
      });

      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        {
          fromAssetId: FROM_ASSET_ID,
          toAssetId: TO_ASSET_ID,
          amount: '100',
          reference: 'idempotency-key-xyz',
        },
        expect.any(Object),
      );
    });

    it('maps data.id → providerSwapId', async () => {
      http.post.mockReturnValue(of(axiosOk(EXECUTE_RESPONSE)));

      const result = await provider.execute({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
        reference: 'ref-001',
      });

      expect(result.providerSwapId).toBe('swap-provider-id-abc123');
    });

    it('maps PENDING → pending status', async () => {
      http.post.mockReturnValue(of(axiosOk(EXECUTE_RESPONSE)));

      const result = await provider.execute({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
        reference: 'ref-001',
      });

      expect(result.status).toBe('pending');
    });

    it('maps SUCCESS → success status', async () => {
      http.post.mockReturnValue(
        of(
          axiosOk({
            ...EXECUTE_RESPONSE,
            data: { ...EXECUTE_RESPONSE.data, status: 'SUCCESS' },
          }),
        ),
      );

      const result = await provider.execute({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
        reference: 'ref-001',
      });

      expect(result.status).toBe('success');
    });

    it('maps FAILED → failed status', async () => {
      http.post.mockReturnValue(
        of(
          axiosOk({
            ...EXECUTE_RESPONSE,
            data: { ...EXECUTE_RESPONSE.data, status: 'FAILED' },
          }),
        ),
      );

      const result = await provider.execute({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
        reference: 'ref-001',
      });

      expect(result.status).toBe('failed');
    });

    it('includes hash when present in the response', async () => {
      http.post.mockReturnValue(
        of(
          axiosOk({
            ...EXECUTE_RESPONSE,
            data: { ...EXECUTE_RESPONSE.data, hash: 'txhash-abc123' },
          }),
        ),
      );

      const result = await provider.execute({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
        reference: 'ref-001',
      });

      expect(result.hash).toBe('txhash-abc123');
    });

    it('omits hash when absent in the response', async () => {
      http.post.mockReturnValue(of(axiosOk(EXECUTE_RESPONSE)));

      const result = await provider.execute({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
        reference: 'ref-001',
      });

      expect(result.hash).toBeUndefined();
    });

    it('wraps a Blockradar error response into a descriptive Error', async () => {
      http.post.mockReturnValue(
        throwError(() => axiosErr(400, 'Invalid asset pair')),
      );

      await expect(
        provider.execute({
          addressId: ADDRESS_ID,
          fromAssetId: FROM_ASSET_ID,
          toAssetId: TO_ASSET_ID,
          amount: '100',
          reference: 'ref-001',
        }),
      ).rejects.toThrow(
        'Blockradar swap execute error (HTTP 400): Invalid asset pair',
      );
    });

    it('throws SwapUnavailableError on HTTP 404 during execute', async () => {
      http.post.mockReturnValue(
        throwError(() => axiosErr(404, 'Wallet not found or not active')),
      );

      const rejection = provider.execute({
        addressId: ADDRESS_ID,
        fromAssetId: FROM_ASSET_ID,
        toAssetId: TO_ASSET_ID,
        amount: '100',
        reference: 'ref-001',
      });

      await expect(rejection).rejects.toBeInstanceOf(SwapUnavailableError);
    });
  });
});
