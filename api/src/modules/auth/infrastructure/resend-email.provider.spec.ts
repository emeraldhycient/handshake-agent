/**
 * Unit tests for ResendEmailProvider.
 *
 * HttpService is mocked — no real network calls, no Resend in CI.
 * ConfigService is stubbed to return fixed values.
 *
 * TDD: written before the implementation (red → green → refactor).
 */

import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import type { AxiosResponse } from 'axios';

import { ResendEmailProvider } from './resend-email.provider';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RESEND_API_KEY = 're_test_ABC123';
const EMAIL_FROM = 'Handshake <no-reply@handshake.com>';
const RESEND_BASE_URL = 'https://api.resend.com/emails';
const WEB_APP_BASE_URL = 'https://app.handshake.ng';

function makeConfig(): ConfigService {
  const values: Record<string, unknown> = {
    RESEND_API_KEY,
    EMAIL_FROM,
    WEB_APP_BASE_URL,
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

describe('ResendEmailProvider', () => {
  let http: jest.Mocked<HttpService>;
  let provider: ResendEmailProvider;

  beforeEach(() => {
    http = {
      post: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;
    provider = new ResendEmailProvider(http, makeConfig());
  });

  // ── sendEmailVerification ────────────────────────────────────────────────

  describe('sendEmailVerification', () => {
    const TO = 'alice@example.com';
    const TOKEN = 'tok_verify_abc123';

    it('POSTs to https://api.resend.com/emails', async () => {
      http.post.mockReturnValue(of(axiosOk({ id: 'email-id-1' })));

      await provider.sendEmailVerification(TO, TOKEN);

      expect(http.post).toHaveBeenCalledTimes(1);
      const [url] = http.post.mock.calls[0] as [string, unknown, unknown];
      expect(url).toBe(RESEND_BASE_URL);
    });

    it('sends Authorization: Bearer {RESEND_API_KEY} header', async () => {
      http.post.mockReturnValue(of(axiosOk({ id: 'email-id-1' })));

      await provider.sendEmailVerification(TO, TOKEN);

      const [, , config] = http.post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];
      expect(config.headers['Authorization']).toBe(`Bearer ${RESEND_API_KEY}`);
    });

    it('sends from EMAIL_FROM config value', async () => {
      http.post.mockReturnValue(of(axiosOk({ id: 'email-id-1' })));

      await provider.sendEmailVerification(TO, TOKEN);

      const [, body] = http.post.mock.calls[0] as [
        string,
        { from: string; to: string; subject: string; html: string },
        unknown,
      ];
      expect(body.from).toBe(EMAIL_FROM);
    });

    it('sends to the recipient address', async () => {
      http.post.mockReturnValue(of(axiosOk({ id: 'email-id-1' })));

      await provider.sendEmailVerification(TO, TOKEN);

      const [, body] = http.post.mock.calls[0] as [
        string,
        { from: string; to: string; subject: string; html: string },
        unknown,
      ];
      expect(body.to).toBe(TO);
    });

    it('sends a non-empty subject', async () => {
      http.post.mockReturnValue(of(axiosOk({ id: 'email-id-1' })));

      await provider.sendEmailVerification(TO, TOKEN);

      const [, body] = http.post.mock.calls[0] as [
        string,
        { from: string; to: string; subject: string; html: string },
        unknown,
      ];
      expect(typeof body.subject).toBe('string');
      expect(body.subject.length).toBeGreaterThan(0);
    });

    it('includes the verification link with the token in html or text body', async () => {
      http.post.mockReturnValue(of(axiosOk({ id: 'email-id-1' })));

      await provider.sendEmailVerification(TO, TOKEN);

      const [, body] = http.post.mock.calls[0] as [
        string,
        {
          from: string;
          to: string;
          subject: string;
          html: string;
          text?: string;
        },
        unknown,
      ];
      const bodyContent = (body.html ?? '') + (body.text ?? '');
      // Link must include the token
      expect(bodyContent).toContain(TOKEN);
      // Link must start from the web app base URL
      expect(bodyContent).toContain(WEB_APP_BASE_URL);
    });

    it('sends Content-Type application/json', async () => {
      http.post.mockReturnValue(of(axiosOk({ id: 'email-id-1' })));

      await provider.sendEmailVerification(TO, TOKEN);

      const [, , config] = http.post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];
      expect(config.headers['Content-Type']).toBe('application/json');
    });

    it('resolves without throwing on a 2xx response', async () => {
      http.post.mockReturnValue(of(axiosOk({ id: 'email-id-1' })));

      await expect(
        provider.sendEmailVerification(TO, TOKEN),
      ).resolves.toBeUndefined();
    });

    it('throws a descriptive error on non-2xx response', async () => {
      const axiosErr = Object.assign(new Error('Unprocessable Entity'), {
        response: {
          status: 422,
          data: { name: 'validation_error', message: 'Invalid "to" field' },
        },
        isAxiosError: true,
      });
      http.post.mockReturnValue(throwError(() => axiosErr));

      await expect(provider.sendEmailVerification(TO, TOKEN)).rejects.toThrow(
        /Invalid "to" field/,
      );
    });

    it('re-throws non-Resend errors as-is', async () => {
      http.post.mockReturnValue(throwError(() => new Error('Network timeout')));

      await expect(provider.sendEmailVerification(TO, TOKEN)).rejects.toThrow(
        'Network timeout',
      );
    });
  });

  // ── sendLoginOtp ─────────────────────────────────────────────────────────

  describe('sendLoginOtp', () => {
    const TO = 'bob@example.com';
    const OTP = '847362';

    it('POSTs to https://api.resend.com/emails', async () => {
      http.post.mockReturnValue(of(axiosOk({ id: 'email-id-2' })));

      await provider.sendLoginOtp(TO, OTP);

      expect(http.post).toHaveBeenCalledTimes(1);
      const [url] = http.post.mock.calls[0] as [string, unknown, unknown];
      expect(url).toBe(RESEND_BASE_URL);
    });

    it('sends Authorization: Bearer {RESEND_API_KEY} header', async () => {
      http.post.mockReturnValue(of(axiosOk({ id: 'email-id-2' })));

      await provider.sendLoginOtp(TO, OTP);

      const [, , config] = http.post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];
      expect(config.headers['Authorization']).toBe(`Bearer ${RESEND_API_KEY}`);
    });

    it('sends from EMAIL_FROM config value', async () => {
      http.post.mockReturnValue(of(axiosOk({ id: 'email-id-2' })));

      await provider.sendLoginOtp(TO, OTP);

      const [, body] = http.post.mock.calls[0] as [
        string,
        { from: string; to: string; subject: string; html: string },
        unknown,
      ];
      expect(body.from).toBe(EMAIL_FROM);
    });

    it('sends to the recipient address', async () => {
      http.post.mockReturnValue(of(axiosOk({ id: 'email-id-2' })));

      await provider.sendLoginOtp(TO, OTP);

      const [, body] = http.post.mock.calls[0] as [
        string,
        { from: string; to: string; subject: string; html: string },
        unknown,
      ];
      expect(body.to).toBe(TO);
    });

    it('sends a non-empty subject', async () => {
      http.post.mockReturnValue(of(axiosOk({ id: 'email-id-2' })));

      await provider.sendLoginOtp(TO, OTP);

      const [, body] = http.post.mock.calls[0] as [
        string,
        { from: string; to: string; subject: string; html: string },
        unknown,
      ];
      expect(typeof body.subject).toBe('string');
      expect(body.subject.length).toBeGreaterThan(0);
    });

    it('includes the OTP in html or text body', async () => {
      http.post.mockReturnValue(of(axiosOk({ id: 'email-id-2' })));

      await provider.sendLoginOtp(TO, OTP);

      const [, body] = http.post.mock.calls[0] as [
        string,
        {
          from: string;
          to: string;
          subject: string;
          html: string;
          text?: string;
        },
        unknown,
      ];
      const bodyContent = (body.html ?? '') + (body.text ?? '');
      expect(bodyContent).toContain(OTP);
    });

    it('resolves without throwing on a 2xx response', async () => {
      http.post.mockReturnValue(of(axiosOk({ id: 'email-id-2' })));

      await expect(provider.sendLoginOtp(TO, OTP)).resolves.toBeUndefined();
    });

    it('throws a descriptive error on non-2xx response including Resend message', async () => {
      const axiosErr = Object.assign(new Error('Too Many Requests'), {
        response: {
          status: 429,
          data: { name: 'rate_limit_exceeded', message: 'Rate limit exceeded' },
        },
        isAxiosError: true,
      });
      http.post.mockReturnValue(throwError(() => axiosErr));

      await expect(provider.sendLoginOtp(TO, OTP)).rejects.toThrow(
        /Rate limit exceeded/,
      );
    });

    it('error thrown on non-2xx includes HTTP status code', async () => {
      const axiosErr = Object.assign(new Error('Unauthorized'), {
        response: {
          status: 401,
          data: { name: 'unauthorized', message: 'Invalid API key' },
        },
        isAxiosError: true,
      });
      http.post.mockReturnValue(throwError(() => axiosErr));

      await expect(provider.sendLoginOtp(TO, OTP)).rejects.toThrow(/401/);
    });

    it('re-throws non-Resend errors as-is', async () => {
      http.post.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

      await expect(provider.sendLoginOtp(TO, OTP)).rejects.toThrow(
        'ECONNREFUSED',
      );
    });
  });
});
