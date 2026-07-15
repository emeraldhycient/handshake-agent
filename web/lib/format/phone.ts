/**
 * Masks the middle digits of a phone number for display on the membership card,
 * keeping the country + area prefix and the last 4 visible — e.g.
 * `+2348100000007` → `+234 810 •••• 0007`. Tuned for the NG-style grouping the
 * app leads with; other formats still degrade to "<prefix> •••• <last4>".
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "—"
  const prefix = phone.trim().startsWith("+") ? "+" : ""
  const digits = phone.replace(/\D/g, "")
  if (digits.length < 7) return phone

  const last4 = digits.slice(-4)
  // Full international numbers (11+ digits) get the country + area grouping.
  if (digits.length >= 11) {
    return `${prefix}${digits.slice(0, 3)} ${digits.slice(3, 6)} •••• ${last4}`
  }
  // Shorter numbers: only reveal leading digits that don't overlap the last 4,
  // and always leave at least one digit hidden behind the ••••.
  const leadLen = Math.min(3, digits.length - 4 - 1)
  const lead = leadLen > 0 ? `${digits.slice(0, leadLen)} ` : ""
  return `${prefix}${lead}•••• ${last4}`
}
