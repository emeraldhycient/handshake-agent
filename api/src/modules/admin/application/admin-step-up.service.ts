import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AdminInvalidCredentialsError,
  AdminStepUpRequiredError,
} from '../domain/admin-errors';
import { AdminMfaService } from './admin-mfa.service';
import {
  ADMIN_SESSION_REPOSITORY,
  type IAdminSessionRepository,
} from './ports/admin-session.repository.port';
import {
  ADMIN_USER_REPOSITORY,
  type AdminUserRecord,
  type IAdminUserRepository,
} from './ports/admin-user.repository.port';
import {
  PASSWORD_HASHER,
  type IPasswordHasher,
} from './ports/password-hasher.port';
import type { Env } from '../../../core/config/env.schema';

/** The credentialed view of an admin (the record plus its stored password hash). */
type AdminUserWithPassword = AdminUserRecord & { passwordHash: string };

export interface AdminStepUpInput {
  adminId: string;
  sessionId: string;
  password?: string;
  totp?: string;
}

/**
 * Admin step-up (re-auth) for sensitive actions. `challenge` re-verifies the
 * admin via password or TOTP and stamps the session; `assertFresh` is the
 * fail-closed gate — a missing or stale step-up throws AdminStepUpRequiredError
 * (mirrors the user-side SessionService.assertStepUpFresh, §3.4).
 */
@Injectable()
export class AdminStepUpService {
  constructor(
    @Inject(ADMIN_SESSION_REPOSITORY)
    private readonly sessionRepo: IAdminSessionRepository,
    @Inject(ADMIN_USER_REPOSITORY)
    private readonly userRepo: IAdminUserRepository,
    @Inject(PASSWORD_HASHER)
    private readonly hasher: IPasswordHasher,
    private readonly mfa: AdminMfaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private ttlMs(): number {
    return this.config.get('ADMIN_STEP_UP_TTL_SECONDS', { infer: true }) * 1000;
  }

  async challenge(input: AdminStepUpInput, now: Date): Promise<void> {
    const user = (await this.userRepo.findById(
      input.adminId,
    )) as AdminUserWithPassword | null;
    if (user === null) throw new AdminInvalidCredentialsError();

    const ok = input.password
      ? await this.hasher.verify(user.passwordHash, input.password)
      : input.totp
        ? await this.mfa.verifyForLogin(user, input.totp)
        : false;

    if (!ok) throw new AdminInvalidCredentialsError();
    await this.sessionRepo.recordStepUp(input.sessionId, now);
  }

  async assertFresh(sessionId: string, now: Date): Promise<void> {
    const session = await this.sessionRepo.findById(sessionId);
    if (session === null || session.stepUpCompletedAt === null) {
      throw new AdminStepUpRequiredError();
    }
    const ageMs = now.getTime() - session.stepUpCompletedAt.getTime();
    if (ageMs > this.ttlMs()) {
      throw new AdminStepUpRequiredError();
    }
  }
}
