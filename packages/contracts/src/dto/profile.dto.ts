import { z } from "zod";
import { FiatCurrencySchema } from "../common";
import { TransactionPinSchema } from "./kyc-complete.dto";

export const ProfileLimitsSchema = z.object({
  perTxFiatMax: z.number(),
  dailyFiatMax: z.number(),
  dailyTxCountMax: z.number(),
});
export type ProfileLimits = z.infer<typeof ProfileLimitsSchema>;

export const ProfileResponseSchema = z.object({
  email: z.string().email(),
  fullName: z.string().nullable(),
  phone: z.string().nullable(),
  kycStatus: z.string(),
  kycTier: z.string(),
  fiatCurrency: FiatCurrencySchema,
  limits: ProfileLimitsSchema.nullable(),
});
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;

/**
 * Request DTO for POST /profile/pin/change (Wave C settings).
 * `currentPin` is opaque (the server compares it through the lockout-protected
 * PinService); only the NEW pin is held to the TransactionPinSchema policy —
 * the same canonical rule enforced at set time (root CLAUDE.md §3.3/§13.1).
 */
export const ChangePinRequestSchema = z.object({
  currentPin: z.string().min(1),
  newPin: TransactionPinSchema,
});
export type ChangePinRequest = z.infer<typeof ChangePinRequestSchema>;

/**
 * Request DTO for PATCH /profile (Wave C settings). Deliberately narrow —
 * `.strict()` rejects KYC-owned identity fields (fullName, dob, nin/bvn),
 * which are immutable on this surface by design (§3.4). The phone is a
 * contact/routing preference, never an auth anchor. `fiatCurrency` is
 * re-validated server-side against the live catalog (enabled fiats only).
 */
export const UpdateProfileRequestSchema = z
  .object({
    // Loose E.164-ish, mirrors SignupRequestSchema: leading + optional, 8–15 digits.
    phone: z
      .string()
      .regex(/^\+?[0-9]{8,15}$/, "Enter a valid phone number")
      .optional(),
    fiatCurrency: FiatCurrencySchema.optional(),
  })
  .strict()
  .refine((d) => d.phone !== undefined || d.fiatCurrency !== undefined, {
    message: "Provide at least one field to update",
  });
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

/**
 * One ACTIVE session row for GET /profile/sessions. Timestamps are ISO
 * strings; `userAgent` is telemetry from the bound device (may be null).
 * `isCurrent` marks the session making the request — revoking it is allowed
 * and behaves like logout.
 */
export const ProfileSessionSchema = z.object({
  id: z.string().uuid(),
  channel: z.string(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string(),
  isCurrent: z.boolean(),
});
export type ProfileSession = z.infer<typeof ProfileSessionSchema>;

export const ProfileSessionListResponseSchema = z.object({
  sessions: z.array(ProfileSessionSchema),
});
export type ProfileSessionListResponse = z.infer<
  typeof ProfileSessionListResponseSchema
>;
