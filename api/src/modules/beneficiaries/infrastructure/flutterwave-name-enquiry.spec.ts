/**
 * TDD — flutterwave-name-enquiry.spec.ts
 *
 * RED first: tests drive the FlutterwaveNameEnquiry design before the
 * implementation exists.
 *
 * Behaviour:
 *   - resolve() calls POST {FLUTTERWAVE_BASE_URL}/accounts/resolve with
 *     Authorization: Bearer {SECRET}, body { account_number, account_bank }.
 *   - On a 200 success response, returns { accountName, provider:'flutterwave', reference }.
 *   - On a non-resolvable account (Flutterwave returns status:'error'), throws
 *     NameEnquiryFailedError.
 *   - On an HTTP error (network failure), wraps into NameEnquiryFailedError.
 */

import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import type { AxiosError, AxiosResponse } from 'axios';

import { FlutterwaveNameEnquiry } from './flutterwave-name-enquiry';
import { NameEnquiryFailedError } from '../domain/beneficiary-errors';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_URL = 'https://api.flutterwave.com/v3';
const SECRET_KEY = 'FLWSECK_TEST-abc123';

function makeConfig(): ConfigService {
  const values: Record<string, unknown> = {
    FLUTTERWAVE_BASE_URL: BASE_URL,
    FLUTTERWAVE_SECRET_KEY: SECRET_KEY,
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

function axiosError(status: number, message: string): AxiosError {
  const err = new Error(message) as AxiosError;
  err.isAxiosError = true;
  err.response = {
    data: { status: 'error', message },
    status,
    statusText: 'Bad Request',
    headers: {},
    config: { headers: {} as never },
  };
  return err;
}

// Successful Flutterwave resolve-account response shape
const RESOLVE_SUCCESS_RESPONSE = {
  status: 'success',
  message: 'Account details fetched',
  data: {
    account_number: '0690000032',
    account_name: 'YEMI DESOLA',
  },
};

// Error response when account cannot be resolved
const RESOLVE_ERROR_RESPONSE = {
  status: 'error',
  message: 'Sorry, that account number is invalid, please check and try again',
  data: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FlutterwaveNameEnquiry', () => {
  let httpService: jest.Mocked<HttpService>;
  let enquiry: FlutterwaveNameEnquiry;

  beforeEach(() => {
    httpService = {
      post: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;
    enquiry = new FlutterwaveNameEnquiry(httpService, makeConfig());
  });

  describe('resolve — happy path', () => {
    it('returns the resolved account name from the Flutterwave response', async () => {
      httpService.post.mockReturnValueOnce(
        of(axiosOk(RESOLVE_SUCCESS_RESPONSE)),
      );

      const result = await enquiry.resolve({
        bankCode: '044',
        accountNumber: '0690000032',
      });

      expect(result.accountName).toBe('YEMI DESOLA');
      expect(result.provider).toBe('flutterwave');
      expect(result.reference).toBeTruthy();
    });

    it('sends POST to {FLUTTERWAVE_BASE_URL}/accounts/resolve with correct body', async () => {
      httpService.post.mockReturnValueOnce(
        of(axiosOk(RESOLVE_SUCCESS_RESPONSE)),
      );

      await enquiry.resolve({ bankCode: '044', accountNumber: '0690000032' });

      expect(httpService.post).toHaveBeenCalledTimes(1);
      const [url, body] = httpService.post.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/accounts/resolve`);
      expect(body).toEqual({
        account_number: '0690000032',
        account_bank: '044',
      });
    });

    it('sends Authorization: Bearer header with the secret key', async () => {
      httpService.post.mockReturnValueOnce(
        of(axiosOk(RESOLVE_SUCCESS_RESPONSE)),
      );

      await enquiry.resolve({ bankCode: '044', accountNumber: '0690000032' });

      const [, , options] = httpService.post.mock.calls[0];
      expect(
        (options as { headers: Record<string, string> }).headers[
          'Authorization'
        ],
      ).toBe(`Bearer ${SECRET_KEY}`);
    });

    it('includes a non-empty reference in the result', async () => {
      httpService.post.mockReturnValueOnce(
        of(axiosOk(RESOLVE_SUCCESS_RESPONSE)),
      );

      const result = await enquiry.resolve({
        bankCode: '044',
        accountNumber: '0690000032',
      });

      expect(typeof result.reference).toBe('string');
      expect(result.reference.length).toBeGreaterThan(0);
    });
  });

  describe('resolve — error path (account not found)', () => {
    it('throws NameEnquiryFailedError when Flutterwave returns status:error in 200 body', async () => {
      httpService.post.mockReturnValueOnce(of(axiosOk(RESOLVE_ERROR_RESPONSE)));

      await expect(
        enquiry.resolve({ bankCode: '044', accountNumber: '0000000000' }),
      ).rejects.toThrow(NameEnquiryFailedError);
    });

    it('error message contains the account number and bank code', async () => {
      httpService.post.mockReturnValueOnce(of(axiosOk(RESOLVE_ERROR_RESPONSE)));

      const err = await enquiry
        .resolve({ bankCode: '044', accountNumber: '0000000000' })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(NameEnquiryFailedError);
      expect((err as Error).message).toContain('0000000000');
      expect((err as Error).message).toContain('044');
    });
  });

  describe('resolve — HTTP error path', () => {
    it('throws NameEnquiryFailedError when the HTTP call fails', async () => {
      httpService.post.mockReturnValueOnce(
        throwError(() => axiosError(400, 'account not found')),
      );

      await expect(
        enquiry.resolve({ bankCode: '044', accountNumber: '9999999999' }),
      ).rejects.toThrow(NameEnquiryFailedError);
    });

    it('includes Flutterwave error message in the thrown error', async () => {
      httpService.post.mockReturnValueOnce(
        throwError(() =>
          axiosError(400, 'Sorry, that account number is invalid'),
        ),
      );

      const err = await enquiry
        .resolve({ bankCode: '044', accountNumber: '9999999999' })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(NameEnquiryFailedError);
      expect((err as Error).message).toContain('9999999999');
    });
  });
});
