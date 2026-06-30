import { z } from 'zod'

/**
 * Request DTO for POST /kyc/complete.
 *
 * The web KYC modal submits this body to redeem the single-use HandoffToken
 * and trigger KycService.completeVerification (K2).
 *
 * PIN is a plain string here — it is hashed immediately on the server and
 * never logged or persisted in plaintext (NFR-1).
 */
export const KycCompleteRequestSchema = z.object({
  /** Single-use handoff token issued by HandoffTokenService.mintKycToken. */
  token: z.string().min(1),
  /** NIN (National Identification Number) — optional: provider may only need BVN. */
  nin: z.string().optional(),
  /** BVN (Bank Verification Number) — optional: provider may only need NIN. */
  bvn: z.string().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  /** ISO 8601 date string, e.g. "1992-07-14". */
  dateOfBirth: z.string().optional(),
  /** Raw transaction PIN — hashed on the server; never stored plaintext. */
  pin: z.string().min(1),
})
export type KycCompleteRequest = z.infer<typeof KycCompleteRequestSchema>

export const KycCompleteResponseSchema = z.object({
  userId: z.string().uuid(),
  status: z.literal('verified'),
})
export type KycCompleteResponse = z.infer<typeof KycCompleteResponseSchema>

/**
 * Request DTO for POST /kyc/submit.
 *
 * Used by web-native users (already have a User row from email signup) to
 * complete KYC and set their transaction PIN via a JWT-authenticated session.
 *
 * PIN is a plain string here — it is hashed immediately on the server and
 * never logged or persisted in plaintext (NFR-1).
 */
export const KycSubmitRequestSchema = z.object({
  /** NIN (National Identification Number) — optional: provider may only need BVN. */
  nin: z.string().optional(),
  /** BVN (Bank Verification Number) — optional: provider may only need NIN. */
  bvn: z.string().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  /** ISO 8601 date string, e.g. "1992-07-14". */
  dateOfBirth: z.string().optional(),
  /** Raw transaction PIN — hashed on the server; never stored plaintext. */
  pin: z.string().min(1),
})
export type KycSubmitRequest = z.infer<typeof KycSubmitRequestSchema>
