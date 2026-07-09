/**
 * ProfileController — the web settings surface (Wave C).
 *
 * GET    /profile              read the composed profile projection
 * PATCH  /profile              update non-identity fields (phone, fiat)
 * POST   /profile/pin/change   verify current PIN (lockout-gated) → set new
 * GET    /profile/sessions     list own ACTIVE sessions (current flagged)
 * DELETE /profile/sessions/:id revoke own session (current = logout)
 *
 * All routes behind JwtAuthGuard — SESSION users only (a PAT never works
 * here; PatAuthGuard is a separate, unwired credential path). PIN domain
 * errors bubble to the global DomainExceptionFilter and map exactly like
 * every other pin surface (PIN_INVALID/PIN_NOT_SET → 401, PIN_LOCKED → 401
 * lockout shape, PIN_WEAK → 422).
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import type {
  ProfileResponse,
  ProfileSessionListResponse,
} from '@handshake-agent/contracts';
import {
  ProfileResponseSchema,
  ProfileSessionListResponseSchema,
} from '@handshake-agent/contracts';

import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import {
  FiatCurrencyNotEnabledError,
  ProfileSessionNotFoundError,
} from '../domain/profile-errors';
import { ProfileService } from '../application/profile.service';
import { ProfileSettingsService } from '../application/profile-settings.service';
import { ChangePinDto } from './dto/change-pin.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly settings: ProfileSettingsService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthenticatedUser): Promise<ProfileResponse> {
    return ProfileResponseSchema.parse(
      await this.profile.getProfile(user.userId),
    );
  }

  @Patch()
  async update(
    @Body() dto: UpdateProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProfileResponse> {
    try {
      return ProfileResponseSchema.parse(
        await this.settings.updateProfile(user.userId, dto),
      );
    } catch (err) {
      if (err instanceof FiatCurrencyNotEnabledError) {
        throw new UnprocessableEntityException(err.message);
      }
      throw err;
    }
  }

  /**
   * Change the transaction PIN. Tightly throttled: this route verifies the
   * current PIN, so brute-force must be bounded (mirrors the proposal-execute
   * limit) on top of the atomic PinService lockout.
   */
  @Post('pin/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async changePin(
    @Body() dto: ChangePinDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.settings.changePin(user.userId, dto.currentPin, dto.newPin);
  }

  @Get('sessions')
  async sessions(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProfileSessionListResponse> {
    return ProfileSessionListResponseSchema.parse(
      await this.settings.listSessions(user.userId, user.sessionId),
    );
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    try {
      await this.settings.revokeSession(user.userId, id);
    } catch (err) {
      if (err instanceof ProfileSessionNotFoundError) {
        // Foreign and unknown ids look identical — no ownership disclosure.
        throw new NotFoundException('Session not found');
      }
      throw err;
    }
  }
}
