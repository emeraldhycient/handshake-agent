import { ApiError } from "@/lib/api/client"

/**
 * Normalize an unknown error (mutation/query error, thrown value) into a
 * displayable message, or null when there is no error. The canonical replacement
 * for the per-file `errorMessage` helper duplicated across ~12 admin components.
 */
export function toErrorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}
