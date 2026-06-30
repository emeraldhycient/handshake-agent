import { z } from "zod";

// Email-first web auth. The phone is captured for later WhatsApp linking only —
// it is a routing key, never the auth anchor (root CLAUDE.md §3.4).
export const SignupRequestSchema = z.object({
  email: z.string().email().max(254),
  // Loose E.164-ish: leading + optional, 8–15 digits. Server normalizes.
  phone: z.string().regex(/^\+?[0-9]{8,15}$/, "Enter a valid phone number"),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const SignupResponseSchema = z.object({
  status: z.literal("pending_verification"),
  // Present ONLY when AUTH_DEV_EXPOSE_OTP=true (non-prod) — used by tests/dev.
  devToken: z.string().optional(),
});
export type SignupResponse = z.infer<typeof SignupResponseSchema>;

export const VerifyEmailRequestSchema = z.object({ token: z.string().min(1) });
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

export const VerifyEmailResponseSchema = z.object({
  verified: z.literal(true),
});
export type VerifyEmailResponse = z.infer<typeof VerifyEmailResponseSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email().max(254),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginRequestResponseSchema = z.object({
  status: z.literal("otp_sent"),
  devOtp: z.string().optional(),
});
export type LoginRequestResponse = z.infer<typeof LoginRequestResponseSchema>;

export const LoginVerifyRequestSchema = z.object({
  email: z.string().email().max(254),
  otp: z.string().min(4).max(10),
  deviceFingerprint: z.string().min(8).max(200),
});
export type LoginVerifyRequest = z.infer<typeof LoginVerifyRequestSchema>;

export const MeResponseSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  kycStatus: z.string(),
  kycTier: z.string(),
  hasPin: z.boolean(),
  /** From KycProfile — null when no KYC profile exists yet. */
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const LoginVerifyResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  user: MeResponseSchema,
});
export type LoginVerifyResponse = z.infer<typeof LoginVerifyResponseSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const RefreshResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;
