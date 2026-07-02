import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { AdminLoginResponse, AdminMe } from '@handshake-agent/contracts';

import {
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
  ) {}

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

  private async authenticate(
    input: AdminLoginInput,
  ): Promise<AdminUserWithPassword> {
    const user = (await this.userRepo.findByEmail(
      input.email,
    )) as AdminUserWithPassword | null;

    // Timing-safe: always run a verify, against a dummy hash when the user is
    // missing, so an unknown email is indistinguishable from a wrong password.
    const passwordOk = await this.hasher.verify(
      user?.passwordHash ?? DUMMY_HASH,
      input.password,
    );
    if (user === null || !passwordOk) {
      throw new AdminInvalidCredentialsError();
    }

    if (user.status !== 'active') {
      throw new AdminInactiveError();
    }

    if (user.mfaEnabled) {
      if (!input.totp && !input.recoveryCode) {
        throw new AdminMfaRequiredError();
      }
      const mfaOk = await this.mfa.verifyForLogin(
        user,
        input.totp,
        input.recoveryCode,
      );
      if (!mfaOk) {
        throw new AdminMfaInvalidError();
      }
    }

    return user;
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
