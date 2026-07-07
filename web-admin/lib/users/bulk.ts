import { ApiError } from "@/lib/api/client"
import { BULK_CONFIRM_CODE } from "@/constants/users-bulk"

/**
 * True when the error is the large-selection confirmation gate — a 422 with
 * `ADMIN_BULK_CONFIRMATION_REQUIRED`. Callers surface the confirm checkbox rather than
 * a raw error so the operator can acknowledge and resend (re-checked server-side, §3.3).
 */
export function isBulkConfirmError(error: unknown): boolean {
  return error instanceof ApiError && error.code === BULK_CONFIRM_CODE
}
