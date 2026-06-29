import { Controller, Get, UseGuards } from '@nestjs/common';
import type { ProfileResponse } from '@handshake-agent/contracts';
import { ProfileResponseSchema } from '@handshake-agent/contracts';

import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import { ProfileService } from '../application/profile.service';

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  async get(@CurrentUser() user: AuthenticatedUser): Promise<ProfileResponse> {
    return ProfileResponseSchema.parse(
      await this.profile.getProfile(user.userId),
    );
  }
}
