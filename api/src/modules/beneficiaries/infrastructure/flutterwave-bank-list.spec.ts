/**
 * TDD — flutterwave-bank-list.spec.ts
 *
 * Behaviour:
 *   - listBanks(country) calls GET {FLUTTERWAVE_BASE_URL}/banks/{country} with
 *     Authorization: Bearer {SECRET}.
 *   - Maps the Flutterwave `data[]` ({ id, code, name }) → { name, code }.
 *   - Caches per-country (a second call within the TTL does NOT re-hit HTTP).
 *   - Single-flight: concurrent first calls share one HTTP request.
 *   - On a provider/HTTP failure returns [] (never throws — dropdown backing).
 */

import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import type { AxiosError, AxiosResponse } from 'axios';

import { FlutterwaveBankList } from './flutterwave-bank-list';

const BASE_URL = 'https://api.flutterwave.com/v3';
const SECRET_KEY = 'FLWSECK_TEST-abc123';

function makeConfig(): ConfigService {
  const values: Record<string, unknown> = {
    FLUTTERWAVE_BASE_URL: BASE_URL,
    FLUTTERWAVE_SECRET_KEY: SECRET_KEY,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
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

const BANKS_SUCCESS = {
  status: 'success',
  message: 'Banks fetched successfully',
  data: [
    { id: 132, code: '044', name: 'ACCESS BANK NIGERIA' },
    { id: 158, code: '058', name: 'GTBANK PLC' },
  ],
};

describe('FlutterwaveBankList', () => {
  let httpService: jest.Mocked<HttpService>;
  let provider: FlutterwaveBankList;

  beforeEach(() => {
    httpService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;
    provider = new FlutterwaveBankList(httpService, makeConfig());
  });

  it('GETs {BASE_URL}/banks/{country} with the Bearer secret and maps data → {name,code}', async () => {
    httpService.get.mockReturnValueOnce(of(axiosOk(BANKS_SUCCESS)));

    const banks = await provider.listBanks('NG');

    expect(httpService.get).toHaveBeenCalledTimes(1);
    const [url, options] = httpService.get.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/banks/NG`);
    expect(
      (options as { headers: Record<string, string> }).headers['Authorization'],
    ).toBe(`Bearer ${SECRET_KEY}`);
    expect(banks).toEqual([
      { name: 'ACCESS BANK NIGERIA', code: '044' },
      { name: 'GTBANK PLC', code: '058' },
    ]);
  });

  it('upper-cases the country in the path', async () => {
    httpService.get.mockReturnValueOnce(of(axiosOk(BANKS_SUCCESS)));

    await provider.listBanks('ng');

    expect(httpService.get.mock.calls[0][0]).toBe(`${BASE_URL}/banks/NG`);
  });

  it('caches per-country — a second call within the TTL does not re-hit HTTP', async () => {
    httpService.get.mockReturnValueOnce(of(axiosOk(BANKS_SUCCESS)));

    const first = await provider.listBanks('NG');
    const second = await provider.listBanks('NG');

    expect(httpService.get).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('single-flights concurrent first calls for the same country', async () => {
    httpService.get.mockReturnValueOnce(of(axiosOk(BANKS_SUCCESS)));

    const [a, b] = await Promise.all([
      provider.listBanks('NG'),
      provider.listBanks('NG'),
    ]);

    expect(httpService.get).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('returns [] (never throws) on an HTTP failure and does not cache the failure', async () => {
    httpService.get.mockReturnValueOnce(
      throwError(() => axiosError(500, 'Internal error')),
    );

    const banks = await provider.listBanks('NG');
    expect(banks).toEqual([]);

    // A subsequent successful call is attempted again (failure was not cached).
    httpService.get.mockReturnValueOnce(of(axiosOk(BANKS_SUCCESS)));
    const retry = await provider.listBanks('NG');
    expect(retry).toHaveLength(2);
    expect(httpService.get).toHaveBeenCalledTimes(2);
  });

  it('returns [] when the Flutterwave body is a non-success status', async () => {
    httpService.get.mockReturnValueOnce(
      of(axiosOk({ status: 'error', message: 'bad country', data: null })),
    );

    expect(await provider.listBanks('ZZ')).toEqual([]);
  });
});
