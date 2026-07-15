/**
 * HandleController — public-nickname management + PayID change (Spec 2).
 *
 * GET    /profile/public-nicknames      list own public nicknames
 * POST   /profile/public-nicknames      claim a new public nickname
 * DELETE /profile/public-nicknames/:id  remove an own public nickname
 * PATCH  /profile/payid                 change PayID (ONE time only)
 *
 * All routes behind JwtAuthGuard — SESSION users only. The public-nickname
 * routes carry NO PIN: adding/removing a nickname only makes the caller
 * reachable by others, moves no money, and changes none of the caller's own
 * send destinations (§3.1). `resolveHandle` itself is deliberately NOT
 * exposed here — no lookup/search-by-handle endpoint exists (anti-
 * enumeration, design §4.2); resolution only happens server-side inside a
 * send turn (Task 9) or the availability check folded into these two writes.
 *
 * PATCH /profile/payid and POST /profile/public-nicknames are tightly
 * throttled: both double as an availability oracle (a 409 HANDLE_TAKEN
 * response discloses that a handle is claimed) — bounding request rate
 * limits enumeration, mirroring the OTP-request throttle tightness.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import type {
  PublicNickname,
  PublicNicknamesResponse,
} from '@handshake-agent/contracts';
import {
  PublicNicknameSchema,
  PublicNicknamesResponseSchema,
} from '@handshake-agent/contracts';

import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import { HandleService } from '../application/handle.service';
import { ClaimPayIdDto } from './dto/claim-payid.dto';
import { CreatePublicNicknameDto } from './dto/create-public-nickname.dto';

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class HandleController {
  constructor(private readonly handles: HandleService) {}

  @Get('public-nicknames')
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PublicNicknamesResponse> {
    const nicknames = await this.handles.listPublicNicknames(user.userId);
    return PublicNicknamesResponseSchema.parse({ nicknames });
  }

  @Post('public-nicknames')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(
    @Body() dto: CreatePublicNicknameDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PublicNickname> {
    const nickname = await this.handles.addPublicNickname(
      user.userId,
      dto.alias,
    );
    return PublicNicknameSchema.parse(nickname);
  }

  @Delete('public-nicknames/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.handles.removePublicNickname(user.userId, id);
  }

  @Patch('payid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changePayId(
    @Body() dto: ClaimPayIdDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.handles.changePayId(user.userId, dto.payId);
  }
}
