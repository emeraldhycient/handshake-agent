/**
 * Masks the middle digits of a phone number for display on the membership card,
 * keeping the country + area prefix and the last 4 visible — e.g.
 * `+2348100000007` → `+234 810 •••• 0007`. Tuned for the NG-style grouping the
 * app leads with; other formats still degrade to "<prefix> •••• <last4>".
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "—"
  const hasPlus = phone.trim().startsWith("+")
  const digits = phone.replace(/\D/g, "")
  if (digits.length < 7) return phone

  const head = digits.slice(0, 3)
  const area = digits.slice(3, 6)
  const last4 = digits.slice(-4)
  return `${hasPlus ? "+" : ""}${head} ${area} •••• ${last4}`
}
