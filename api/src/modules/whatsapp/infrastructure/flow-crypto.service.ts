/**
 * Infrastructure: WhatsApp Flows E2E crypto implementation.
 *
 * Implements `IFlowCrypto` using Node `crypto` only — no third-party libs.
 * Crypto steps match Meta's official reference (WhatsApp-Flows-Tools encryption.js).
 *
 * Reads `WHATSAPP_FLOW_PRIVATE_KEY` (RSA private key PEM) from ConfigService.
 * The value may be stored with literal `\n` in .env — normalised here.
 */

import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  IFlowCrypto,
  FlowEncryptedBody,
  FlowDecryptResult,
} from '../application/ports/flow-crypto.port';
import {
  FlowDecryptError,
  FlowKeyNotConfiguredError,
} from '../domain/flow-errors';

@Injectable()
export class FlowCryptoService implements IFlowCrypto {
  constructor(private readonly config: ConfigService) {}

  // ---------------------------------------------------------------------------
  // IFlowCrypto — decrypt
  // ---------------------------------------------------------------------------

  /**
   * Decrypts a WhatsApp Flows data-exchange request body.
   *
   * Steps (exact crypto — must match Meta's reference):
   *   1. RSA-OAEP-SHA256 unwrap the AES key with the operator private key.
   *   2. Split ciphertext (all-but-last-16) from the GCM auth tag (last 16 bytes).
   *   3. AES-128-GCM decrypt; setAuthTag so GCM integrity is verified.
   *   4. JSON.parse the UTF-8 result.
   *
   * @throws {FlowKeyNotConfiguredError} when the private key env var is missing.
   * @throws {FlowDecryptError} on any RSA/AES failure (including auth-tag mismatch).
   */
  decryptRequest(body: FlowEncryptedBody): FlowDecryptResult {
    const rawPem = this.config.get<string>('WHATSAPP_FLOW_PRIVATE_KEY') ?? '';
    // Accept PEMs stored with literal `\n` (common in .env files).
    const privateKeyPem = rawPem.replace(/\\n/g, '\n').trim();

    if (!privateKeyPem) {
      throw new FlowKeyNotConfiguredError();
    }

    try {
      // Step 1 — RSA-OAEP-SHA256 unwrap AES key.
      const aesKey = crypto.privateDecrypt(
        {
          key: privateKeyPem,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        Buffer.from(body.encrypted_aes_key, 'base64'),
      );

      // Step 2 — decode IV and split ciphertext + GCM auth tag.
      const iv = Buffer.from(body.initial_vector, 'base64');
      const flowData = Buffer.from(body.encrypted_flow_data, 'base64');
      const TAG_LENGTH = 16;
      const cipherBody = flowData.subarray(0, -TAG_LENGTH);
      const tag = flowData.subarray(-TAG_LENGTH);

      // Step 3 — AES-128-GCM decrypt (GCM verifies integrity via auth tag).
      const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv);
      decipher.setAuthTag(tag);
      const decryptedBuf = Buffer.concat([
        decipher.update(cipherBody),
        decipher.final(),
      ]);

      // Step 4 — parse JSON.
      const decrypted = JSON.parse(decryptedBuf.toString('utf-8')) as unknown;

      return { decrypted, aesKey, iv };
    } catch (err) {
      if (err instanceof FlowKeyNotConfiguredError) throw err;
      throw new FlowDecryptError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // IFlowCrypto — encrypt
  // ---------------------------------------------------------------------------

  /**
   * Encrypts a response object to send back to the WhatsApp Flows client.
   *
   * Steps (exact crypto — must match Meta's reference):
   *   4. Bit-flip every byte of the IV: `~b` (bitwise NOT).
   *   5. AES-128-GCM encrypt with SAME key + flipped IV.
   *   6. Concatenate ciphertext + 16-byte GCM auth tag → base64.
   *
   * Returns a raw base64 string — the controller (6.2) sends it as-is
   * as the HTTP 200 body (text, NOT JSON-wrapped).
   */
  encryptResponse(response: unknown, aesKey: Buffer, iv: Buffer): string {
    // Step 4 — bit-flip the IV (bitwise NOT each byte).
    const flippedIv = Buffer.from(iv.map((b) => ~b & 0xff));

    // Step 5 — AES-128-GCM encrypt.
    const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, flippedIv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(response), 'utf-8'),
      cipher.final(),
    ]);

    // Step 6 — ciphertext + tag → base64.
    const tag = cipher.getAuthTag();
    return Buffer.concat([encrypted, tag]).toString('base64');
  }
}
