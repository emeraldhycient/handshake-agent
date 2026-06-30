import * as nodeCrypto from 'crypto';

import {
  decryptField,
  encryptField,
  FieldDecryptionError,
  FieldEncryptionKeyError,
} from './field-encryption';

// A 32-byte key expressed as 64 hex chars (the canonical KYC_ENCRYPTION_KEY form).
const HEX_KEY = 'a'.repeat(64);
// A 32-byte key expressed as a base64 string (also accepted).
const B64_KEY = Buffer.alloc(32, 7).toString('base64');
// A passphrase that is neither 64-hex nor 44-char-base64: derived via scrypt.
const PASSPHRASE = 'correct horse battery staple';

describe('encryptField / decryptField', () => {
  it('round-trips a plaintext through encrypt → decrypt (hex key)', () => {
    const plaintext = '12345678901'; // NIN-shaped
    const blob = encryptField(plaintext, HEX_KEY);
    expect(decryptField(blob, HEX_KEY)).toBe(plaintext);
  });

  it('round-trips with a base64 32-byte key', () => {
    const plaintext = '22222222222';
    const blob = encryptField(plaintext, B64_KEY);
    expect(decryptField(blob, B64_KEY)).toBe(plaintext);
  });

  it('round-trips with an arbitrary passphrase (scrypt-derived key)', () => {
    const plaintext = '98765432109';
    const blob = encryptField(plaintext, PASSPHRASE);
    expect(decryptField(blob, PASSPHRASE)).toBe(plaintext);
  });

  it('round-trips unicode and empty strings', () => {
    for (const plaintext of ['', 'ünïcödé ✓', 'a'.repeat(2000)]) {
      const blob = encryptField(plaintext, HEX_KEY);
      expect(decryptField(blob, HEX_KEY)).toBe(plaintext);
    }
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const plaintext = 'same-input';
    const a = encryptField(plaintext, HEX_KEY);
    const b = encryptField(plaintext, HEX_KEY);
    expect(a).not.toBe(b);
    // Both still decrypt to the same plaintext.
    expect(decryptField(a, HEX_KEY)).toBe(plaintext);
    expect(decryptField(b, HEX_KEY)).toBe(plaintext);
  });

  it('emits a versioned, dot-delimited blob (v1.iv.tag.ciphertext)', () => {
    const blob = encryptField('x', HEX_KEY);
    const segments = blob.split('.');
    expect(segments).toHaveLength(4);
    expect(segments[0]).toBe('v1');
    // iv (12 bytes), tag (16 bytes) base64-decode to fixed lengths.
    expect(Buffer.from(segments[1], 'base64')).toHaveLength(12);
    expect(Buffer.from(segments[2], 'base64')).toHaveLength(16);
  });

  // ---- Tamper detection (GCM auth tag) ----

  it('throws FieldDecryptionError when the ciphertext is tampered', () => {
    const blob = encryptField('sensitive', HEX_KEY);
    const [v, iv, tag, ct] = blob.split('.');
    // Flip a byte in the ciphertext.
    const ctBytes = Buffer.from(ct, 'base64');
    ctBytes[0] ^= 0xff;
    const tampered = [v, iv, tag, ctBytes.toString('base64')].join('.');
    expect(() => decryptField(tampered, HEX_KEY)).toThrow(FieldDecryptionError);
  });

  it('throws FieldDecryptionError when the auth tag is tampered', () => {
    const blob = encryptField('sensitive', HEX_KEY);
    const [v, iv, tag, ct] = blob.split('.');
    const tagBytes = Buffer.from(tag, 'base64');
    tagBytes[0] ^= 0xff;
    const tampered = [v, iv, tagBytes.toString('base64'), ct].join('.');
    expect(() => decryptField(tampered, HEX_KEY)).toThrow(FieldDecryptionError);
  });

  it('throws FieldDecryptionError when decrypting with the wrong key', () => {
    const blob = encryptField('sensitive', HEX_KEY);
    const wrongKey = 'b'.repeat(64);
    expect(() => decryptField(blob, wrongKey)).toThrow(FieldDecryptionError);
  });

  it('throws FieldDecryptionError on a malformed blob (wrong segment count)', () => {
    expect(() => decryptField('not-a-valid-blob', HEX_KEY)).toThrow(
      FieldDecryptionError,
    );
  });

  it('throws FieldDecryptionError on an unknown version prefix', () => {
    const blob = encryptField('x', HEX_KEY);
    const tampered = blob.replace(/^v1\./, 'v9.');
    expect(() => decryptField(tampered, HEX_KEY)).toThrow(FieldDecryptionError);
  });

  // ---- Key handling (fail-closed) ----

  it('throws FieldEncryptionKeyError when encrypting with an empty key', () => {
    expect(() => encryptField('x', '')).toThrow(FieldEncryptionKeyError);
  });

  it('throws FieldEncryptionKeyError when decrypting with an empty key', () => {
    const blob = encryptField('x', HEX_KEY);
    expect(() => decryptField(blob, '')).toThrow(FieldEncryptionKeyError);
  });

  it('is interoperable with a reference AES-256-GCM decryption (hex key)', () => {
    // Decrypt our blob with raw Node crypto to prove the wire format is standard.
    const plaintext = 'interop-check';
    const blob = encryptField(plaintext, HEX_KEY);
    const [, ivB64, tagB64, ctB64] = blob.split('.');
    const key = Buffer.from(HEX_KEY, 'hex');
    const decipher = nodeCrypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const out = Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]);
    expect(out.toString('utf8')).toBe(plaintext);
  });
});
