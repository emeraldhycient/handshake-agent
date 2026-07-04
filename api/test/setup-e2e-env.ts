/**
 * Global e2e env defaults — applied (via jest-e2e.json `setupFiles`) before any
 * suite boots AppModule.
 *
 * NIN/BVN are encrypted at rest (AES-256-GCM field encryption); KycPrismaRepository
 * is fail-closed and throws if it must store an identifier without a key. The e2e
 * lane runs with KYC_MOCK_MODE=true (so the boot guard does not require the key),
 * but the repo still encrypts on write — so provide a deterministic 32-byte test
 * key here. `||=` leaves any explicitly-set value untouched.
 */
process.env.KYC_ENCRYPTION_KEY ||=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// ADMIN_MFA_ENC_KEY (AES-256-GCM, 64 hex chars) — AdminModule's MFA_CIPHER factory
// is instantiated eagerly whenever AppModule boots, and MfaSecretCipher throws on a
// non-64-hex key (the env default is empty). Any e2e that boots AppModule but does
// not set this key fails at module init; provide a deterministic test key here so
// the whole e2e lane can boot. `||=` leaves any explicitly-set value untouched.
process.env.ADMIN_MFA_ENC_KEY ||= '0'.repeat(64);
