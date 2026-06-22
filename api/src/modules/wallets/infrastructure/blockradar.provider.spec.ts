/**
 * Unit tests for BlockradarProvider (task 5.1).
 *
 * HttpService is mocked — no real network calls.
 * ConfigService is stubbed to return fixed env/config values.
 *
 * TDD: written before the implementation to drive the design.
 */

import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import type { AxiosResponse } from 'axios';

import { BlockradarProvider } from './blockradar.provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'https://api.blockradar.co/v1';
const API_KEY = 'test-api-key';
const MASTER_WALLET_ID = 'master-wallet-uuid';
const USDT_TRON_ASSET_ID = 'f56d297c-a3db-4cda-95bd-180b54679070';

function makeConfig(): ConfigService {
  const values: Record<string, unknown> = {
    BLOCKRADAR_BASE_URL: BASE_URL,
    BLOCKRADAR_API_KEY: API_KEY,
    BLOCKRADAR_MASTER_WALLET_ID: MASTER_WALLET_ID,
    // ConfigService dot-path access for the JSON-defaults layer (§7).
    'providers.blockradar': {
      usdtTronAssetId: USDT_TRON_ASSET_ID,
      network: 'TRON',
    },
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BlockradarProvider', () => {
  let http: jest.Mocked<HttpService>;
  let provider: BlockradarProvider;

  beforeEach(() => {
    http = {
      post: jest.fn(),
      get: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;
    provider = new BlockradarProvider(http, makeConfig());
  });

  // ── provisionAddress ─────────────────────────────────────────────────────

  describe('provisionAddress', () => {
    const SUCCESS_BODY = {
      data: {
        id: 'child-address-id-1',
        address: 'TRX_ADDRESS_XYZ',
        blockchain: { name: 'TRON' },
      },
    };

    it('POSTs to /wallets/{masterWalletId}/addresses with x-api-key header', async () => {
      http.post.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      await provider.provisionAddress({ userRef: 'user-uuid-1' });

      expect(http.post).toHaveBeenCalledTimes(1);
      const [url, , config] = http.post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];

      expect(url).toBe(`${BASE_URL}/wallets/${MASTER_WALLET_ID}/addresses`);
      expect(config.headers['x-api-key']).toBe(API_KEY);
    });

    it('sends metadata with the userRef in the request body', async () => {
      http.post.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      await provider.provisionAddress({ userRef: 'user-uuid-1' });

      const [, body] = http.post.mock.calls[0] as [
        string,
        { metadata: { userRef: string } },
      ];
      expect(body.metadata.userRef).toBe('user-uuid-1');
    });

    it('maps data.id → providerReference, data.address → address, data.blockchain.name → network', async () => {
      http.post.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      const result = await provider.provisionAddress({
        userRef: 'user-uuid-1',
      });

      expect(result.providerReference).toBe('child-address-id-1');
      expect(result.address).toBe('TRX_ADDRESS_XYZ');
      expect(result.network).toBe('TRON');
    });

    it('throws a descriptive error on non-2xx response', async () => {
      const axiosErr = Object.assign(new Error('Bad Request'), {
        response: {
          status: 400,
          data: { message: 'Wallet not found', statusCode: 400 },
        },
        isAxiosError: true,
      });
      http.post.mockReturnValue(throwError(() => axiosErr));

      await expect(
        provider.provisionAddress({ userRef: 'user-uuid-1' }),
      ).rejects.toThrow(/Blockradar provisionAddress error/);
    });

    it('error message includes status code and provider message', async () => {
      const axiosErr = Object.assign(new Error('Unauthorized'), {
        response: {
          status: 401,
          data: { message: 'Invalid API key', statusCode: 401 },
        },
        isAxiosError: true,
      });
      http.post.mockReturnValue(throwError(() => axiosErr));

      await expect(
        provider.provisionAddress({ userRef: 'user-uuid-1' }),
      ).rejects.toThrow(/Invalid API key/);
    });

    it('re-throws non-Blockradar errors as-is', async () => {
      http.post.mockReturnValue(throwError(() => new Error('Network timeout')));

      await expect(
        provider.provisionAddress({ userRef: 'user-uuid-1' }),
      ).rejects.toThrow('Network timeout');
    });
  });

  // ── getBalance ───────────────────────────────────────────────────────────

  describe('getBalance', () => {
    const SUCCESS_BODY = {
      data: {
        balance: '10.500000',
        asset: {
          asset: { decimals: 6 },
        },
      },
    };

    it('GETs /wallets/{masterWalletId}/addresses/{addressId}/balance with assetId query', async () => {
      http.get.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      await provider.getBalance('child-address-id-1');

      expect(http.get).toHaveBeenCalledTimes(1);
      const [url, config] = http.get.mock.calls[0] as [
        string,
        { headers: Record<string, string>; params: Record<string, string> },
      ];

      expect(url).toBe(
        `${BASE_URL}/wallets/${MASTER_WALLET_ID}/addresses/child-address-id-1/balance`,
      );
      expect(config.params.assetId).toBe(USDT_TRON_ASSET_ID);
      expect(config.headers['x-api-key']).toBe(API_KEY);
    });

    it('maps data.balance → amount and data.asset.asset.decimals → decimals', async () => {
      http.get.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      const result = await provider.getBalance('child-address-id-1');

      expect(result.amount).toBe('10.500000');
      expect(result.decimals).toBe(6);
    });

    it('throws a descriptive error on non-2xx response', async () => {
      const axiosErr = Object.assign(new Error('Not Found'), {
        response: {
          status: 404,
          data: { message: 'Address not found', statusCode: 404 },
        },
        isAxiosError: true,
      });
      http.get.mockReturnValue(throwError(() => axiosErr));

      await expect(provider.getBalance('bad-id')).rejects.toThrow(
        /Blockradar getBalance error/,
      );
    });

    it('re-throws network errors without wrapping', async () => {
      http.get.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

      await expect(provider.getBalance('child-address-id-1')).rejects.toThrow(
        'ECONNREFUSED',
      );
    });
  });
});
