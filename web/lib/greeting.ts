/** Time-of-day greeting prefix (e.g. "Good afternoon"). */
export function greetingPrefix(): string {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

/**
 * Build the greeting string.
 * - If a name is known: "Good afternoon, Amara"
 * - Otherwise: "Good afternoon" (no name — never a hardcoded placeholder)
 *
 * Greets by FIRST name only: the full name wraps onto multiple lines in the
 * narrow topbar column. Falls back to the last name, then a name-free greeting.
 */
export function buildGreeting(
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string {
  const firstToken = (firstName || lastName || "").trim().split(/\s+/)[0]
  return firstToken ? `${greetingPrefix()}, ${firstToken}` : greetingPrefix()
}
