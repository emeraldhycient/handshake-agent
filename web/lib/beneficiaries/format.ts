/**
 * Middle-truncate a long identifier (crypto address, PayID handle) for display,
 * keeping the first `head` and last `tail` characters — and returning the input
 * UNCHANGED when abbreviating it would not actually shorten it. That guard is
 * the point of this helper: unguarded head/tail slices overlap on a short input
 * and render it doubled.
 *
 * The DEFAULT head=6/tail=4 is the beneficiary-list width and must not change —
 * it is deliberately NOT `lib/transaction` `shortAddress` (6/6). Callers with
 * their own deliberate width pass it explicitly (the Activity subtitle uses
 * 4/4); that is what the parameters are for.
 */
export function truncateMiddle(s: string, head = 6, tail = 4): string {
  if (s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}
