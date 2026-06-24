/**
 * Unit tests for FlowCryptoService — WhatsApp Flows E2E encryption.
 *
 * TDD approach: these tests drive the implementation in flow-crypto.service.ts.
 * A real 2048-bit RSA keypair is generated once in beforeAll; no network needed.
 */

import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { FlowCryptoService } from './flow-crypto.service';
import {
  FlowDecryptError,
  FlowKeyNotConfiguredError,
} from '../domain/flow-errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mimics what Meta does server-side before sending the encrypted body:
 *   1. Generate a random 16-byte AES key + 16-byte IV.
 *   2. RSA-OAEP-SHA256 wrap the AES key with the *public* key.
 *   3. AES-128-GCM encrypt the plaintext; append the 16-byte GCM auth tag.
 *   4. Base64-encode all three values.
 */
function encryptLikeMeta(
  publicKeyPem: string,
  plaintext: unknown,
): {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
  /** kept for round-trip assertions */
  rawAesKey: Buffer;
  rawIv: Buffer;
} {
  const aesKey = crypto.randomBytes(16); // AES-128
  const iv = crypto.randomBytes(16);

  // RSA-OAEP-SHA256 wrap
  const encrypted_aes_key = crypto
    .publicEncrypt(
      {
        key: publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      aesKey,
    )
    .toString('base64');

  // AES-128-GCM encrypt
  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(plaintext), 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag(); // 16 bytes

  // Meta concatenates ciphertext + tag
  const encrypted_flow_data = Buffer.concat([body, tag]).toString('base64');
  const initial_vector = iv.toString('base64');

  return {
    encrypted_flow_data,
    encrypted_aes_key,
    initial_vector,
    rawAesKey: aesKey,
    rawIv: iv,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('FlowCryptoService', () => {
  let publicKeyPem: string;
  let privateKeyPem: string;
  let service: FlowCryptoService;

  beforeAll(() => {
    // Generate a real RSA keypair — no network, deterministic within the test run.
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    publicKeyPem = publicKey;
    privateKeyPem = privateKey;
  });

  beforeEach(() => {
    // Stub ConfigService to return the generated private key.
    const configStub = {
      get: (key: string) => {
        if (key === 'WHATSAPP_FLOW_PRIVATE_KEY') return privateKeyPem;
        return undefined;
      },
    } as unknown as ConfigService;

    service = new FlowCryptoService(configStub);
  });

  // -------------------------------------------------------------------------
  // Round-trip: decrypt → the original payload + key material
  // -------------------------------------------------------------------------
  it('decrypts a Meta-encrypted Flow request and returns the original object', () => {
    const payload = { version: '3.0', action: 'ping' };
    const encrypted = encryptLikeMeta(publicKeyPem, payload);

    const result = service.decryptRequest({
      encrypted_flow_data: encrypted.encrypted_flow_data,
      encrypted_aes_key: encrypted.encrypted_aes_key,
      initial_vector: encrypted.initial_vector,
    });

    expect(result.decrypted).toEqual(payload);
    expect(Buffer.isBuffer(result.aesKey)).toBe(true);
    expect(result.aesKey).toHaveLength(16);
    expect(Buffer.isBuffer(result.iv)).toBe(true);
    expect(result.iv).toHaveLength(16);
    // The returned key must match what Meta used.
    expect(result.aesKey).toEqual(encrypted.rawAesKey);
    expect(result.iv).toEqual(encrypted.rawIv);
  });

  // -------------------------------------------------------------------------
  // encryptResponse round-trip: same key, bit-flipped IV
  // -------------------------------------------------------------------------
  it('encryptResponse produces a base64 string that decrypts with the SAME key + flipped IV', () => {
    const payload = { version: '3.0', action: 'ping' };
    const encrypted = encryptLikeMeta(publicKeyPem, payload);

    const { aesKey, iv } = service.decryptRequest({
      encrypted_flow_data: encrypted.encrypted_flow_data,
      encrypted_aes_key: encrypted.encrypted_aes_key,
      initial_vector: encrypted.initial_vector,
    });

    const responsePayload = { data: { status: 'active' } };
    const encryptedResponse = service.encryptResponse(
      responsePayload,
      aesKey,
      iv,
    );

    // encryptedResponse is a raw base64 string (not JSON-wrapped).
    expect(typeof encryptedResponse).toBe('string');
    expect(() => Buffer.from(encryptedResponse, 'base64')).not.toThrow();

    // Verify: decrypt with the SAME key and the FLIPPED iv (mirrors what Meta's
    // client does when it receives our response).
    const flippedIv = Buffer.from(iv.map((b) => ~b & 0xff));
    const raw = Buffer.from(encryptedResponse, 'base64');
    const tag = raw.subarray(-16);
    const body = raw.subarray(0, -16);

    const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, flippedIv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(body),
      decipher.final(),
    ]).toString('utf-8');

    expect(JSON.parse(plaintext)).toEqual(responsePayload);
  });

  // -------------------------------------------------------------------------
  // Tampered data → FlowDecryptError (GCM auth tag mismatch)
  // -------------------------------------------------------------------------
  it('throws FlowDecryptError when encrypted_flow_data is tampered', () => {
    const payload = { version: '3.0', action: 'ping' };
    const encrypted = encryptLikeMeta(publicKeyPem, payload);

    // Flip a byte in the middle of the ciphertext to corrupt the GCM auth tag.
    const raw = Buffer.from(encrypted.encrypted_flow_data, 'base64');
    raw[0] ^= 0xff; // tamper the first byte
    const tampered = raw.toString('base64');

    expect(() =>
      service.decryptRequest({
        encrypted_flow_data: tampered,
        encrypted_aes_key: encrypted.encrypted_aes_key,
        initial_vector: encrypted.initial_vector,
      }),
    ).toThrow(FlowDecryptError);
  });

  // -------------------------------------------------------------------------
  // Empty private key → FlowKeyNotConfiguredError
  // -------------------------------------------------------------------------
  it('throws FlowKeyNotConfiguredError when WHATSAPP_FLOW_PRIVATE_KEY is empty', () => {
    const emptyKeyConfig = {
      get: (key: string) => {
        if (key === 'WHATSAPP_FLOW_PRIVATE_KEY') return '';
        return undefined;
      },
    } as unknown as ConfigService;

    const serviceWithNoKey = new FlowCryptoService(emptyKeyConfig);

    const payload = { version: '3.0', action: 'ping' };
    const encrypted = encryptLikeMeta(publicKeyPem, payload);

    expect(() =>
      serviceWithNoKey.decryptRequest({
        encrypted_flow_data: encrypted.encrypted_flow_data,
        encrypted_aes_key: encrypted.encrypted_aes_key,
        initial_vector: encrypted.initial_vector,
      }),
    ).toThrow(FlowKeyNotConfiguredError);
  });
});
