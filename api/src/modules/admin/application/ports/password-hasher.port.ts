/**
 * Port for admin-password hashing (Task 5). The application layer depends on
 * this interface; the infrastructure binding is Argon2PasswordHasher.
 *
 * The DI token PASSWORD_HASHER is injected by AdminModule.
 */

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

/** Hash/verify contract for admin passwords. */
export interface IPasswordHasher {
  /** Hashes a plaintext password, returning an encoded hash string. */
  hash(plain: string): Promise<string>;

  /** Verifies a plaintext password against an encoded hash. */
  verify(hash: string, plain: string): Promise<boolean>;
}
