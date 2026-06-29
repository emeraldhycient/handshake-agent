import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';

import type { IEmailProvider } from '../application/ports/email-provider.port';

// ---------------------------------------------------------------------------
// Resend API response shapes
// ---------------------------------------------------------------------------

interface ResendSuccessBody {
  id: string;
}

interface ResendErrorBody {
  name: string;
  message: string;
}

// ---------------------------------------------------------------------------
// ResendEmailProvider
// ---------------------------------------------------------------------------

/**
 * Production email adapter backed by Resend (https://resend.com).
 *
 * Uses the `@nestjs/axios` HttpService pattern (mirrors FlutterwaveProvider /
 * BlockradarProvider). Auth is `Authorization: Bearer <RESEND_API_KEY>`.
 *
 * Wired via a key-gated factory in WebAuthModule:
 *   RESEND_API_KEY present/non-empty → this adapter
 *   RESEND_API_KEY absent/empty      → MockEmailProvider (dev fallback)
 */
@Injectable()
export class ResendEmailProvider implements IEmailProvider {
  private static readonly BASE_URL = 'https://api.resend.com/emails';
  private readonly logger = new Logger(ResendEmailProvider.name);

  private readonly authHeader: string;
  private readonly from: string;
  private readonly webAppBaseUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    const apiKey = this.config.get<string>('RESEND_API_KEY') ?? '';
    this.authHeader = `Bearer ${apiKey}`;
    this.from =
      this.config.get<string>('EMAIL_FROM') ??
      'Handshake <no-reply@handshake.ng>';
    this.webAppBaseUrl =
      this.config.get<string>('WEB_APP_BASE_URL') ?? 'http://localhost:3000';
  }

  // ---------------------------------------------------------------------------
  // IEmailProvider
  // ---------------------------------------------------------------------------

  /**
   * Sends the email-verification link to the given address.
   * The link is `{WEB_APP_BASE_URL}/verify-email?token={token}`.
   */
  async sendEmailVerification(to: string, token: string): Promise<void> {
    const link = `${this.webAppBaseUrl}/verify-email?token=${token}`;

    const subject = 'Verify your Handshake email address';
    const html = `
<p>Hi,</p>
<p>Thanks for signing up with Handshake. Please verify your email address by clicking the link below:</p>
<p><a href="${link}">${link}</a></p>
<p>This link expires in 24 hours. If you did not create a Handshake account, you can safely ignore this email.</p>
<p>— The Handshake Team</p>
    `.trim();
    const text = `Verify your Handshake email\n\nClick the link below to verify your email address:\n${link}\n\nThis link expires in 24 hours. If you did not create a Handshake account, you can safely ignore this email.\n\n— The Handshake Team`;

    this.logger.log(`[resend] sending email-verification to ${to}`);
    await this.send({ to, subject, html, text });
  }

  /**
   * Sends the one-time login code to the given address.
   * The OTP is valid for the period set in the auth configuration.
   */
  async sendLoginOtp(to: string, otp: string): Promise<void> {
    const subject = `Your Handshake login code: ${otp}`;
    const html = `
<p>Hi,</p>
<p>Your Handshake one-time login code is:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:4px;">${otp}</p>
<p>This code expires in a few minutes. Do not share it with anyone.</p>
<p>If you did not request this code, please ignore this email — your account is safe.</p>
<p>— The Handshake Team</p>
    `.trim();
    const text = `Your Handshake login code\n\nYour one-time login code is: ${otp}\n\nThis code expires in a few minutes. Do not share it with anyone.\n\nIf you did not request this code, please ignore this email — your account is safe.\n\n— The Handshake Team`;

    this.logger.log(`[resend] sending login OTP to ${to}`);
    await this.send({ to, subject, html, text });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async send(payload: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    const body = {
      from: this.from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    };

    try {
      await firstValueFrom(
        this.http.post<ResendSuccessBody>(ResendEmailProvider.BASE_URL, body, {
          headers: this.headers(),
        }),
      );
    } catch (err: unknown) {
      throw this.wrapError(err);
    }
  }

  /** Common Resend auth + content-type headers. */
  private headers(): Record<string, string> {
    return {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Translates an Axios rejection into a descriptive Error.
   * Resend returns `{ name, message }` on non-2xx responses.
   */
  private wrapError(err: unknown): Error {
    const axiosErr = err as AxiosError<ResendErrorBody>;
    const body = axiosErr?.response?.data;
    if (body?.message) {
      const status = axiosErr.response?.status ?? 'unknown';
      return new Error(`Resend error (HTTP ${status}): ${body.message}`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
