import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import * as QRCode from 'qrcode';
import type { Request } from 'express';

import {
  AdminLoginResponseSchema,
  AdminMeSchema,
  AdminMfaEnrollResponseSchema,
  type AdminLoginResponse,
  type AdminMe,
  type AdminMfaEnrollResponse,
} from '@handshake-agent/contracts';

import { AdminAuthService } from '../application/admin-auth.service';
import { AdminMfaService } from '../application/admin-mfa.service';
import { AdminStepUpService } from '../application/admin-step-up.service';
import { AdminBootstrapService } from '../application/admin-bootstrap.service';
import { AdminInvitationService } from '../application/admin-invitation.service';
import {
  PASSWORD_HASHER,
  type IPasswordHasher,
} from '../application/ports/password-hasher.port';
import { AdminSessionGuard } from './admin-session.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { AdminLoginDto, AdminStepUpDto } from './dto/admin-auth.dto';
import { AdminBootstrapDto } from './dto/admin-bootstrap.dto';
import { AdminInvitationAcceptDto } from './dto/admin-invitation.dto';

/** A throttle for the public, unauthenticated admin auth/bootstrap routes. */
const AUTH_THROTTLE = { auth: { limit: 30, ttl: 60_000 } };

/**
 * Admin authentication surface: public login / bootstrap / invitation-accept,
 * and session-bound logout / me / step-up / mfa-enroll. RBAC is NOT applied here
 * — these establish or read the session itself. Every response is parsed through
 * its contract schema before it leaves the controller (§3.3 / §8).
 */
@Controller('admin')
@UseGuards(ThrottlerGuard)
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly mfa: AdminMfaService,
    private readonly stepUp: AdminStepUpService,
    private readonly bootstrapService: AdminBootstrapService,
    private readonly invitations: AdminInvitationService,
    @Inject(PASSWORD_HASHER)
    private readonly hasher: IPasswordHasher,
  ) {}

  // ── Public (no session) ────────────────────────────────────────────────────

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async login(
    @Body() dto: AdminLoginDto,
    @Req() req: Request,
  ): Promise<AdminLoginResponse> {
    const result = await this.auth.login(dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return AdminLoginResponseSchema.parse(result);
  }

  @Post('bootstrap')
  @HttpCode(HttpStatus.CREATED)
  @Throttle(AUTH_THROTTLE)
  async bootstrap(@Body() dto: AdminBootstrapDto): Promise<{
    invitationId: string;
    invitationToken: string;
    expiresAt: string;
  }> {
    const result = await this.bootstrapService.bootstrap(
      dto.token,
      dto.email,
      new Date(),
    );
    return {
      invitationId: result.invitationId,
      invitationToken: result.invitationToken,
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async acceptInvitation(
    @Body() dto: AdminInvitationAcceptDto,
  ): Promise<{ adminId: string }> {
    const passwordHash = await this.hasher.hash(dto.password);
    return this.invitations.accept(
      { token: dto.token, passwordHash },
      new Date(),
    );
  }

  // ── Session-bound (authenticated; no RBAC) ──────────────────────────────────

  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminSessionGuard)
  async logout(@CurrentAdmin() admin: AdminContext): Promise<void> {
    await this.auth.logout(admin.sessionId);
  }

  @Get('me')
  @UseGuards(AdminSessionGuard)
  async me(@CurrentAdmin() admin: AdminContext): Promise<AdminMe> {
    return AdminMeSchema.parse(await this.auth.me(admin.adminId));
  }

  @Post('auth/step-up')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminSessionGuard)
  async stepUpChallenge(
    @CurrentAdmin() admin: AdminContext,
    @Body() dto: AdminStepUpDto,
  ): Promise<void> {
    await this.stepUp.challenge(
      {
        adminId: admin.adminId,
        sessionId: admin.sessionId,
        password: dto.password,
        totp: dto.totp,
      },
      new Date(),
    );
  }

  @Post('auth/mfa/enroll')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminSessionGuard)
  async enrollMfa(
    @CurrentAdmin() admin: AdminContext,
  ): Promise<AdminMfaEnrollResponse> {
    const { otpauthUri, recoveryCodes } = await this.mfa.enroll(
      admin.adminId,
      admin.email,
    );
    const qrSvg = await QRCode.toString(otpauthUri, { type: 'svg' });
    return AdminMfaEnrollResponseSchema.parse({
      otpauthUri,
      qrSvg,
      recoveryCodes,
    });
  }
}
