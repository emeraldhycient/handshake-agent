import { authenticator } from 'otplib';

import { OtplibTotpAdapter } from './otplib-totp.adapter';

describe('OtplibTotpAdapter', () => {
  const adapter = new OtplibTotpAdapter();

  it('generates a usable base32 secret', () => {
    const secret = adapter.generateSecret();
    expect(secret.length).toBeGreaterThan(0);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  it('verifies a freshly generated token against the real library', () => {
    const secret = adapter.generateSecret();
    const token = authenticator.generate(secret);
    expect(adapter.verify(token, secret)).toBe(true);
  });

  it('rejects an incorrect token', () => {
    const secret = adapter.generateSecret();
    expect(adapter.verify('000000', secret)).toBe(false);
  });

  it('builds an otpauth URI carrying the Handshake Admin issuer and the email label', () => {
    const uri = adapter.keyUri('admin@example.com', adapter.generateSecret());
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('issuer=Handshake%20Admin');
    expect(uri).toContain('admin%40example.com');
  });
});
