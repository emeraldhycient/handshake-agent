/**
 * AES-256-GCM cipher for MFA (TOTP) secrets at rest (Task 5).
 *
 * The encryption key is a 32-byte value supplied as a 64-char hex string. The
 * payload format is `${ivHex}:${authTagHex}:${ciphertextHex}` — a random 12-byte
 * IV per encryption, plus the GCM auth tag that makes tampering detectable
 * (decrypt throws on a modified ciphertext or tag).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const KEY_HEX_LENGTH = KEY_BYTES * 2;

export class MfaSecretCipher {
  private readonly key: Buffer;

  constructor(private readonly keyHex: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(this.keyHex)) {
      throw new Error(
        `MfaSecretCipher requires a ${KEY_HEX_LENGTH}-char hex key (32 bytes)`,
      );
    }
    this.key = Buffer.from(this.keyHex, 'hex');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plain, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 3) {
      throw new Error('MfaSecretCipher: malformed payload');
    }
    const [ivHex, authTagHex, ciphertextHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');

    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
