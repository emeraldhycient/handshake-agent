import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AdminLoginResponse, AdminMe } from '@handshake-agent/contracts';

import {
  AdminAccountLockedError,
  AdminInactiveError,
  AdminInvalidCredentialsError,
  AdminMfaInvalidError,
  AdminMfaRequiredError,
  AdminNotFoundError,
} from '../domain/admin-errors';
import { AdminMfaService } from './admin-mfa.service';
import { resolveAdminDisplayName } from './admin-user.service';
import { AdminTokenService } from './admin-token.service';
import { AuthorizationService } from './authorization.service';
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
import {
  ROLE_REPOSITORY,
  type IRoleRepository,
} from './ports/role.repository.port';
import { AuditService } from '../../../core/audit/application/audit.service';

/** The credentialed view of an admin (the record plus its stored password hash). */
type AdminUserWithPassword = AdminUserRecord & { passwordHash: string };

export interface AdminLoginInput {
  email: string;
  password: string;
  totp?: string;
  recoveryCode?: string;
}

export interface AdminLoginContext {
  ip?: string;
  userAgent?: string;
}

// A well-formed argon2 hash that no real password verifies against — used for a
// constant-time dummy compare on an unknown email so login timing does not leak
// whether the account exists (§3.3 timing-safety).
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG';

/**
 * Admin authentication: password (+ optional MFA) login, logout, and the
 * resolved AdminMe view. Sessions store only the JWT's hash; the JWT subject is
 * the session id so the guard binds token ⇄ session. Every login/logout is
 * audited. RBAC still enforces server-side regardless of what AdminMe lists (§3.3).
 */
@Injectable()
export class AdminAuthService {
  private readonly maxAttempts: number;
  private readonly lockoutMs: number;

  constructor(
    @Inject(ADMIN_USER_REPOSITORY)
    private readonly userRepo: IAdminUserRepository,
    @Inject(ADMIN_SESSION_REPOSITORY)
    private readonly sessionRepo: IAdminSessionRepository,
    @Inject(PASSWORD_HASHER)
    private readonly hasher: IPasswordHasher,
    private readonly mfa: AdminMfaService,
    private readonly tokens: AdminTokenService,
    private readonly authz: AuthorizationService,
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepo: IRoleRepository,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    // Layered config (JSON defaults → env → DB-admin); no hardcoding (§7).
    this.maxAttempts = this.config.get<number>('admin.login.maxAttempts') ?? 10;
    this.lockoutMs =
      (this.config.get<number>('admin.login.lockoutMinutes') ?? 15) * 60 * 1000;
  }

  async login(
    input: AdminLoginInput,
    ctx: AdminLoginContext,
  ): Promise<AdminLoginResponse> {
    const user = await this.authenticate(input);

    // Pre-generate the session id so the JWT subject and the stored token hash
    // are mutually consistent in one create (the guard verifies token.sub ===
    // session.id and finds the row by hash(token)).
    const sessionId = randomUUID();
    const { token, expiresAt } = this.tokens.sign(sessionId);

    const session = await this.sessionRepo.create({
      id: sessionId,
      adminUserId: user.id,
      tokenHash: this.tokens.hash(token),
      expiresAt,
      ipAddress: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    const now = new Date();
    await this.userRepo.recordLogin(user.id, now);
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: user.id,
      subject: session.id,
      action: 'session_create',
    });

    return {
      accessToken: token,
      expiresAt: expiresAt.toISOString(),
      admin: await this.me(user.id),
    };
  }

  /**
   * Password (+ MFA) authentication with a per-account failure lockout
   * (credential-stuffing / password-spray guard, §3.3). The IP-keyed throttle is
   * trivially bypassed with a proxy pool, so login also locks per account.
   *
   * TOCTOU brute-force guard (mirrors PinService, §3.4): for a KNOWN account the
   * failure counter is incremented ATOMICALLY at the DB *before* the argon2
   * verify. A concurrent burst therefore reads no stale count — at most
   * `maxAttempts` callers pass the pre-verify gate; the rest overflow the counter
   * and are short-circuited to a lock without ever running the expensive verify.
   *
   * An UNKNOWN email is left untouched (no account to lock): it still runs a
   * constant-time dummy verify so it is indistinguishable from a wrong password.
   * A correct password that only fails the status/MFA-required gate is NOT a
   * login failure and does not consume an attempt; a failed MFA code IS.
   */
  private async authenticate(
    input: AdminLoginInput,
  ): Promise<AdminUserWithPassword> {
    const user = (await this.userRepo.findByEmail(
      input.email,
    )) as AdminUserWithPassword | null;

    // 1. Unknown email → timing-safe dummy verify, then reject. No increment:
    //    there is no account to lock, and incrementing would leak existence.
    if (user === null) {
      await this.hasher.verify(DUMMY_HASH, input.password);
      throw new AdminInvalidCredentialsError();
    }

    // 2. Active lockout window → refuse without incrementing or verifying.
    const now = new Date();
    if (user.loginLockedUntil && user.loginLockedUntil > now) {
      throw new AdminAccountLockedError();
    }

    // 3. Register this attempt ATOMICALLY. One DB statement either starts a fresh
    //    window (when the prior lock has expired) or increments — never a separate
    //    reset-THEN-increment, which a concurrent burst on a just-expired lock could
    //    interleave to keep every attempt under the cap (TOCTOU, §3.3; mirrors
    //    PinService.registerFailedAttempt). Runs BEFORE the argon2 verify so at
    //    most `maxAttempts` concurrent callers reach the expensive comparison.
    const { count: newCount, lockedUntil } =
      await this.userRepo.registerFailedLogin(user.id, now);

    // 4. A concurrent racer set an active lock between our read and this write →
    //    refuse without verifying (the atomic statement left the count untouched).
    if (lockedUntil && lockedUntil > now) {
      throw new AdminAccountLockedError();
    }

    // 5. Burst overflow: this call raced past the threshold. Lock and reject
    //    WITHOUT running the argon2 verify (caps concurrent comparisons).
    if (newCount > this.maxAttempts) {
      await this.lock(user.id, now);
      throw new AdminAccountLockedError();
    }

    // 6. Verify the password (constant-time inside argon2).
    const passwordOk = await this.hasher.verify(
      user.passwordHash,
      input.password,
    );
    if (!passwordOk) {
      // The atomic increment already advanced the counter; lock if it reached
      // the cap so the next attempt is refused up-front.
      if (newCount >= this.maxAttempts) {
        await this.lock(user.id, now);
      }
      throw new AdminInvalidCredentialsError();
    }

    // 7. Password is correct → the caller is the legitimate owner. A correct
    //    password that only trips the status/MFA-required gate is not a brute
    //    force attempt, so redeem the just-incremented attempt.
    if (user.status !== 'active') {
      await this.userRepo.resetLoginFailures(user.id);
      throw new AdminInactiveError();
    }

    if (user.mfaEnabled) {
      if (!input.totp && !input.recoveryCode) {
        // No code supplied yet — a benign "need the second factor", not a
        // failure. Redeem the attempt so re-submitting with a code is not
        // penalised, then prompt for MFA.
        await this.userRepo.resetLoginFailures(user.id);
        throw new AdminMfaRequiredError();
      }
      const mfaOk = await this.mfa.verifyForLogin(
        user,
        input.totp,
        input.recoveryCode,
      );
      if (!mfaOk) {
        // A wrong MFA code IS a failed login — the increment stands; lock if the
        // cap is reached.
        if (newCount >= this.maxAttempts) {
          await this.lock(user.id, now);
        }
        throw new AdminMfaInvalidError();
      }
    }

    // 8. Full success (password + MFA ok) → clear any prior failures.
    await this.userRepo.resetLoginFailures(user.id);
    return user;
  }

  /** Lock the account for `lockoutMinutes` from `now`. */
  private async lock(adminId: string, now: Date): Promise<void> {
    const until = new Date(now.getTime() + this.lockoutMs);
    await this.userRepo.setLoginLock(adminId, until);
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionRepo.revoke(sessionId, new Date());
    await this.audit.record({
      correlationId: randomUUID(),
      subject: sessionId,
      action: 'session_revoke',
    });
  }

  async me(adminId: string): Promise<AdminMe> {
    const user = await this.userRepo.findById(adminId);
    if (user === null) throw new AdminNotFoundError('Admin');
    const role = await this.roleRepo.findById(user.roleId);
    if (role === null) throw new AdminNotFoundError('Role');
    const view = await this.authz.meView(user.roleId);
    return {
      id: user.id,
      email: user.email,
      displayName: resolveAdminDisplayName(user.email, user.displayName),
      role: { id: role.id, name: role.name },
      status: user.status,
      mfaEnabled: user.mfaEnabled,
      permissions: view.permissions,
      menus: view.menus,
      pages: view.pages,
    };
  }
}
