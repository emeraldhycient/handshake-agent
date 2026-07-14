import { z } from "zod";

/**
 * Transaction-PIN + set-PIN (`POST /kyc/pin`) schemas.
 *
 * NOTE: this file historically also held the `/kyc/complete` + `/kyc/submit`
 * request/response DTOs (the legacy synchronous NIN/BVN path). Those endpoints
 * were retired — identity is now granted via email-OTP (tier_1) + the Sumsub
 * webhook (tier_2/3) — so only the shared `TransactionPinSchema` (imported by
 * the beneficiary + profile DTOs) and the `/kyc/pin` set-PIN DTOs remain.
 *
 * Canonical transaction-PIN schema — the SINGLE source of truth for PIN shape
 * across the app (root CLAUDE.md §13.1: one canonical primitive per concept).
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
 * Request DTO for POST /kyc/pin — set the transaction PIN on an already-verified
 * user who has no PIN yet (e.g. a user verified before the PIN step existed, or
 * whose PIN setup did not complete). It carries NO identity fields, only the
 * PIN, and is JWT-authenticated. The server gates it to verified, PIN-less users
 * only.
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
