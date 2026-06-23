import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';

import { CloudApiSender } from './cloud-api.sender';
import type { Env } from '../../../core/config/env.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ConfigService<Env, true> stub for unit tests. */
function makeConfig(overrides: Partial<Env> = {}): ConfigService<Env, true> {
  const env: Partial<Env> = {
    WHATSAPP_GRAPH_BASE_URL: 'https://graph.facebook.com',
    WHATSAPP_GRAPH_VERSION: 'v25.0',
    WHATSAPP_PHONE_NUMBER_ID: 'TEST_PHONE_ID',
    WHATSAPP_ACCESS_TOKEN: 'TEST_TOKEN',
    ...overrides,
  };
  return {
    get: <K extends keyof Env>(key: K) => env[key],
  } as unknown as ConfigService<Env, true>;
}

/** Wrap a value in the AxiosResponse shape HttpService.post emits. */
function axiosResponse<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: {} as never },
  };
}

const SUCCESS_RESPONSE = {
  messaging_product: 'whatsapp',
  contacts: [{ input: '2348000000000', wa_id: '2348000000000' }],
  messages: [{ id: 'wamid.abc123' }],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CloudApiSender', () => {
  let httpService: jest.Mocked<HttpService>;
  let sender: CloudApiSender;

  beforeEach(() => {
    httpService = { post: jest.fn() } as unknown as jest.Mocked<HttpService>;
    sender = new CloudApiSender(httpService, makeConfig());
  });

  // -------------------------------------------------------------------------
  // sendText
  // -------------------------------------------------------------------------

  describe('sendText', () => {
    it('posts to the correct URL with bearer header and text body shape', async () => {
      httpService.post.mockReturnValue(of(axiosResponse(SUCCESS_RESPONSE)));

      const result = await sender.sendText('2348000000000', 'Hello!');

      expect(result).toEqual({ externalMessageId: 'wamid.abc123' });

      expect(httpService.post).toHaveBeenCalledTimes(1);
      const [url, body, config] = httpService.post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];

      expect(url).toBe(
        'https://graph.facebook.com/v25.0/TEST_PHONE_ID/messages',
      );
      expect(body).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '2348000000000',
        type: 'text',
        text: { preview_url: false, body: 'Hello!' },
      });
      expect(config.headers['Authorization']).toBe('Bearer TEST_TOKEN');
      expect(config.headers['Content-Type']).toBe('application/json');
    });

    it('returns the wamid from messages[0].id', async () => {
      const response = { ...SUCCESS_RESPONSE, messages: [{ id: 'wamid.XYZ' }] };
      httpService.post.mockReturnValue(of(axiosResponse(response)));

      const result = await sender.sendText('2341111111111', 'Hi');

      expect(result.externalMessageId).toBe('wamid.XYZ');
    });
  });

  // -------------------------------------------------------------------------
  // sendTemplate
  // -------------------------------------------------------------------------

  describe('sendTemplate', () => {
    it('posts the template body shape and returns the wamid', async () => {
      httpService.post.mockReturnValue(of(axiosResponse(SUCCESS_RESPONSE)));

      const result = await sender.sendTemplate(
        '2348000000000',
        'hello_world',
        'en_US',
      );

      expect(result).toEqual({ externalMessageId: 'wamid.abc123' });

      const [url, body] = httpService.post.mock.calls[0] as [string, unknown];

      expect(url).toBe(
        'https://graph.facebook.com/v25.0/TEST_PHONE_ID/messages',
      );
      expect(body).toEqual({
        messaging_product: 'whatsapp',
        to: '2348000000000',
        type: 'template',
        template: {
          name: 'hello_world',
          language: { code: 'en_US' },
        },
      });
    });

    it('includes components in the body when provided', async () => {
      httpService.post.mockReturnValue(of(axiosResponse(SUCCESS_RESPONSE)));

      const components = [
        { type: 'body', parameters: [{ type: 'text', text: 'World' }] },
      ];
      await sender.sendTemplate(
        '2348000000000',
        'my_template',
        'en_GB',
        components,
      );

      const [, body] = httpService.post.mock.calls[0] as [string, unknown];
      expect(
        (body as { template: { components: unknown } }).template.components,
      ).toEqual(components);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws a descriptive error when the API returns an error payload', async () => {
      const apiError = {
        error: {
          message: 'Invalid parameter',
          type: 'OAuthException',
          code: 100,
          error_data: {},
        },
      };
      // Cloud API sometimes returns 400 via axios rejection
      const axiosErr = Object.assign(
        new Error('Request failed with status code 400'),
        {
          response: {
            data: apiError,
            status: 400,
          },
          isAxiosError: true,
        },
      );
      httpService.post.mockReturnValue(throwError(() => axiosErr));

      await expect(sender.sendText('2348000000000', 'Hello')).rejects.toThrow(
        /Invalid parameter/,
      );
    });

    it('error message includes the API error code', async () => {
      const apiError = {
        error: {
          message: 'Unauthorized',
          type: 'OAuthException',
          code: 190,
        },
      };
      const axiosErr = Object.assign(
        new Error('Request failed with status code 401'),
        {
          response: { data: apiError, status: 401 },
          isAxiosError: true,
        },
      );
      httpService.post.mockReturnValue(throwError(() => axiosErr));

      await expect(sender.sendText('2348000000000', 'Hello')).rejects.toThrow(
        /190/,
      );
    });

    it('re-throws non-API errors as-is', async () => {
      httpService.post.mockReturnValue(
        throwError(() => new Error('Network timeout')),
      );

      await expect(sender.sendText('2348000000000', 'Hello')).rejects.toThrow(
        'Network timeout',
      );
    });
  });

  // -------------------------------------------------------------------------
  // sendCtaUrl
  // -------------------------------------------------------------------------

  describe('sendCtaUrl', () => {
    it('posts the exact interactive cta_url body shape and returns the wamid', async () => {
      httpService.post.mockReturnValue(of(axiosResponse(SUCCESS_RESPONSE)));

      const result = await sender.sendCtaUrl({
        to: '2348000000000',
        body: 'Verify your identity to start transacting.',
        buttonText: 'Verify now',
        url: 'https://app.example.com/kyc?t=abc123token',
      });

      expect(result).toEqual({ externalMessageId: 'wamid.abc123' });

      expect(httpService.post).toHaveBeenCalledTimes(1);
      const [url, body, config] = httpService.post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];

      expect(url).toBe(
        'https://graph.facebook.com/v25.0/TEST_PHONE_ID/messages',
      );
      expect(body).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '2348000000000',
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: 'Verify your identity to start transacting.' },
          action: {
            name: 'cta_url',
            parameters: {
              display_text: 'Verify now',
              url: 'https://app.example.com/kyc?t=abc123token',
            },
          },
        },
      });
      expect(config.headers['Authorization']).toBe('Bearer TEST_TOKEN');
      expect(config.headers['Content-Type']).toBe('application/json');
    });

    it('returns the wamid from messages[0].id', async () => {
      const response = {
        ...SUCCESS_RESPONSE,
        messages: [{ id: 'wamid.cta.XYZ' }],
      };
      httpService.post.mockReturnValue(of(axiosResponse(response)));

      const result = await sender.sendCtaUrl({
        to: '2348000000000',
        body: 'Verify now',
        buttonText: 'Verify',
        url: 'https://app.example.com/kyc?t=tok',
      });

      expect(result.externalMessageId).toBe('wamid.cta.XYZ');
    });

    it('uses the same base URL and auth header as sendText', async () => {
      httpService.post.mockReturnValue(of(axiosResponse(SUCCESS_RESPONSE)));

      await sender.sendCtaUrl({
        to: '2348000000000',
        body: 'body',
        buttonText: 'btn',
        url: 'https://app.example.com/kyc?t=tok',
      });

      const [url, , config] = httpService.post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];
      expect(url).toBe(
        'https://graph.facebook.com/v25.0/TEST_PHONE_ID/messages',
      );
      expect(config.headers['Authorization']).toBe('Bearer TEST_TOKEN');
    });
  });

  // -------------------------------------------------------------------------
  // sendFlow
  // -------------------------------------------------------------------------

  describe('sendFlow', () => {
    it('posts the exact interactive/flow body shape and returns the wamid', async () => {
      httpService.post.mockReturnValue(of(axiosResponse(SUCCESS_RESPONSE)));

      const result = await sender.sendFlow({
        to: '2348000000000',
        flowId: 'flow-id-123',
        flowToken: 'signed.token.abc',
        cta: 'Confirm',
        screen: 'CONFIRM',
        data: {
          proposalId: 'proposal-id-1',
          asset: 'USDT',
          cryptoAmount: '3.0625',
          fiatAmount: '5000',
          processingFeeAmount: '25.00',
          totalFiat: '5025.00',
          nonce: 'abc123nonce',
        },
      });

      expect(result).toEqual({ externalMessageId: 'wamid.abc123' });

      expect(httpService.post).toHaveBeenCalledTimes(1);
      const [url, body, config] = httpService.post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];

      expect(url).toBe(
        'https://graph.facebook.com/v25.0/TEST_PHONE_ID/messages',
      );
      expect(body).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '2348000000000',
        type: 'interactive',
        interactive: {
          type: 'flow',
          body: { text: expect.any(String) as unknown },
          action: {
            name: 'flow',
            parameters: {
              flow_message_version: '3',
              flow_token: 'signed.token.abc',
              flow_id: 'flow-id-123',
              flow_cta: 'Confirm',
              flow_action: 'navigate',
              flow_action_payload: {
                screen: 'CONFIRM',
                data: {
                  proposalId: 'proposal-id-1',
                  asset: 'USDT',
                  cryptoAmount: '3.0625',
                  fiatAmount: '5000',
                  processingFeeAmount: '25.00',
                  totalFiat: '5025.00',
                  nonce: 'abc123nonce',
                },
              },
            },
          },
        },
      });
      expect(config.headers['Authorization']).toBe('Bearer TEST_TOKEN');
      expect(config.headers['Content-Type']).toBe('application/json');
    });

    it('returns the wamid from messages[0].id', async () => {
      const response = {
        ...SUCCESS_RESPONSE,
        messages: [{ id: 'wamid.flow.XYZ' }],
      };
      httpService.post.mockReturnValue(of(axiosResponse(response)));

      const result = await sender.sendFlow({
        to: '2341111111111',
        flowId: 'flow-abc',
        flowToken: 'tok',
        cta: 'Go',
        screen: 'CONFIRM',
        data: {},
      });

      expect(result.externalMessageId).toBe('wamid.flow.XYZ');
    });

    it('uses the same base URL and auth header as sendText', async () => {
      httpService.post.mockReturnValue(of(axiosResponse(SUCCESS_RESPONSE)));

      await sender.sendFlow({
        to: '2348000000000',
        flowId: 'fid',
        flowToken: 'tok',
        cta: 'Ok',
        screen: 'S1',
        data: {},
      });

      const [url, , config] = httpService.post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];
      expect(url).toBe(
        'https://graph.facebook.com/v25.0/TEST_PHONE_ID/messages',
      );
      expect(config.headers['Authorization']).toBe('Bearer TEST_TOKEN');
    });
  });
});
