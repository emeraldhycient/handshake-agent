import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { IEmailProvider } from '../application/ports/email-provider.port';

/**
 * Dev/test email provider: logs the message instead of sending. Real delivery
 * is a later port swap. The verification link is built from WEB_APP_BASE_URL.
 */
@Injectable()
export class MockEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(MockEmailProvider.name);

  constructor(private readonly config: ConfigService) {}

  async sendEmailVerification(to: string, token: string): Promise<void> {
    const base =
      this.config.get<string>('WEB_APP_BASE_URL') ?? 'http://localhost:3000';
    const link = `${base}/verify-email?token=${token}`;
    this.logger.log(`[mock-email] verify ${to}: ${link}`);
    return Promise.resolve();
  }

  async sendLoginOtp(to: string, otp: string): Promise<void> {
    this.logger.log(`[mock-email] login OTP for ${to}: ${otp}`);
    return Promise.resolve();
  }
}
