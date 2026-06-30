/**
 * Unit tests for FlutterwaveProvider (task 5.2).
 *
 * HttpService is mocked — no real network calls, no Flutterwave in CI.
 * ConfigService is stubbed to return fixed values.
 *
 * TDD: written before the implementation (red → green → refactor).
 */

import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import type { AxiosResponse } from 'axios';

import { FlutterwaveProvider } from './flutterwave.provider';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const BASE_URL = 'https://api.flutterwave.com/v3';
const SECRET_KEY = 'FLWSECK_TEST-abc123';
const WEBHOOK_SECRET = 'my-webhook-secret';

function makeConfig(): ConfigService {
  const values: Record<string, unknown> = {
    FLUTTERWAVE_BASE_URL: BASE_URL,
    FLUTTERWAVE_SECRET_KEY: SECRET_KEY,
    FLUTTERWAVE_WEBHOOK_SECRET: WEBHOOK_SECRET,
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
// Realistic Flutterwave v3 response shapes
// ---------------------------------------------------------------------------

const CREATE_COLLECTION_RESPONSE = {
  status: 'success',
  message: 'Virtual Account Created',
  data: {
    response_code: '02',
    response_message: 'Transaction in progress',
    flw_ref: 'FLW-MOCK-REF-001',
    order_ref: 'URF_1234567890',
    account_number: '0123456789',
    frequency: '1',
    bank_name: 'WEMA BANK',
    created_at: '2024-01-15T10:30:00.000Z',
    expiry_date: '2024-01-15T11:00:00.000Z',
    note: 'Please make a bank transfer to WEMA BANK',
    amount: 50000,
  },
};

const VERIFY_RESPONSE = {
  status: 'success',
  message: 'Transaction fetched successfully',
  data: {
    id: 123456,
    tx_ref: 'txn-ref-001',
    flw_ref: 'FLW-MOCK-REF-001',
    device_fingerprint: '0',
    amount: 50000,
    currency: 'NGN',
    charged_amount: 50000,
    app_fee: 0,
    merchant_fee: 0,
    processor_response: 'Approved by Financial Institution',
    auth_model: 'VBVSECURECODE',
    ip: '127.0.0.1',
    narration: 'Buy USDT',
    status: 'successful',
    payment_type: 'bank_transfer',
    created_at: '2024-01-15T10:35:00.000Z',
    account_id: 999,
    customer: {
      id: 1,
      name: 'John Doe',
      phone_number: '',
      email: 'john@example.com',
      created_at: '2024-01-15T10:00:00.000Z',
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FlutterwaveProvider', () => {
  let http: jest.Mocked<HttpService>;
  let provider: FlutterwaveProvider;

  beforeEach(() => {
    http = {
      post: jest.fn(),
      get: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;
    provider = new FlutterwaveProvider(http, makeConfig());
  });

  // ── createCollection ──────────────────────────────────────────────────────

  describe('createCollection', () => {
    const INPUT = {
      amount: '50000',
      currency: 'NGN' as const,
      reference: 'txn-ref-001',
      customer: {
        email: 'john@example.com',
        firstname: 'John',
        lastname: 'Doe',
        phone: '+2348012345678',
      },
    };

    it('POSTs to {base}/virtual-account-numbers with Bearer auth header', async () => {
      http.post.mockReturnValue(of(axiosOk(CREATE_COLLECTION_RESPONSE)));

      await provider.createCollection(INPUT);

      expect(http.post).toHaveBeenCalledTimes(1);
      const [url, , config] = http.post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];
      expect(url).toBe(`${BASE_URL}/virtual-account-numbers`);
      expect(config.headers['Authorization']).toBe(`Bearer ${SECRET_KEY}`);
    });

    it('sends email, amount, tx_ref, firstname, lastname, narration, is_permanent:false in body', async () => {
      http.post.mockReturnValue(of(axiosOk(CREATE_COLLECTION_RESPONSE)));

      await provider.createCollection(INPUT);

      const [, body] = http.post.mock.calls[0] as [
        string,
        {
          email: string;
          amount: string;
          tx_ref: string;
          firstname: string;
          lastname: string;
          narration: string;
          is_permanent: boolean;
        },
      ];
      expect(body.email).toBe(INPUT.customer.email);
      expect(body.amount).toBe(INPUT.amount);
      expect(body.tx_ref).toBe(INPUT.reference);
      expect(body.firstname).toBe(INPUT.customer.firstname);
      expect(body.lastname).toBe(INPUT.customer.lastname);
      expect(typeof body.narration).toBe('string');
      expect(body.is_permanent).toBe(false);
    });

    it('maps data.account_number → accountNumber, data.bank_name → bankName, data.flw_ref → providerRef', async () => {
      http.post.mockReturnValue(of(axiosOk(CREATE_COLLECTION_RESPONSE)));

      const result = await provider.createCollection(INPUT);

      expect(result.accountNumber).toBe('0123456789');
      expect(result.bankName).toBe('WEMA BANK');
      expect(result.providerRef).toBe('FLW-MOCK-REF-001');
    });

    it('maps data.expiry_date → expiresAt when present', async () => {
      http.post.mockReturnValue(of(axiosOk(CREATE_COLLECTION_RESPONSE)));

      const result = await provider.createCollection(INPUT);

      expect(result.expiresAt).toBe('2024-01-15T11:00:00.000Z');
    });

    it('is defensive: reads from data if present else top-level (top-level fallback)', async () => {
      // Some Flutterwave accounts return fields at top level instead of inside data.
      const topLevelResponse = {
        status: 'success',
        message: 'Virtual Account Created',
        account_number: 'TOP_LEVEL_ACCT',
        bank_name: 'TOP LEVEL BANK',
        flw_ref: 'FLW-TOP-REF-001',
        expiry_date: '2024-01-15T12:00:00.000Z',
        data: null,
      };
      http.post.mockReturnValue(of(axiosOk(topLevelResponse)));

      const result = await provider.createCollection(INPUT);

      expect(result.accountNumber).toBe('TOP_LEVEL_ACCT');
      expect(result.bankName).toBe('TOP LEVEL BANK');
      expect(result.providerRef).toBe('FLW-TOP-REF-001');
    });

    it('sends X-Scenario-Key on createCollection when FLUTTERWAVE_SCENARIO_KEY is set (sandbox)', async () => {
      const cfg = {
        get: (k: string) =>
          (
            ({
              FLUTTERWAVE_BASE_URL: BASE_URL,
              FLUTTERWAVE_SECRET_KEY: SECRET_KEY,
              FLUTTERWAVE_SCENARIO_KEY: 'scenario:successful',
            }) as Record<string, unknown>
          )[k],
      } as unknown as ConfigService;
      const p = new FlutterwaveProvider(http, cfg);
      http.post.mockReturnValue(of(axiosOk(CREATE_COLLECTION_RESPONSE)));

      await p.createCollection(INPUT);

      const [, , config] = http.post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];
      expect(config.headers['X-Scenario-Key']).toBe('scenario:successful');
    });

    it('omits X-Scenario-Key when not configured (production default)', async () => {
      http.post.mockReturnValue(of(axiosOk(CREATE_COLLECTION_RESPONSE)));

      await provider.createCollection(INPUT);

      const [, , config] = http.post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];
      expect(config.headers['X-Scenario-Key']).toBeUndefined();
    });

    it('throws a descriptive error including the API message on non-2xx', async () => {
      const axiosErr = Object.assign(new Error('Bad Request'), {
        response: {
          status: 400,
          data: { status: 'error', message: 'Invalid transaction reference' },
        },
        isAxiosError: true,
      });
      http.post.mockReturnValue(throwError(() => axiosErr));

      await expect(provider.createCollection(INPUT)).rejects.toThrow(
        /Invalid transaction reference/,
      );
    });

    it('error thrown on non-2xx includes HTTP status', async () => {
      const axiosErr = Object.assign(new Error('Unauthorized'), {
        response: {
          status: 401,
          data: { status: 'error', message: 'Invalid API key' },
        },
        isAxiosError: true,
      });
      http.post.mockReturnValue(throwError(() => axiosErr));

      await expect(provider.createCollection(INPUT)).rejects.toThrow(/401/);
    });

    it('attaches httpStatus STRUCTURALLY on a non-2xx (so the engine refunds on a definitive 4xx, not a 5xx/network)', async () => {
      const axiosErr = Object.assign(new Error('Bad Request'), {
        response: {
          status: 400,
          data: {
            status: 'error',
            message: 'merchant is not enabled to make transfers',
          },
        },
        isAxiosError: true,
      });
      http.post.mockReturnValue(throwError(() => axiosErr));

      await expect(provider.createCollection(INPUT)).rejects.toMatchObject({
        httpStatus: 400,
      });
    });

    it('does NOT attach httpStatus on a network error (no axios response) — ambiguous, leave settling', async () => {
      http.post.mockReturnValue(throwError(() => new Error('ECONNRESET')));
      const netErr = await provider
        .createCollection(INPUT)
        .catch((e: unknown) => e);
      expect((netErr as { httpStatus?: number }).httpStatus).toBeUndefined();
    });

    it('re-throws non-Flutterwave errors as-is', async () => {
      http.post.mockReturnValue(throwError(() => new Error('Network timeout')));

      await expect(provider.createCollection(INPUT)).rejects.toThrow(
        'Network timeout',
      );
    });
  });

  // ── verify ────────────────────────────────────────────────────────────────

  describe('verify', () => {
    const TX_REF = 'txn-ref-001';

    it('GETs /transactions/verify_by_reference?tx_ref=... with Bearer auth', async () => {
      http.get.mockReturnValue(of(axiosOk(VERIFY_RESPONSE)));

      await provider.verify(TX_REF);

      expect(http.get).toHaveBeenCalledTimes(1);
      const [url, config] = http.get.mock.calls[0] as [
        string,
        { headers: Record<string, string>; params: Record<string, string> },
      ];
      expect(url).toBe(`${BASE_URL}/transactions/verify_by_reference`);
      expect(config.params['tx_ref']).toBe(TX_REF);
      expect(config.headers['Authorization']).toBe(`Bearer ${SECRET_KEY}`);
    });

    it('maps data.status → status, data.amount → amount (string), data.currency → currency, data.flw_ref → providerRef', async () => {
      http.get.mockReturnValue(of(axiosOk(VERIFY_RESPONSE)));

      const result = await provider.verify(TX_REF);

      expect(result.status).toBe('successful');
      expect(result.amount).toBe('50000');
      expect(result.currency).toBe('NGN');
      expect(result.providerRef).toBe('FLW-MOCK-REF-001');
    });

    it('recognises status="successful" as the paid state', async () => {
      http.get.mockReturnValue(of(axiosOk(VERIFY_RESPONSE)));

      const result = await provider.verify(TX_REF);

      expect(result.status).toBe('successful');
    });

    it('maps non-successful status from the response', async () => {
      const pendingResponse = {
        ...VERIFY_RESPONSE,
        data: { ...VERIFY_RESPONSE.data, status: 'pending' },
      };
      http.get.mockReturnValue(of(axiosOk(pendingResponse)));

      const result = await provider.verify(TX_REF);

      expect(result.status).toBe('pending');
    });

    it('throws a descriptive error on non-2xx response', async () => {
      const axiosErr = Object.assign(new Error('Not Found'), {
        response: {
          status: 404,
          data: { status: 'error', message: 'Transaction not found' },
        },
        isAxiosError: true,
      });
      http.get.mockReturnValue(throwError(() => axiosErr));

      await expect(provider.verify(TX_REF)).rejects.toThrow(
        /Transaction not found/,
      );
    });

    it('re-throws network errors as-is', async () => {
      http.get.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

      await expect(provider.verify(TX_REF)).rejects.toThrow('ECONNREFUSED');
    });
  });

  // ── createPayout ─────────────────────────────────────────────────────────

  describe('createPayout', () => {
    const PAYOUT_INPUT = {
      amount: '25000',
      currency: 'NGN' as const,
      reference: 'payout-ref-001',
      bankAccount: {
        accountNumber: '0123456789',
        bankCode: '044',
        accountName: 'Jane Doe',
      },
    };

    const CREATE_PAYOUT_RESPONSE = {
      status: 'success',
      message: 'Transfer Queued Successfully',
      data: {
        id: 999001,
        account_number: '0123456789',
        bank_code: '044',
        full_name: 'Jane Doe',
        created_at: '2024-01-15T10:30:00.000Z',
        currency: 'NGN',
        debit_currency: 'NGN',
        amount: 25000,
        fee: 45,
        status: 'NEW',
        reference: 'payout-ref-001',
        meta: null,
        narration: 'Sell crypto ref payout-ref-001',
        complete_message: '',
        requires_approval: 0,
        is_approved: 1,
        bank_name: 'ACCESS BANK NIGERIA',
      },
    };

    it('POSTs to {base}/transfers with Bearer auth header', async () => {
      http.post.mockReturnValue(of(axiosOk(CREATE_PAYOUT_RESPONSE)));

      await provider.createPayout(PAYOUT_INPUT);

      expect(http.post).toHaveBeenCalledTimes(1);
      const [url, , config] = http.post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];
      expect(url).toBe(`${BASE_URL}/transfers`);
      expect(config.headers['Authorization']).toBe(`Bearer ${SECRET_KEY}`);
    });

    it('sends account_bank, account_number, amount (number), currency NGN, narration, reference in body', async () => {
      http.post.mockReturnValue(of(axiosOk(CREATE_PAYOUT_RESPONSE)));

      await provider.createPayout(PAYOUT_INPUT);

      const [, body] = http.post.mock.calls[0] as [
        string,
        {
          account_bank: string;
          account_number: string;
          amount: number;
          currency: string;
          narration: string;
          reference: string;
        },
      ];
      expect(body.account_bank).toBe(PAYOUT_INPUT.bankAccount.bankCode);
      expect(body.account_number).toBe(PAYOUT_INPUT.bankAccount.accountNumber);
      expect(body.amount).toBe(25000); // coerced to number
      expect(typeof body.amount).toBe('number');
      expect(body.currency).toBe('NGN');
      expect(typeof body.narration).toBe('string');
      expect(body.reference).toBe(PAYOUT_INPUT.reference);
    });

    it('maps data.id → providerRef (as string) and normalises status NEW → pending', async () => {
      http.post.mockReturnValue(of(axiosOk(CREATE_PAYOUT_RESPONSE)));

      const result = await provider.createPayout(PAYOUT_INPUT);

      expect(result.providerRef).toBe('999001');
      expect(result.status).toBe('pending');
    });

    it('maps data.status PENDING → pending', async () => {
      const pendingResp = {
        ...CREATE_PAYOUT_RESPONSE,
        data: { ...CREATE_PAYOUT_RESPONSE.data, status: 'PENDING' },
      };
      http.post.mockReturnValue(of(axiosOk(pendingResp)));

      const result = await provider.createPayout(PAYOUT_INPUT);

      expect(result.status).toBe('pending');
    });

    it('maps data.status SUCCESSFUL → successful', async () => {
      const successResp = {
        ...CREATE_PAYOUT_RESPONSE,
        data: { ...CREATE_PAYOUT_RESPONSE.data, status: 'SUCCESSFUL' },
      };
      http.post.mockReturnValue(of(axiosOk(successResp)));

      const result = await provider.createPayout(PAYOUT_INPUT);

      expect(result.status).toBe('successful');
    });

    it('maps data.status FAILED → failed', async () => {
      const failedResp = {
        ...CREATE_PAYOUT_RESPONSE,
        data: { ...CREATE_PAYOUT_RESPONSE.data, status: 'FAILED' },
      };
      http.post.mockReturnValue(of(axiosOk(failedResp)));

      const result = await provider.createPayout(PAYOUT_INPUT);

      expect(result.status).toBe('failed');
    });

    it('throws a descriptive error including the API message on non-2xx', async () => {
      const axiosErr = Object.assign(new Error('Bad Request'), {
        response: {
          status: 400,
          data: { status: 'error', message: 'Invalid account number' },
        },
        isAxiosError: true,
      });
      http.post.mockReturnValue(throwError(() => axiosErr));

      await expect(provider.createPayout(PAYOUT_INPUT)).rejects.toThrow(
        /Invalid account number/,
      );
    });

    it('error thrown on non-2xx includes HTTP status', async () => {
      const axiosErr = Object.assign(new Error('Unauthorized'), {
        response: {
          status: 401,
          data: { status: 'error', message: 'Invalid API key' },
        },
        isAxiosError: true,
      });
      http.post.mockReturnValue(throwError(() => axiosErr));

      await expect(provider.createPayout(PAYOUT_INPUT)).rejects.toThrow(/401/);
    });

    it('re-throws non-Flutterwave errors as-is', async () => {
      http.post.mockReturnValue(throwError(() => new Error('Network timeout')));

      await expect(provider.createPayout(PAYOUT_INPUT)).rejects.toThrow(
        'Network timeout',
      );
    });
  });

  // ── verifyPayout ─────────────────────────────────────────────────────────

  describe('verifyPayout', () => {
    const PAYOUT_ID = '999001';

    const VERIFY_PAYOUT_RESPONSE = {
      status: 'success',
      message: 'Transfer fetched',
      data: {
        id: 999001,
        account_number: '0123456789',
        bank_code: '044',
        full_name: 'Jane Doe',
        created_at: '2024-01-15T10:30:00.000Z',
        currency: 'NGN',
        debit_currency: 'NGN',
        amount: 25000,
        fee: 45,
        status: 'SUCCESSFUL',
        reference: 'payout-ref-001',
        meta: null,
        narration: 'Sell crypto ref payout-ref-001',
        complete_message: 'Successful',
        requires_approval: 0,
        is_approved: 1,
        bank_name: 'ACCESS BANK NIGERIA',
      },
    };

    it('GETs {base}/transfers/{id} with Bearer auth', async () => {
      http.get.mockReturnValue(of(axiosOk(VERIFY_PAYOUT_RESPONSE)));

      await provider.verifyPayout(PAYOUT_ID);

      expect(http.get).toHaveBeenCalledTimes(1);
      const [url, config] = http.get.mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      expect(url).toBe(`${BASE_URL}/transfers/${PAYOUT_ID}`);
      expect(config.headers['Authorization']).toBe(`Bearer ${SECRET_KEY}`);
    });

    it('maps SUCCESSFUL status → successful, amount (string), currency, providerRef (string)', async () => {
      http.get.mockReturnValue(of(axiosOk(VERIFY_PAYOUT_RESPONSE)));

      const result = await provider.verifyPayout(PAYOUT_ID);

      expect(result.status).toBe('successful');
      expect(result.amount).toBe('25000');
      expect(result.currency).toBe('NGN');
      expect(result.providerRef).toBe('999001');
    });

    it('only SUCCESSFUL terminal state maps to successful', async () => {
      const pendingResp = {
        ...VERIFY_PAYOUT_RESPONSE,
        data: { ...VERIFY_PAYOUT_RESPONSE.data, status: 'PENDING' },
      };
      http.get.mockReturnValue(of(axiosOk(pendingResp)));

      const result = await provider.verifyPayout(PAYOUT_ID);

      expect(result.status).toBe('pending');
    });

    it('maps NEW status → pending', async () => {
      const newResp = {
        ...VERIFY_PAYOUT_RESPONSE,
        data: { ...VERIFY_PAYOUT_RESPONSE.data, status: 'NEW' },
      };
      http.get.mockReturnValue(of(axiosOk(newResp)));

      const result = await provider.verifyPayout(PAYOUT_ID);

      expect(result.status).toBe('pending');
    });

    it('maps FAILED status → failed', async () => {
      const failedResp = {
        ...VERIFY_PAYOUT_RESPONSE,
        data: { ...VERIFY_PAYOUT_RESPONSE.data, status: 'FAILED' },
      };
      http.get.mockReturnValue(of(axiosOk(failedResp)));

      const result = await provider.verifyPayout(PAYOUT_ID);

      expect(result.status).toBe('failed');
    });

    it('throws a descriptive error on non-2xx response', async () => {
      const axiosErr = Object.assign(new Error('Not Found'), {
        response: {
          status: 404,
          data: { status: 'error', message: 'Transfer not found' },
        },
        isAxiosError: true,
      });
      http.get.mockReturnValue(throwError(() => axiosErr));

      await expect(provider.verifyPayout(PAYOUT_ID)).rejects.toThrow(
        /Transfer not found/,
      );
    });

    it('re-throws network errors as-is', async () => {
      http.get.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

      await expect(provider.verifyPayout(PAYOUT_ID)).rejects.toThrow(
        'ECONNREFUSED',
      );
    });
  });

  // ── verifyWebhookSignature ────────────────────────────────────────────────

  describe('verifyWebhookSignature', () => {
    it('returns true when the header exactly matches the configured secret', () => {
      expect(provider.verifyWebhookSignature(WEBHOOK_SECRET)).toBe(true);
    });

    it('returns false when the header differs from the configured secret', () => {
      expect(provider.verifyWebhookSignature('wrong-secret')).toBe(false);
    });

    it('returns false when the header is undefined', () => {
      expect(provider.verifyWebhookSignature(undefined)).toBe(false);
    });

    it('returns false when the header is an array (multi-value header)', () => {
      expect(
        provider.verifyWebhookSignature([WEBHOOK_SECRET, WEBHOOK_SECRET]),
      ).toBe(false);
    });

    it('returns false when the header is an empty string', () => {
      expect(provider.verifyWebhookSignature('')).toBe(false);
    });

    it('returns false when the configured secret is empty (not set)', () => {
      // Provider with empty FLUTTERWAVE_WEBHOOK_SECRET → always reject.
      const noSecretConfig = {
        get: (key: string) => {
          if (key === 'FLUTTERWAVE_BASE_URL') return BASE_URL;
          if (key === 'FLUTTERWAVE_SECRET_KEY') return SECRET_KEY;
          if (key === 'FLUTTERWAVE_WEBHOOK_SECRET') return '';
          return undefined;
        },
      } as unknown as ConfigService;
      const noSecretProvider = new FlutterwaveProvider(http, noSecretConfig);
      expect(noSecretProvider.verifyWebhookSignature('')).toBe(false);
    });
  });
});
