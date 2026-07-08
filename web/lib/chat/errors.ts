import { ApiError, isSessionExpiredError } from "@/lib/api/client"

export const GENERIC_AGENT_ERROR =
  "I'm having trouble reaching the assistant right now — please try again."

/** Notice shown in-thread when the session has expired (findings #1 / #2). */
export const SESSION_EXPIRED_NOTICE =
  "Your session expired. Please log in again to continue."

/**
 * Extracts the user-facing error message from a caught value.
 *
 * 4xx ApiError → surface the server's clean domain message. 5xx ApiError or a
 * plain Error (network failure) → the generic fallback, so the user never sees a
 * raw stack trace or opaque server error string.
 */
export function chatErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status !== undefined && err.status < 500) {
    return err.message
  }
  return GENERIC_AGENT_ERROR
}

/**
 * Is `err` a genuine PIN / directive authorization failure that re-entering the
 * PIN can fix (PIN_INVALID, PIN_LOCKED, DIRECTIVE_EXPIRED, …)? The backend maps
 * these to 401. A 401 that is the interceptor's dead-session sentinel is NOT one
 * of these — it is handled separately as session-expiry (finding #1). A plain
 * (statusless) Error is treated as a PIN error too, preserving "wrong PIN →
 * reopen pad" for the offline/mock path.
 */
export function isRetryablePinError(err: unknown): boolean {
  if (isSessionExpiredError(err)) return false
  if (err instanceof ApiError) return err.status === 401
  return err instanceof Error
}
