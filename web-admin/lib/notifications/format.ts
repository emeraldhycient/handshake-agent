import type { BroadcastSchedule } from "@handshake-agent/contracts"

import type { BroadcastOption } from "@/types"

/**
 * Humanize a notification event type into the design's audience/context slot
 * (`kyc_approved` → "Kyc approved"). The backend surfaces the triggering event, not a
 * broadcast cohort, so this is the audience column's real backing.
 */
export function eventLabel(eventType: string): string {
  const spaced = eventType.replace(/_/g, " ").trim()
  return spaced.length === 0
    ? eventType
    : spaced[0].toUpperCase() + spaced.slice(1)
}

/** A compact relative "time ago" label from an ISO issue-time. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "—"
  const diffMs = Date.now() - then
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return "just now"
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return day === 1 ? "Yesterday" : `${day}d ago`
}

/** Distinct template keys become the composer's TEMPLATE options, in list order. */
export function toTemplateOptions(
  keys: readonly string[]
): readonly BroadcastOption[] {
  const seen = new Set<string>()
  const options: BroadcastOption[] = []
  for (const key of keys) {
    if (seen.has(key)) continue
    seen.add(key)
    options.push({ value: key, label: key })
  }
  return options
}

/**
 * Map the composer's schedule select (+ optional custom `datetime-local` value) to the
 * contract's schedule union. Only a `custom` selection with a parseable time is a
 * scheduled send; everything else is immediate (the server re-validates a `sendAt` anyway).
 */
export function buildSchedule(
  when: string,
  customAt: string
): BroadcastSchedule {
  if (when === "custom" && customAt) {
    const at = new Date(customAt)
    if (!Number.isNaN(at.getTime())) {
      return { kind: "scheduled", sendAt: at.toISOString() }
    }
  }
  return { kind: "now" }
}

/** Percent label for a rate fraction in [0,1] (0.004 → "0.4%"). */
export function pct(rate: number): string {
  return `${(rate * 100).toFixed(2).replace(/\.?0+$/, "")}%`
}
