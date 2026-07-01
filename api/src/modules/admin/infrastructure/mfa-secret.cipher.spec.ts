import { MfaSecretCipher } from './mfa-secret.cipher';

const KEY_HEX = '0'.repeat(64);
const SECRET = 'JBSWY3DPEHPK3PXP';

describe('MfaSecretCipher', () => {
  const cipher = new MfaSecretCipher(KEY_HEX);

  it('round-trips a TOTP secret through encrypt/decrypt', () => {
    const payload = cipher.encrypt(SECRET);
    expect(cipher.decrypt(payload)).toBe(SECRET);
  });

  it('produces ciphertext that differs from the plaintext', () => {
    const payload = cipher.encrypt(SECRET);
    expect(payload).not.toContain(SECRET);
  });

  it('throws when the ciphertext has been tampered with', () => {
    const [iv, tag, ct] = cipher.encrypt(SECRET).split(':');
    const flipped = ct.slice(0, -1) + (ct.endsWith('0') ? '1' : '0');
    expect(() => cipher.decrypt(`${iv}:${tag}:${flipped}`)).toThrow();
  });

  it('throws when the auth tag has been tampered with', () => {
    const [iv, tag, ct] = cipher.encrypt(SECRET).split(':');
    const flipped = tag.slice(0, -1) + (tag.endsWith('0') ? '1' : '0');
    expect(() => cipher.decrypt(`${iv}:${flipped}:${ct}`)).toThrow();
  });

  it('throws on a malformed payload', () => {
    expect(() => cipher.decrypt('only-one-part')).toThrow();
  });

  it('throws when constructed with a key that is not 64 hex chars', () => {
    expect(() => new MfaSecretCipher('0'.repeat(10))).toThrow();
  });
});
