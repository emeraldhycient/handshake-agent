import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import type {
  LoginRequestResponse,
  LoginVerifyResponse,
  MeResponse,
  RefreshResponse,
  SignupResponse,
  VerifyEmailResponse,
} from '@handshake-agent/contracts';

import { AuthService } from '../application/auth.service';
import {
  InvalidOtpError,
  InvalidRefreshTokenError,
  InvalidVerificationTokenError,
  TokenSigningDisabledError,
} from '../domain/auth-errors';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from './jwt-auth.guard';
import {
  LoginDto,
  LoginVerifyDto,
  RefreshDto,
  SignupDto,
  VerifyEmailDto,
} from './dto/auth.dto';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @HttpCode(HttpStatus.ACCEPTED)
  async signup(@Body() dto: SignupDto): Promise<SignupResponse> {
    return this.guard(() => this.auth.signup(dto));
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<VerifyEmailResponse> {
    return this.guard(() => this.auth.verifyEmail(dto));
  }

  @Post('login/request')
  @HttpCode(HttpStatus.ACCEPTED)
  async loginRequest(@Body() dto: LoginDto): Promise<LoginRequestResponse> {
    return this.guard(() => this.auth.loginRequest(dto));
  }

  @Post('login/verify')
  @HttpCode(HttpStatus.OK)
  async loginVerify(@Body() dto: LoginVerifyDto): Promise<LoginVerifyResponse> {
    return this.guard(() => this.auth.loginVerify(dto));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto): Promise<RefreshResponse> {
    return this.guard(() => this.auth.refresh(dto));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.auth.logout(user.sessionId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    return this.guard(() => this.auth.me(user.userId));
  }

  /** Maps auth domain errors to HTTP; rethrows the rest. */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (
        err instanceof InvalidVerificationTokenError ||
        err instanceof InvalidOtpError ||
        err instanceof InvalidRefreshTokenError
      ) {
        // Generic: never reveal which factor failed.
        throw new UnauthorizedException('Authentication failed');
      }
      if (err instanceof TokenSigningDisabledError) {
        throw new BadRequestException('Auth is not configured');
      }
      throw err;
    }
  }
}
