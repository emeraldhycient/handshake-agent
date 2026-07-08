/**
 * Map a PIN-verified mutation failure (change PIN, mint token) to distinct,
 * actionable copy. Branches on the stable `code` the DomainExceptionFilter
 * echoes (PIN_LOCKED, PIN_INVALID, …) rather than message strings, and never
 * masks a dead session as a "wrong PIN" (same trap as the chat money path).
 */
import { ApiError, isSessionExpiredError } from "@/lib/api/client"
import { PIN_ERROR_COPY } from "@/constants/settings"

export function pinErrorMessage(err: unknown): string {
  if (isSessionExpiredError(err)) return (err as ApiError).message
  if (err instanceof ApiError) {
    if (err.code === "PIN_LOCKED") return PIN_ERROR_COPY.locked
    if (err.status === 401) return PIN_ERROR_COPY.wrongPin
    if (err.message) return err.message
  }
  return PIN_ERROR_COPY.generic
}
