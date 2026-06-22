import * as nodeCrypto from 'crypto';

import { hmacHex, verifyHmacHeader } from './hmac';

const KEY = 'test-secret-key';
const BODY = Buffer.from('{"object":"whatsapp_business_account"}');

/**
 * Compute the reference digest inline so the test doubles as a determinism
 * assertion — if the implementation diverges the vector breaks.
 */
function referenceHmac(
  algo: 'sha256' | 'sha512',
  key: string,
  data: Buffer | string,
): string {
  return nodeCrypto.createHmac(algo, key).update(data).digest('hex');
}

describe('hmacHex', () => {
  it('returns correct sha256 hex for a Buffer payload', () => {
    const expected = referenceHmac('sha256', KEY, BODY);
    expect(hmacHex('sha256', KEY, BODY)).toBe(expected);
  });

  it('returns correct sha256 hex for a string payload', () => {
    const payload = 'hello world';
    const expected = referenceHmac('sha256', KEY, payload);
    expect(hmacHex('sha256', KEY, payload)).toBe(expected);
  });

  it('returns correct sha512 hex (Blockradar webhook path)', () => {
    const expected = referenceHmac('sha512', KEY, BODY);
    expect(hmacHex('sha512', KEY, BODY)).toBe(expected);
  });

  it('returns lowercase hex only', () => {
    const result = hmacHex('sha256', KEY, BODY);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  /**
   * Hardcoded reference vector generated externally so the test is not purely
   * circular. Produced with Node:
   *   require('crypto').createHmac('sha256','secret').update('ping').digest('hex')
   * → 6731b226e7fde8e1e3a4ce7adada71afb5ace634bf717d65f7ebeb9cf2b7fef1
   */
  it('matches a known external vector (sha256, key=secret, data=ping)', () => {
    expect(hmacHex('sha256', 'secret', 'ping')).toBe(
      '6731b226e7fde8e1e3a4ce7adada71afb5ace634bf717d65f7ebeb9cf2b7fef1',
    );
  });
});

describe('verifyHmacHeader', () => {
  function makeHeader(
    algo: 'sha256' | 'sha512' = 'sha256',
    key = KEY,
    body: Buffer = BODY,
    prefix = 'sha256=',
  ): string {
    return `${prefix}${hmacHex(algo, key, body)}`;
  }

  it('returns true for a correctly-signed body', () => {
    const header = makeHeader();
    expect(verifyHmacHeader('sha256', KEY, BODY, header)).toBe(true);
  });

  it('returns false for a tampered body', () => {
    const header = makeHeader();
    const tampered = Buffer.from('{"object":"tampered"}');
    expect(verifyHmacHeader('sha256', KEY, tampered, header)).toBe(false);
  });

  it('returns false for a wrong key', () => {
    const header = makeHeader('sha256', 'different-key');
    expect(verifyHmacHeader('sha256', KEY, BODY, header)).toBe(false);
  });

  it('returns false for a missing/undefined header', () => {
    expect(verifyHmacHeader('sha256', KEY, BODY, undefined)).toBe(false);
  });

  it('returns false for an empty header string', () => {
    expect(verifyHmacHeader('sha256', KEY, BODY, '')).toBe(false);
  });

  it('returns false for a garbage header (no prefix)', () => {
    expect(verifyHmacHeader('sha256', KEY, BODY, 'garbage')).toBe(false);
  });

  it('returns false for a header with the correct prefix but garbage hex', () => {
    expect(verifyHmacHeader('sha256', KEY, BODY, 'sha256=notvalidhex!!')).toBe(
      false,
    );
  });

  it('returns false when the hex after the prefix is the wrong length', () => {
    // sha256 produces 64 hex chars; 63 chars should fail length check
    const short = 'sha256=' + 'a'.repeat(63);
    expect(verifyHmacHeader('sha256', KEY, BODY, short)).toBe(false);
  });

  it('accepts a custom prefix (for sha512 / Blockradar path)', () => {
    const header = makeHeader('sha512', KEY, BODY, 'sha512=');
    expect(verifyHmacHeader('sha512', KEY, BODY, header, 'sha512=')).toBe(true);
  });

  it('never throws on any input (returns false instead)', () => {
    // Passing null through an `any`-annotated boundary to verify defensive coding.

    expect(() =>
      verifyHmacHeader('sha256', KEY, BODY, null as any),
    ).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- boundary test
    expect(verifyHmacHeader('sha256', KEY, BODY, null as any)).toBe(false);
  });
});
