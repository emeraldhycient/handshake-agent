/**
 * PatController — personal-access-token self-management (Wave C, PAT/MCP).
 *
 * POST   /profile/tokens      mint (PIN-gated; raw token returned ONCE)
 * GET    /profile/tokens      masked list
 * DELETE /profile/tokens/:id  soft revoke (404 on foreign/unknown ids)
 *
 * All routes sit behind JwtAuthGuard: SESSION users manage their tokens —
 * a PAT cannot mint, list or revoke PATs (no self-propagation). PIN domain
 * errors are NOT caught here: they bubble to the global DomainExceptionFilter
 * and map exactly like every other pin-verification surface (PIN_INVALID /
 * PIN_NOT_SET → 401, PIN_LOCKED → 401 lockout shape, §3.3).
 */

import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import type {
  CreatePatResponse,
  PatListResponse,
} from '@handshake-agent/contracts';

import { PatService } from '../application/pat.service';
import { PatNotFoundError } from '../domain/pat-errors';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from './jwt-auth.guard';
import { CreatePatDto } from './dto/pat.dto';

@Controller('profile/tokens')
@UseGuards(JwtAuthGuard)
export class PatController {
  constructor(private readonly pats: PatService) {}

  /**
   * Mint a new PAT. Tightly throttled: this route verifies the transaction
   * PIN, so brute-force must be bounded (mirrors the proposal-execute limit)
   * on top of the atomic PinService lockout.
   */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(
    @Body() dto: CreatePatDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CreatePatResponse> {
    return this.pats.mint({
      userId: user.userId,
      label: dto.label,
      pin: dto.pin,
      scopes: dto.scopes,
      expiresInDays: dto.expiresInDays,
    });
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<PatListResponse> {
    return this.pats.list(user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    try {
      await this.pats.revoke(user.userId, id);
    } catch (err) {
      if (err instanceof PatNotFoundError) {
        // Foreign and unknown ids look identical — no ownership disclosure.
        throw new NotFoundException('Token not found');
      }
      throw err;
    }
  }
}
