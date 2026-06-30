import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  ADMIN_USER_REPOSITORY,
  type IAdminUserRepository,
} from './ports/admin-user.repository.port';
import { TOTP_PROVIDER, type ITotpProvider } from './ports/totp.port';
import {
  PASSWORD_HASHER,
  type IPasswordHasher,
} from './ports/password-hasher.port';
import { MFA_CIPHER, type IMfaCipher } from './ports/mfa-cipher.port';

const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_BYTES = 5;

/** The minimal MFA-bearing view of an admin user this service verifies against. */
export interface MfaVerifiable {
  id: string;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  mfaRecoveryCodes: string[];
}

/**
 * Admin MFA (TOTP) enrollment + login verification. The TOTP secret is stored
 * encrypted at rest (AES-256-GCM via MfaSecretCipher, key from ADMIN_MFA_ENC_KEY)
 * and recovery codes are stored hashed (via the password hasher). The plaintext
 * recovery codes are shown exactly once, at enrollment.
 */
@Injectable()
export class AdminMfaService {
  constructor(
    @Inject(ADMIN_USER_REPOSITORY)
    private readonly userRepo: IAdminUserRepository,
    @Inject(TOTP_PROVIDER)
    private readonly totp: ITotpProvider,
    @Inject(PASSWORD_HASHER)
    private readonly hasher: IPasswordHasher,
    @Inject(MFA_CIPHER)
    private readonly cipher: IMfaCipher,
  ) {}

  async enroll(
    adminId: string,
    adminEmail: string,
  ): Promise<{ otpauthUri: string; recoveryCodes: string[] }> {
    const secret = this.totp.generateSecret();
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      randomBytes(RECOVERY_CODE_BYTES).toString('hex'),
    );
    const hashedCodes = await Promise.all(
      recoveryCodes.map((code) => this.hasher.hash(code)),
    );
    const encSecret = this.cipher.encrypt(secret);
    await this.userRepo.enableMfa(adminId, encSecret, hashedCodes);
    return {
      otpauthUri: this.totp.keyUri(adminEmail, secret),
      recoveryCodes,
    };
  }

  async verifyForLogin(
    user: MfaVerifiable,
    totp?: string,
    recoveryCode?: string,
  ): Promise<boolean> {
    if (totp) {
      if (!user.mfaSecret) return false;
      const secret = this.cipher.decrypt(user.mfaSecret);
      return this.totp.verify(totp, secret);
    }
    if (recoveryCode) {
      return this.consumeRecoveryCode(user, recoveryCode);
    }
    return false;
  }

  private async consumeRecoveryCode(
    user: MfaVerifiable,
    recoveryCode: string,
  ): Promise<boolean> {
    let matchedHash: string | null = null;
    for (const codeHash of user.mfaRecoveryCodes) {
      if (await this.hasher.verify(codeHash, recoveryCode)) {
        matchedHash = codeHash;
        break;
      }
    }
    if (matchedHash === null) return false;
    return this.userRepo.consumeRecoveryCode(
      user.id,
      (codeHash) => codeHash === matchedHash,
    );
  }
}
