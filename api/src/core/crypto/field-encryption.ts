import * as crypto from 'crypto';

/**
 * Authenticated field-level encryption for sensitive at-rest values
 * (NFR-1: Nigerian national IDs — NIN/BVN — are NDPR-regulated PII and must
 * never be stored in plaintext).
 *
 * Algorithm: AES-256-GCM (Node `crypto`, no external dependency). GCM gives
 * confidentiality AND integrity — any tamper of ciphertext or auth tag fails
 * decryption (see {@link FieldDecryptionError}).
 *
 * Wire format (a single TEXT-column-friendly string, no schema migration):
 *
 *   v1.<iv-base64>.<authTag-base64>.<ciphertext-base64>
 *
 * The `v1` prefix is a version tag so the format can evolve (e.g. key rotation)
 * without ambiguity. IV is a fresh 12-byte random per call, so encrypting the
 * same plaintext twice yields different blobs.
 */

/** Current wire-format version. Bump on any incompatible format change. */
const VERSION = 'v1';
/** AES-256-GCM recommended IV size. */
const IV_BYTES = 12;
/** AES-256 requires a 32-byte key. */
const KEY_BYTES = 32;
const ALGORITHM = 'aes-256-gcm';
/** Fixed, non-secret scrypt salt — the secret is the configured key material. */
const KDF_SALT = 'handshake-agent.field-encryption.v1';

/**
 * Thrown when no key (or an empty key) is supplied. Fail-closed: we throw
 * rather than store/return plaintext (root CLAUDE.md §3.6 / NFR-1).
 */
export class FieldEncryptionKeyError extends Error {
  constructor(message = 'Field-encryption key is missing or empty') {
    super(message);
    this.name = 'FieldEncryptionKeyError';
  }
}

/**
 * Thrown when a blob cannot be decrypted: malformed format, unknown version,
 * wrong key, or a failed GCM auth tag (tampering). Never leaks which.
 */
export class FieldDecryptionError extends Error {
  constructor(message = 'Failed to decrypt field') {
    super(message);
    this.name = 'FieldDecryptionError';
  }
}

/**
 * Derives a 32-byte AES key from the configured key material.
 *
 * Accepts three forms, in priority order:
 *   1. 64 hex chars   → decoded directly as 32 raw bytes.
 *   2. 44-char base64 → decoded directly to 32 raw bytes (`Buffer.alloc(32)…`).
 *   3. anything else  → treated as a passphrase, stretched via scrypt.
 *
 * scrypt makes a short/weak passphrase usable while a properly-generated
 * 32-byte key (hex or base64) is used verbatim.
 */
function deriveKey(keyMaterial: string): Buffer {
  if (!keyMaterial) {
    throw new FieldEncryptionKeyError();
  }

  if (/^[0-9a-fA-F]{64}$/.test(keyMaterial)) {
    return Buffer.from(keyMaterial, 'hex');
  }

  const asB64 = Buffer.from(keyMaterial, 'base64');
  if (asB64.length === KEY_BYTES) {
    return asB64;
  }

  return crypto.scryptSync(keyMaterial, KDF_SALT, KEY_BYTES);
}

/**
 * Encrypts a UTF-8 plaintext into a `v1.iv.tag.ciphertext` blob.
 *
 * @throws {FieldEncryptionKeyError} if `keyMaterial` is empty.
 */
export function encryptField(plaintext: string, keyMaterial: string): string {
  const key = deriveKey(keyMaterial);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

/**
 * Decrypts a `v1.iv.tag.ciphertext` blob produced by {@link encryptField}.
 *
 * @throws {FieldEncryptionKeyError} if `keyMaterial` is empty.
 * @throws {FieldDecryptionError} on malformed input, unknown version, wrong
 *   key, or a failed GCM auth tag (tampering). The cause is never disclosed.
 */
export function decryptField(blob: string, keyMaterial: string): string {
  const key = deriveKey(keyMaterial);

  const segments = blob.split('.');
  if (segments.length !== 4) {
    throw new FieldDecryptionError('Malformed encrypted field');
  }

  const [version, ivB64, tagB64, ctB64] = segments;
  if (version !== VERSION) {
    throw new FieldDecryptionError(`Unsupported field-encryption version`);
  }

  try {
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(ctB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch {
    // GCM auth failure, bad key, or malformed segments all land here. Collapse
    // to one opaque error so callers cannot distinguish the cause (no oracle).
    throw new FieldDecryptionError();
  }
}
