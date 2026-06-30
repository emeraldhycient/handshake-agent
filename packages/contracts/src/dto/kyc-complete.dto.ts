import { z } from "zod";

/**
 * Canonical transaction-PIN schema — the SINGLE source of truth for PIN shape
 * across KYC submission and proposal execution (root CLAUDE.md §13.1: one
 * canonical primitive per concept).
 *
 * A custodial money app must not accept trivial PINs. The rules are:
 *   - exactly 4–6 numeric digits (no symbols, letters, or spaces);
 *   - not all the same digit (0000, 1111, 999999);
 *   - not a strictly ascending or descending run of consecutive digits
 *     (1234, 123456, 4321, 654321).
 *
 * Identical validation runs on the contract (UX) AND the server (security
 * boundary, §3.3): the server re-rejects weak PINs even when a non-web caller
 * bypasses the form.
 */
const ALL_SAME_DIGIT = /^(\d)\1+$/;

/** True for a strictly ascending or descending run of consecutive digits. */
function isConsecutiveRun(pin: string): boolean {
  const ascending = pin
    .split("")
    .every((d, i) => i === 0 || Number(d) === Number(pin[i - 1]) + 1);
  const descending = pin
    .split("")
    .every((d, i) => i === 0 || Number(d) === Number(pin[i - 1]) - 1);
  return ascending || descending;
}

export const TransactionPinSchema = z
  .string()
  .regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits")
  .refine((pin) => !ALL_SAME_DIGIT.test(pin), {
    message: "PIN must not be all the same digit",
  })
  .refine((pin) => !isConsecutiveRun(pin), {
    message: "PIN must not be a simple sequence",
  });

/**
 * Nigerian identity numbers — NIN (National Identification Number) and BVN
 * (Bank Verification Number) are each exactly 11 numeric digits. Both are
 * optional individually, but at least one must be present (enforced by the
 * `.refine` on the request schemas below).
 */
export const NinSchema = z.string().regex(/^\d{11}$/, "NIN must be 11 digits");
export const BvnSchema = z.string().regex(/^\d{11}$/, "BVN must be 11 digits");

/** At-least-one-identifier rule shared by both KYC request schemas. */
const hasAtLeastOneIdentifier = (data: {
  nin?: string;
  bvn?: string;
}): boolean => Boolean(data.nin) || Boolean(data.bvn);

const ID_REFINE_OPTS = {
  message: "Provide your NIN or BVN",
  path: ["nin"],
};

/**
 * Request DTO for POST /kyc/complete.
 *
 * The web KYC modal submits this body to redeem the single-use HandoffToken
 * and trigger KycService.completeVerification (K2).
 *
 * PIN is a plain string here — it is hashed immediately on the server and
 * never logged or persisted in plaintext (NFR-1).
 */
export const KycCompleteRequestSchema = z
  .object({
    /** Single-use handoff token issued by HandoffTokenService.mintKycToken. */
    token: z.string().min(1),
    /** NIN — 11 digits; optional individually but one of NIN/BVN is required. */
    nin: NinSchema.optional(),
    /** BVN — 11 digits; optional individually but one of NIN/BVN is required. */
    bvn: BvnSchema.optional(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    /** ISO 8601 date string, e.g. "1992-07-14". */
    dateOfBirth: z.string().optional(),
    /** Raw transaction PIN — hashed on the server; never stored plaintext. */
    pin: TransactionPinSchema,
  })
  .refine(hasAtLeastOneIdentifier, ID_REFINE_OPTS);
export type KycCompleteRequest = z.infer<typeof KycCompleteRequestSchema>;

export const KycCompleteResponseSchema = z.object({
  userId: z.string().uuid(),
  status: z.literal("verified"),
});
export type KycCompleteResponse = z.infer<typeof KycCompleteResponseSchema>;

/**
 * Request DTO for POST /kyc/submit.
 *
 * Used by web-native users (already have a User row from email signup) to
 * complete KYC and set their transaction PIN via a JWT-authenticated session.
 *
 * PIN is a plain string here — it is hashed immediately on the server and
 * never logged or persisted in plaintext (NFR-1).
 */
export const KycSubmitRequestSchema = z
  .object({
    /** NIN — 11 digits; optional individually but one of NIN/BVN is required. */
    nin: NinSchema.optional(),
    /** BVN — 11 digits; optional individually but one of NIN/BVN is required. */
    bvn: BvnSchema.optional(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    /** ISO 8601 date string, e.g. "1992-07-14". */
    dateOfBirth: z.string().optional(),
    /** Raw transaction PIN — hashed on the server; never stored plaintext. */
    pin: TransactionPinSchema,
  })
  .refine(hasAtLeastOneIdentifier, ID_REFINE_OPTS);
export type KycSubmitRequest = z.infer<typeof KycSubmitRequestSchema>;

/**
 * Request DTO for POST /kyc/pin — set the transaction PIN on an already-verified
 * user who has no PIN yet (e.g. a user verified before the PIN step existed, or
 * whose PIN setup did not complete). Distinct from KYC submission: it carries
 * NO identity fields, only the PIN, and is JWT-authenticated. The server gates
 * it to verified, PIN-less users only.
 *
 * PIN is a plain string — hashed immediately on the server; never stored plaintext.
 */
export const SetPinRequestSchema = z.object({
  pin: TransactionPinSchema,
});
export type SetPinRequest = z.infer<typeof SetPinRequestSchema>;

export const SetPinResponseSchema = z.object({
  hasPin: z.literal(true),
});
export type SetPinResponse = z.infer<typeof SetPinResponseSchema>;
