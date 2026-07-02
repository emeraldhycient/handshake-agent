import { randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../../../core/audit/application/audit.service';
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
    private readonly audit: AuditService,
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

  /**
   * Reset MFA for ANOTHER admin (a sensitive RBAC action): clear the target's
   * encrypted secret + recovery codes and set mfaEnabled=false. The target must
   * re-enroll to regain a second factor. Never reveals any secret; the immutable
   * audit annotation records who did it and why (§3.4 — RBAC mutations are
   * reason → step-up → audit; step-up + write permission are enforced at the
   * controller).
   */
  async resetForAdmin(
    targetAdminId: string,
    actorAdminId: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    await this.userRepo.disableMfa(targetAdminId);
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId,
      subject: `Admin:${targetAdminId}`,
      action: 'admin_override',
      details: { reason, at: now.toISOString() },
    });
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
