/**
 * Normalize an unknown error (mutation/query error, thrown value) into a
 * displayable message, or null when there is no error. The canonical way forms
 * turn `mutation.error` into user-facing copy.
 */
export function toErrorMessage(err: unknown): string | null {
  if (err instanceof Error) return err.message
  return err ? String(err) : null
}
