/**
 * Unit tests for BlockradarProvider (WN-1: per-network master wallet id).
 *
 * HttpService is mocked — no real network calls.
 * ConfigService is stubbed to return fixed env/config values.
 * AssetRegistry is stubbed to return per-network masterWalletId.
 *
 * Key changes (WN-1):
 * - provisionAddress now takes { userRef, network } and resolves the master
 *   wallet id per-network from AssetRegistry.
 * - getBalance now takes (addressId, assetId, network) — same per-network URL.
 * - withdraw and getWithdrawalStatus now use per-network master wallet URL.
 * - All URLs tested with MASTER_WALLET_ID resolved from the stub registry.
 *
 * TDD: written before the implementation to drive the design.
 */

import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import type { AxiosResponse } from 'axios';

import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import { BlockradarProvider } from './blockradar.provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'https://api.blockradar.co/v1';
const API_KEY = 'test-api-key';
const MASTER_WALLET_ID = 'master-wallet-uuid';
/** The assetId the caller (WalletService via AssetRegistry) passes in. */
const USDT_TRON_ASSET_ID = 'f56d297c-a3db-4cda-95bd-180b54679070';

function makeConfig(): ConfigService {
  const values: Record<string, unknown> = {
    BLOCKRADAR_BASE_URL: BASE_URL,
    BLOCKRADAR_API_KEY: API_KEY,
    // Note: BLOCKRADAR_MASTER_WALLET_ID is NO LONGER read directly by the provider
    // — the provider resolves the master wallet id per-network from AssetRegistry.
    // This env var is still read by configuration.ts to populate the catalog,
    // but BlockradarProvider only reads BLOCKRADAR_BASE_URL and BLOCKRADAR_API_KEY.
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

/**
 * Minimal AssetRegistry stub that returns MASTER_WALLET_ID for TRON.
 * Throws for unknown networks to test fail-safe / error paths.
 */
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BlockradarProvider', () => {
  let http: jest.Mocked<HttpService>;
  let provider: BlockradarProvider;
  let assetRegistry: jest.Mocked<AssetRegistry>;

  beforeEach(() => {
    http = {
      post: jest.fn(),
      get: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;
    assetRegistry = makeAssetRegistry();
    provider = new BlockradarProvider(http, makeConfig(), assetRegistry);
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

    it('resolves master wallet id from AssetRegistry for the given network', async () => {
      http.post.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      await provider.provisionAddress({
        userRef: 'user-uuid-1',
        network: 'TRON',
      });

      expect(assetRegistry.networkMasterWalletId).toHaveBeenCalledWith('TRON');
    });

    it('POSTs to /wallets/{masterWalletId}/addresses with x-api-key header', async () => {
      http.post.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      await provider.provisionAddress({
        userRef: 'user-uuid-1',
        network: 'TRON',
      });

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

      await provider.provisionAddress({
        userRef: 'user-uuid-1',
        network: 'TRON',
      });

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
        network: 'TRON',
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
        provider.provisionAddress({ userRef: 'user-uuid-1', network: 'TRON' }),
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
        provider.provisionAddress({ userRef: 'user-uuid-1', network: 'TRON' }),
      ).rejects.toThrow(/Invalid API key/);
    });

    it('re-throws non-Blockradar errors as-is', async () => {
      http.post.mockReturnValue(throwError(() => new Error('Network timeout')));

      await expect(
        provider.provisionAddress({ userRef: 'user-uuid-1', network: 'TRON' }),
      ).rejects.toThrow('Network timeout');
    });

    it('throws when network has no configured master wallet id', async () => {
      assetRegistry.networkMasterWalletId.mockImplementation((n: string) => {
        throw new Error(`No master wallet id for network "${n}"`);
      });

      await expect(
        provider.provisionAddress({ userRef: 'user-uuid-1', network: 'ETH' }),
      ).rejects.toThrow(/No master wallet id/);
      expect(http.post).not.toHaveBeenCalled();
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

    it('resolves master wallet id from AssetRegistry for the given network', async () => {
      http.get.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      await provider.getBalance(
        'child-address-id-1',
        USDT_TRON_ASSET_ID,
        'TRON',
      );

      expect(assetRegistry.networkMasterWalletId).toHaveBeenCalledWith('TRON');
    });

    it('GETs /wallets/{masterWalletId}/addresses/{addressId}/balance with the passed assetId as query param', async () => {
      http.get.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      await provider.getBalance(
        'child-address-id-1',
        USDT_TRON_ASSET_ID,
        'TRON',
      );

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

    it('passes a different assetId correctly (provider is asset-agnostic)', async () => {
      http.get.mockReturnValue(of(axiosOk(SUCCESS_BODY)));
      const OTHER_ASSET_ID = 'other-asset-uuid-9999';

      await provider.getBalance('child-address-id-1', OTHER_ASSET_ID, 'TRON');

      const [, config] = http.get.mock.calls[0] as [
        string,
        { params: Record<string, string> },
      ];
      expect(config.params.assetId).toBe(OTHER_ASSET_ID);
    });

    it('maps data.balance → amount and data.asset.asset.decimals → decimals', async () => {
      http.get.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      const result = await provider.getBalance(
        'child-address-id-1',
        USDT_TRON_ASSET_ID,
        'TRON',
      );

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

      await expect(
        provider.getBalance('bad-id', USDT_TRON_ASSET_ID, 'TRON'),
      ).rejects.toThrow(/Blockradar getBalance error/);
    });

    it('re-throws network errors without wrapping', async () => {
      http.get.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

      await expect(
        provider.getBalance('child-address-id-1', USDT_TRON_ASSET_ID, 'TRON'),
      ).rejects.toThrow('ECONNREFUSED');
    });
  });

  // ── withdraw ─────────────────────────────────────────────────────────────
  //
  // Confirmed endpoint (docs.blockradar.co):
  //   POST /wallets/{masterWalletId}/addresses/{addressId}/withdraw
  //   body: { address, amount, assetId, reference? }
  //   response: { data: { id, status (SUCCESS|PENDING|FAILED), reference, ... } }

  describe('withdraw', () => {
    const ADDRESS_ID = 'child-address-id-1';
    const TO_ADDRESS = 'TRXDestinationAddress12345678901234';
    const AMOUNT = '10.5';
    const REFERENCE = 'idempotency-key-uuid-1234';

    const SUCCESS_BODY = {
      statusCode: 200,
      message: 'Withdrawal initiated',
      data: {
        id: 'provider-tx-id-abc',
        status: 'PENDING',
        reference: REFERENCE,
        senderAddress: 'TSenderAddress1234567890123456789',
        recipientAddress: TO_ADDRESS,
      },
    };

    it('resolves master wallet id from AssetRegistry for the given network', async () => {
      http.post.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      await provider.withdraw({
        addressId: ADDRESS_ID,
        toAddress: TO_ADDRESS,
        amount: AMOUNT,
        assetId: USDT_TRON_ASSET_ID,
        network: 'TRON',
      });

      expect(assetRegistry.networkMasterWalletId).toHaveBeenCalledWith('TRON');
    });

    it('POSTs to /wallets/{masterWalletId}/addresses/{addressId}/withdraw with x-api-key', async () => {
      http.post.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      await provider.withdraw({
        addressId: ADDRESS_ID,
        toAddress: TO_ADDRESS,
        amount: AMOUNT,
        assetId: USDT_TRON_ASSET_ID,
        network: 'TRON',
      });

      expect(http.post).toHaveBeenCalledTimes(1);
      const [url, , config] = http.post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];

      expect(url).toBe(
        `${BASE_URL}/wallets/${MASTER_WALLET_ID}/addresses/${ADDRESS_ID}/withdraw`,
      );
      expect(config.headers['x-api-key']).toBe(API_KEY);
    });

    it('sends address, amount, assetId in the request body', async () => {
      http.post.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      await provider.withdraw({
        addressId: ADDRESS_ID,
        toAddress: TO_ADDRESS,
        amount: AMOUNT,
        assetId: USDT_TRON_ASSET_ID,
        network: 'TRON',
      });

      const [, body] = http.post.mock.calls[0] as [
        string,
        {
          address: string;
          amount: string;
          assetId: string;
          reference?: string;
        },
      ];
      expect(body.address).toBe(TO_ADDRESS);
      expect(body.amount).toBe(AMOUNT);
      expect(body.assetId).toBe(USDT_TRON_ASSET_ID);
      expect(body.reference).toBeUndefined();
    });

    it('sends reference in the request body when provided', async () => {
      http.post.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      await provider.withdraw({
        addressId: ADDRESS_ID,
        toAddress: TO_ADDRESS,
        amount: AMOUNT,
        assetId: USDT_TRON_ASSET_ID,
        network: 'TRON',
        reference: REFERENCE,
      });

      const [, body] = http.post.mock.calls[0] as [
        string,
        { reference?: string },
      ];
      expect(body.reference).toBe(REFERENCE);
    });

    it('maps data.id → providerReference, data.status (PENDING → pending)', async () => {
      http.post.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      const result = await provider.withdraw({
        addressId: ADDRESS_ID,
        toAddress: TO_ADDRESS,
        amount: AMOUNT,
        assetId: USDT_TRON_ASSET_ID,
        network: 'TRON',
      });

      expect(result.providerReference).toBe('provider-tx-id-abc');
      expect(result.status).toBe('pending');
    });

    it('maps SUCCESS status → "success"', async () => {
      const successBody = {
        ...SUCCESS_BODY,
        data: { ...SUCCESS_BODY.data, status: 'SUCCESS' },
      };
      http.post.mockReturnValue(of(axiosOk(successBody)));

      const result = await provider.withdraw({
        addressId: ADDRESS_ID,
        toAddress: TO_ADDRESS,
        amount: AMOUNT,
        assetId: USDT_TRON_ASSET_ID,
        network: 'TRON',
      });

      expect(result.status).toBe('success');
    });

    it('maps FAILED status → "failed"', async () => {
      const failedBody = {
        ...SUCCESS_BODY,
        data: { ...SUCCESS_BODY.data, status: 'FAILED' },
      };
      http.post.mockReturnValue(of(axiosOk(failedBody)));

      const result = await provider.withdraw({
        addressId: ADDRESS_ID,
        toAddress: TO_ADDRESS,
        amount: AMOUNT,
        assetId: USDT_TRON_ASSET_ID,
        network: 'TRON',
      });

      expect(result.status).toBe('failed');
    });

    it('throws a descriptive error on non-2xx response', async () => {
      const axiosErr = Object.assign(new Error('Unprocessable'), {
        response: {
          status: 422,
          data: { message: 'Insufficient balance', statusCode: 422 },
        },
        isAxiosError: true,
      });
      http.post.mockReturnValue(throwError(() => axiosErr));

      await expect(
        provider.withdraw({
          addressId: ADDRESS_ID,
          toAddress: TO_ADDRESS,
          amount: AMOUNT,
          assetId: USDT_TRON_ASSET_ID,
          network: 'TRON',
        }),
      ).rejects.toThrow(/Blockradar withdraw error/);
    });

    it('error message includes HTTP status and provider message', async () => {
      const axiosErr = Object.assign(new Error('Unauthorized'), {
        response: {
          status: 401,
          data: { message: 'Invalid API key', statusCode: 401 },
        },
        isAxiosError: true,
      });
      http.post.mockReturnValue(throwError(() => axiosErr));

      await expect(
        provider.withdraw({
          addressId: ADDRESS_ID,
          toAddress: TO_ADDRESS,
          amount: AMOUNT,
          assetId: USDT_TRON_ASSET_ID,
          network: 'TRON',
        }),
      ).rejects.toThrow(/Invalid API key/);
    });

    it('re-throws non-Blockradar errors as-is', async () => {
      http.post.mockReturnValue(throwError(() => new Error('Network timeout')));

      await expect(
        provider.withdraw({
          addressId: ADDRESS_ID,
          toAddress: TO_ADDRESS,
          amount: AMOUNT,
          assetId: USDT_TRON_ASSET_ID,
          network: 'TRON',
        }),
      ).rejects.toThrow('Network timeout');
    });

    it('preserves the HTTP status STRUCTURALLY on the thrown error (engine refund-vs-leave branching, §3.1)', async () => {
      // The execution engine branches on definitive (4xx) vs ambiguous (5xx /
      // none) provider failures to decide whether a reserve refund is safe. The
      // status must be readable as a structured property — not only embedded in
      // the message string.
      const axiosErr = Object.assign(new Error('Unprocessable'), {
        response: {
          status: 422,
          data: { message: 'Insufficient TRX balance', statusCode: 422 },
        },
        isAxiosError: true,
      });
      http.post.mockReturnValue(throwError(() => axiosErr));

      await expect(
        provider.withdraw({
          addressId: ADDRESS_ID,
          toAddress: TO_ADDRESS,
          amount: AMOUNT,
          assetId: USDT_TRON_ASSET_ID,
          network: 'TRON',
        }),
      ).rejects.toMatchObject({ httpStatus: 422 });
    });

    // The execution engine's refund-vs-leave decision depends on reading the
    // exact HTTP status structurally. Lock in the full matrix: every Blockradar
    // 4xx/5xx withdraw rejection must expose `httpStatus`, and a network error
    // (no HTTP response) must NOT — so the engine treats it as ambiguous and
    // never refunds an in-flight withdrawal (CLAUDE.md §3.1).
    it.each([
      [400, 'Invalid destination address'],
      [404, 'Asset not found'],
      [500, 'Internal server error'],
    ])(
      'preserves httpStatus=%s structurally on a Blockradar %s rejection',
      async (status, message) => {
        const axiosErr = Object.assign(new Error('HTTP error'), {
          response: { status, data: { message, statusCode: status } },
          isAxiosError: true,
        });
        http.post.mockReturnValue(throwError(() => axiosErr));

        await expect(
          provider.withdraw({
            addressId: ADDRESS_ID,
            toAddress: TO_ADDRESS,
            amount: AMOUNT,
            assetId: USDT_TRON_ASSET_ID,
            network: 'TRON',
          }),
        ).rejects.toMatchObject({ httpStatus: status });
      },
    );

    it('does NOT attach httpStatus on a network error (no HTTP response → ambiguous, never refund)', async () => {
      // A bare network failure has no axios `response`, so no status can be
      // derived. The engine must treat this as ambiguous and leave the reserve.
      http.post.mockReturnValue(throwError(() => new Error('ECONNRESET')));

      const rejection = provider
        .withdraw({
          addressId: ADDRESS_ID,
          toAddress: TO_ADDRESS,
          amount: AMOUNT,
          assetId: USDT_TRON_ASSET_ID,
          network: 'TRON',
        })
        .then(
          () => {
            throw new Error('expected withdraw to reject');
          },
          (err: unknown) => err,
        );

      const err = (await rejection) as { httpStatus?: unknown };
      expect(err).toBeInstanceOf(Error);
      expect(err.httpStatus).toBeUndefined();
    });
  });

  // ── listWalletAssets ─────────────────────────────────────────────────────
  //
  // Endpoint: GET /wallets/{masterWalletId}/assets
  // Header: x-api-key
  // Response: { data: [{ id, asset: { id, name, symbol, address, decimals,
  //   network, blockchain: { slug, name } } }] }
  //
  // Mapping:
  //   assetId       ← data[n].id   (wallet-asset id; NOT data[n].asset.id)
  //   symbol        ← data[n].asset.symbol.toUpperCase()
  //   name          ← data[n].asset.name
  //   network       ← data[n].asset.blockchain.slug.toUpperCase()
  //   contractAddress ← data[n].asset.address || null
  //   decimals      ← data[n].asset.decimals
  //   isMainnet     ← data[n].asset.network === 'mainnet'

  describe('listWalletAssets', () => {
    const MASTER_WALLET = 'master-wallet-uuid';

    const SUCCESS_BODY = {
      statusCode: 200,
      message: 'Assets fetched successfully',
      data: [
        {
          id: 'wallet-asset-join-id-1',
          asset: {
            id: 'asset-uuid-usdt-tron',
            name: 'Tether USD',
            symbol: 'USDT',
            address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
            decimals: 6,
            network: 'testnet',
            blockchain: {
              slug: 'tron',
              name: 'TRON',
            },
          },
        },
        {
          id: 'wallet-asset-join-id-2',
          asset: {
            id: 'asset-uuid-trx-native',
            name: 'TRON',
            symbol: 'TRX',
            address: '', // native — empty string
            decimals: 6,
            network: 'testnet',
            blockchain: {
              slug: 'tron',
              name: 'TRON',
            },
          },
        },
      ],
    };

    it('GETs /wallets/{masterWalletId}/assets with x-api-key header', async () => {
      http.get.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      await provider.listWalletAssets(MASTER_WALLET);

      expect(http.get).toHaveBeenCalledTimes(1);
      const [url, config] = http.get.mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      expect(url).toBe(`${BASE_URL}/wallets/${MASTER_WALLET}/assets`);
      expect(config.headers['x-api-key']).toBe(API_KEY);
    });

    it('maps data[n].id (wallet-asset id) → assetId, NOT data[n].asset.id', async () => {
      http.get.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      const result = await provider.listWalletAssets(MASTER_WALLET);

      // The wallet-scoped withdraw/balance endpoints reject asset.id (the global
      // catalog id) — they require the top-level wallet-asset join id.
      expect(result[0].assetId).toBe('wallet-asset-join-id-1');
      expect(result[1].assetId).toBe('wallet-asset-join-id-2');
    });

    it('maps data[n].asset.symbol.toUpperCase() → symbol', async () => {
      // Provide a lower-case symbol to verify normalisation.
      const body = {
        ...SUCCESS_BODY,
        data: [
          {
            ...SUCCESS_BODY.data[0],
            asset: { ...SUCCESS_BODY.data[0].asset, symbol: 'usdt' },
          },
        ],
      };
      http.get.mockReturnValue(of(axiosOk(body)));

      const result = await provider.listWalletAssets(MASTER_WALLET);

      expect(result[0].symbol).toBe('USDT');
    });

    it('maps data[n].asset.blockchain.slug.toUpperCase() → network', async () => {
      http.get.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      const result = await provider.listWalletAssets(MASTER_WALLET);

      // "tron" slug → "TRON" network
      expect(result[0].network).toBe('TRON');
      expect(result[1].network).toBe('TRON');
    });

    it('maps data[n].asset.address → contractAddress (non-empty string)', async () => {
      http.get.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      const result = await provider.listWalletAssets(MASTER_WALLET);

      expect(result[0].contractAddress).toBe(
        'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      );
    });

    it('maps empty address string → contractAddress null (native asset)', async () => {
      http.get.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      const result = await provider.listWalletAssets(MASTER_WALLET);

      // TRX has address: '' → should be null
      expect(result[1].contractAddress).toBeNull();
    });

    it('maps data[n].asset.decimals → decimals', async () => {
      http.get.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      const result = await provider.listWalletAssets(MASTER_WALLET);

      expect(result[0].decimals).toBe(6);
    });

    it('maps data[n].asset.logoUrl → logoUrl when present', async () => {
      const logo =
        'https://res.cloudinary.com/blockradar/image/upload/v1/usdt.png';
      const body = {
        ...SUCCESS_BODY,
        data: [
          {
            ...SUCCESS_BODY.data[0],
            asset: { ...SUCCESS_BODY.data[0].asset, logoUrl: logo },
          },
        ],
      };
      http.get.mockReturnValue(of(axiosOk(body)));

      const result = await provider.listWalletAssets(MASTER_WALLET);

      expect(result[0].logoUrl).toBe(logo);
    });

    it('falls back to data[n].asset.blockchain.logoUrl when asset.logoUrl is absent', async () => {
      const chainLogo =
        'https://res.cloudinary.com/blockradar/image/upload/v1/tron.png';
      const body = {
        ...SUCCESS_BODY,
        data: [
          {
            ...SUCCESS_BODY.data[0],
            asset: {
              ...SUCCESS_BODY.data[0].asset,
              blockchain: {
                ...SUCCESS_BODY.data[0].asset.blockchain,
                logoUrl: chainLogo,
              },
            },
          },
        ],
      };
      http.get.mockReturnValue(of(axiosOk(body)));

      const result = await provider.listWalletAssets(MASTER_WALLET);

      expect(result[0].logoUrl).toBe(chainLogo);
    });

    it('maps logoUrl → null when neither asset nor blockchain provides one', async () => {
      http.get.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      const result = await provider.listWalletAssets(MASTER_WALLET);

      // SUCCESS_BODY has no logoUrl on either asset or blockchain.
      expect(result[0].logoUrl).toBeNull();
    });

    it('maps asset.network === "mainnet" → isMainnet true', async () => {
      const mainnetBody = {
        ...SUCCESS_BODY,
        data: [
          {
            ...SUCCESS_BODY.data[0],
            asset: { ...SUCCESS_BODY.data[0].asset, network: 'mainnet' },
          },
        ],
      };
      http.get.mockReturnValue(of(axiosOk(mainnetBody)));

      const result = await provider.listWalletAssets(MASTER_WALLET);

      expect(result[0].isMainnet).toBe(true);
    });

    it('maps asset.network === "testnet" → isMainnet false', async () => {
      http.get.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      const result = await provider.listWalletAssets(MASTER_WALLET);

      expect(result[0].isMainnet).toBe(false);
    });

    it('returns empty array when data is empty', async () => {
      http.get.mockReturnValue(of(axiosOk({ data: [] })));

      const result = await provider.listWalletAssets(MASTER_WALLET);

      expect(result).toEqual([]);
    });

    it('throws a descriptive error on non-2xx response', async () => {
      const axiosErr = Object.assign(new Error('Unauthorized'), {
        response: {
          status: 401,
          data: { message: 'Invalid API key' },
        },
        isAxiosError: true,
      });
      http.get.mockReturnValue(throwError(() => axiosErr));

      await expect(provider.listWalletAssets(MASTER_WALLET)).rejects.toThrow(
        /Blockradar listWalletAssets error/,
      );
    });

    it('does not call AssetRegistry.networkMasterWalletId (caller supplies the id directly)', async () => {
      http.get.mockReturnValue(of(axiosOk(SUCCESS_BODY)));

      await provider.listWalletAssets(MASTER_WALLET);

      // listWalletAssets takes masterWalletId directly — no registry lookup needed.
      expect(assetRegistry.networkMasterWalletId).not.toHaveBeenCalled();
    });
  });

  // ── getWithdrawalStatus ───────────────────────────────────────────────────
  //
  // Endpoint (docs.blockradar.co):
  //   GET /wallets/{masterWalletId}/addresses/{addressId}/transactions
  //   response: { data: [{ id, status, reference?, hash? }] }
  //
  // Fail-safe: any provider error returns { status: 'pending' } — reconciler
  // leaves the row open rather than refunding prematurely.

  describe('getWithdrawalStatus', () => {
    const ADDRESS_ID = 'child-address-id-1';
    const REF = 'idempotency-key-send-123';

    const makeTransactionsList = (
      items: {
        id: string;
        status: string;
        reference?: string;
        hash?: string;
      }[],
    ) => ({ data: items });

    it('returns pending when addressId is absent (fail-safe)', async () => {
      const result = await provider.getWithdrawalStatus({
        reference: REF,
        network: 'TRON',
      });
      expect(result.status).toBe('pending');
      expect(http.get).not.toHaveBeenCalled();
    });

    it('returns pending when network is absent (fail-safe)', async () => {
      const result = await provider.getWithdrawalStatus({
        reference: REF,
        addressId: ADDRESS_ID,
      });
      expect(result.status).toBe('pending');
      expect(http.get).not.toHaveBeenCalled();
    });

    it('returns pending when network has no master wallet id (fail-safe)', async () => {
      assetRegistry.networkMasterWalletId.mockImplementation((n: string) => {
        throw new Error(`No master wallet id for network "${n}"`);
      });

      const result = await provider.getWithdrawalStatus({
        reference: REF,
        addressId: ADDRESS_ID,
        network: 'UNKNOWN',
      });
      expect(result.status).toBe('pending');
      expect(http.get).not.toHaveBeenCalled();
    });

    it('resolves master wallet id from AssetRegistry for the given network', async () => {
      http.get.mockReturnValue(of(axiosOk(makeTransactionsList([]))));

      await provider.getWithdrawalStatus({
        reference: REF,
        addressId: ADDRESS_ID,
        network: 'TRON',
      });

      expect(assetRegistry.networkMasterWalletId).toHaveBeenCalledWith('TRON');
    });

    it('GETs /wallets/{masterWalletId}/addresses/{addressId}/transactions with x-api-key', async () => {
      http.get.mockReturnValue(of(axiosOk(makeTransactionsList([]))));

      await provider.getWithdrawalStatus({
        reference: REF,
        addressId: ADDRESS_ID,
        network: 'TRON',
      });

      const [url, config] = http.get.mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      expect(url).toBe(
        `${BASE_URL}/wallets/${MASTER_WALLET_ID}/addresses/${ADDRESS_ID}/transactions`,
      );
      expect(config.headers['x-api-key']).toBe(API_KEY);
    });

    it('returns pending when reference not found in transaction list', async () => {
      http.get.mockReturnValue(
        of(
          axiosOk(
            makeTransactionsList([
              { id: 'tx-1', status: 'SUCCESS', reference: 'other-ref' },
            ]),
          ),
        ),
      );

      const result = await provider.getWithdrawalStatus({
        reference: REF,
        addressId: ADDRESS_ID,
        network: 'TRON',
      });

      expect(result.status).toBe('pending');
    });

    it('returns success and hash when matching transaction has SUCCESS status', async () => {
      http.get.mockReturnValue(
        of(
          axiosOk(
            makeTransactionsList([
              {
                id: 'tx-match',
                status: 'SUCCESS',
                reference: REF,
                hash: 'tron_chain_hash_abc',
              },
            ]),
          ),
        ),
      );

      const result = await provider.getWithdrawalStatus({
        reference: REF,
        addressId: ADDRESS_ID,
        network: 'TRON',
      });

      expect(result.status).toBe('success');
      expect(result.onChainTxHash).toBe('tron_chain_hash_abc');
    });

    it('returns failed when matching transaction has FAILED status', async () => {
      http.get.mockReturnValue(
        of(
          axiosOk(
            makeTransactionsList([
              { id: 'tx-fail', status: 'FAILED', reference: REF },
            ]),
          ),
        ),
      );

      const result = await provider.getWithdrawalStatus({
        reference: REF,
        addressId: ADDRESS_ID,
        network: 'TRON',
      });

      expect(result.status).toBe('failed');
      expect(result.onChainTxHash).toBeUndefined();
    });

    it('returns pending when matching transaction has PENDING status', async () => {
      http.get.mockReturnValue(
        of(
          axiosOk(
            makeTransactionsList([
              { id: 'tx-pend', status: 'PENDING', reference: REF },
            ]),
          ),
        ),
      );

      const result = await provider.getWithdrawalStatus({
        reference: REF,
        addressId: ADDRESS_ID,
        network: 'TRON',
      });

      expect(result.status).toBe('pending');
    });

    it('returns pending (fail-safe) on HTTP error — never throws', async () => {
      http.get.mockReturnValue(
        throwError(() =>
          Object.assign(new Error('Internal Server Error'), {
            response: { status: 500, data: { message: 'DB error' } },
          }),
        ),
      );

      // Must NOT throw — reconciler must never refund on provider error.
      const result = await provider.getWithdrawalStatus({
        reference: REF,
        addressId: ADDRESS_ID,
        network: 'TRON',
      });

      expect(result.status).toBe('pending');
    });

    it('returns pending (fail-safe) on network timeout — never throws', async () => {
      http.get.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

      const result = await provider.getWithdrawalStatus({
        reference: REF,
        addressId: ADDRESS_ID,
        network: 'TRON',
      });

      expect(result.status).toBe('pending');
    });
  });
});
