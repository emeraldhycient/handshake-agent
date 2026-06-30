/**
 * Outbound email port. The dev mock logs; a real provider (Resend/SES) is a
 * later port swap — application code never imports the concrete adapter.
 */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface IEmailProvider {
  /** Sends the email-verification link carrying the single-use token. */
  sendEmailVerification(to: string, token: string): Promise<void>;
  /** Sends the one-time login code. */
  sendLoginOtp(to: string, otp: string): Promise<void>;
}
