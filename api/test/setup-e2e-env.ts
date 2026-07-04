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

/**
 * AdminModule (part of the full AppModule) constructs MfaSecretCipher at DI boot
 * via a useFactory; MfaSecretCipher is fail-closed and throws unless the key is a
 * 64-char hex string. Any suite that boots AppModule but omits this key would fail
 * in beforeAll before a single test runs. Provide a deterministic 64-char hex test
 * key here so every boot suite is covered. `||=` leaves any explicitly-set value
 * (e.g. the admin-*.e2e-spec.ts suites) untouched.
 */
process.env.ADMIN_MFA_ENC_KEY ||= 'a'.repeat(64);
