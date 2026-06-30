// Port for at-rest encryption of the admin TOTP secret. The application depends
// on this interface; the concrete AES-256-GCM cipher lives in infrastructure and
// is bound in the module (CLAUDE.md §4 — application never imports infrastructure).

export const MFA_CIPHER = Symbol('MFA_CIPHER');

export interface IMfaCipher {
  encrypt(plain: string): string;
  decrypt(payload: string): string;
}
