import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

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
  OtpLockedError,
  TokenSigningDisabledError,
  UserNotFoundError,
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
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
  async signup(@Body() dto: SignupDto): Promise<SignupResponse> {
    return this.guard(() => this.auth.signup(dto));
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<VerifyEmailResponse> {
    return this.guard(() => this.auth.verifyEmail(dto));
  }

  @Post('login/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
  async loginRequest(@Body() dto: LoginDto): Promise<LoginRequestResponse> {
    return this.guard(() => this.auth.loginRequest(dto));
  }

  /**
   * Resend the login OTP for the same email. Idempotent + rate-limited; returns
   * the same neutral otp_sent response (no enumeration). Lets the UI offer an
   * explicit "resend code" action after a wrong/stale code or a lockout.
   */
  @Post('login/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  async resendLoginOtp(@Body() dto: LoginDto): Promise<LoginRequestResponse> {
    return this.guard(() => this.auth.resendLoginOtp(dto));
  }

  /**
   * Resend the email-verification link. Idempotent + rate-limited; returns the
   * neutral pending_verification response whether or not the email exists or is
   * already verified (no enumeration, no duplicate account created).
   */
  @Post('verify-email/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  async resendVerification(@Body() dto: LoginDto): Promise<SignupResponse> {
    return this.guard(() => this.auth.resendEmailVerification(dto));
  }

  @Post('login/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
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
      if (err instanceof OtpLockedError) {
        // Distinct from a wrong code: the guess budget is spent. 429 + a
        // request-a-new-code message routes the UI to resend instead of looping
        // a dead challenge. Safe to distinguish — only reachable for a real
        // verified user (see OtpLockedError doc / AuthService.loginVerify).
        throw new HttpException(err.message, HttpStatus.TOO_MANY_REQUESTS);
      }
      if (
        err instanceof InvalidVerificationTokenError ||
        err instanceof InvalidOtpError ||
        err instanceof InvalidRefreshTokenError
      ) {
        // Generic: never reveal which factor failed.
        throw new UnauthorizedException('Authentication failed');
      }
      if (err instanceof UserNotFoundError) {
        // Valid session, missing account — not an auth failure, so not 401.
        throw new NotFoundException(err.message);
      }
      if (err instanceof TokenSigningDisabledError) {
        throw new BadRequestException('Auth is not configured');
      }
      throw err;
    }
  }
}
