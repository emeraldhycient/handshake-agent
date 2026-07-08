import { z } from "zod"
import {
  BvnSchema,
  NinSchema,
  TransactionPinSchema,
} from "@handshake-agent/contracts/dto"

/**
 * An identifier field (NIN/BVN) that may be left blank. Empty strings are coerced
 * to `undefined` so a blank field surfaces the "provide your NIN or BVN" rule
 * rather than an 11-digit format error. Field schemas come from
 * `@handshake-agent/contracts` so the FE (UX) gate and server (security, §3.3)
 * validate identically.
 */
export const optionalIdentifier = (schema: z.ZodString) =>
  z
    .union([z.literal(""), schema])
    .optional()
    .transform((v) => (v === "" ? undefined : v))

/** The identity + PIN fields shared by both KYC forms (web-handoff + onboarding). */
export const kycBaseFields = {
  nin: optionalIdentifier(NinSchema),
  bvn: optionalIdentifier(BvnSchema),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  dateOfBirth: z.string().optional(),
  pin: TransactionPinSchema,
}

/** At least one of NIN or BVN must be provided (provider requirement). */
export const hasNinOrBvn = (data: { nin?: string; bvn?: string }): boolean =>
  Boolean(data.nin) || Boolean(data.bvn)
