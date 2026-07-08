import { sha256Hex } from '../../../core/crypto/hmac';
import {
  REDACTED_VALUE,
  redactStoredSignature,
  sanitizeWebhookHeaders,
  toStoredSignatureDigest,
} from './sanitize-webhook-headers';

describe('sanitizeWebhookHeaders', () => {
  it('redacts every secret-bearing header on the denylist', () => {
    const out = sanitizeWebhookHeaders({
      'verif-hash': 'the-static-flutterwave-secret',
      authorization: 'Bearer sk_live_abc',
      'proxy-authorization': 'Basic xyz',
      cookie: 'session=abc',
      'set-cookie': 'session=abc; HttpOnly',
      'x-api-key': 'key-123',
    });

    expect(out).toEqual({
      'verif-hash': REDACTED_VALUE,
      authorization: REDACTED_VALUE,
      'proxy-authorization': REDACTED_VALUE,
      cookie: REDACTED_VALUE,
      'set-cookie': REDACTED_VALUE,
      'x-api-key': REDACTED_VALUE,
    });
  });

  it('matches denylisted names case-insensitively', () => {
    const out = sanitizeWebhookHeaders({
      'Verif-Hash': 'secret',
      AUTHORIZATION: 'Bearer tok',
      'X-Api-Key': 'key',
    });

    expect(out).toEqual({
      'Verif-Hash': REDACTED_VALUE,
      AUTHORIZATION: REDACTED_VALUE,
      'X-Api-Key': REDACTED_VALUE,
    });
  });

  it('preserves non-secret headers, including per-request HMAC signatures', () => {
    const headers = {
      'content-type': 'application/json',
      'x-blockradar-signature': 'abc123hmac',
      'x-hub-signature-256': 'sha256=deadbeef',
      'user-agent': 'Flutterwave/1.0',
    };

    expect(sanitizeWebhookHeaders(headers)).toEqual(headers);
  });

  it('does not mutate the input record', () => {
    const headers: Record<string, unknown> = { 'verif-hash': 'secret' };
    sanitizeWebhookHeaders(headers);
    expect(headers['verif-hash']).toBe('secret');
  });

  it('returns an empty record for an empty record', () => {
    expect(sanitizeWebhookHeaders({})).toEqual({});
  });
});

describe('toStoredSignatureDigest', () => {
  it('returns a sha256:-prefixed hex digest, never the raw value', () => {
    const digest = toStoredSignatureDigest('the-static-secret');
    expect(digest).toBe(`sha256:${sha256Hex('the-static-secret')}`);
    expect(digest).not.toContain('the-static-secret');
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('redactStoredSignature', () => {
  it('passes null through', () => {
    expect(redactStoredSignature('flutterwave', null)).toBeNull();
  });

  it('keeps per-request HMAC signatures for blockradar/whatsapp', () => {
    expect(redactStoredSignature('blockradar', 'abc123hmac')).toBe(
      'abc123hmac',
    );
    expect(redactStoredSignature('whatsapp', 'sha256=deadbeef')).toBe(
      'sha256=deadbeef',
    );
  });

  it('redacts a legacy raw flutterwave signature (it IS the static secret)', () => {
    expect(redactStoredSignature('flutterwave', 'the-static-secret')).toBe(
      REDACTED_VALUE,
    );
  });

  it('keeps the non-reversible digest form for flutterwave', () => {
    const digest = toStoredSignatureDigest('the-static-secret');
    expect(redactStoredSignature('flutterwave', digest)).toBe(digest);
  });
});
