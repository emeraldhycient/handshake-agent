/**
 * Middle-truncate a long identifier (crypto address) for display, keeping the
 * first `head` and last `tail` characters. NOTE: this uses head=6/tail=4 — it is
 * NOT the same as `lib/transaction` `shortAddress` (6/6); the masked width here
 * is intentional and must not change.
 */
export function truncateMiddle(s: string, head = 6, tail = 4): string {
  if (s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}
