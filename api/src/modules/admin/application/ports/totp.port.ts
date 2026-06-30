/**
 * Port for admin TOTP (MFA) provisioning and verification (Task 5). The
 * application layer depends on this interface; the infrastructure binding is
 * OtplibTotpAdapter.
 *
 * The DI token TOTP_PROVIDER is injected by AdminModule.
 */

export const TOTP_PROVIDER = Symbol('TOTP_PROVIDER');

/** Provisioning/verification contract for TOTP-based MFA. */
export interface ITotpProvider {
  /** Generates a fresh base32-encoded TOTP secret. */
  generateSecret(): string;

  /** Builds an otpauth:// key URI for the given account email and secret. */
  keyUri(email: string, secret: string): string;

  /** Verifies a TOTP token against the secret. */
  verify(token: string, secret: string): boolean;
}
