"use client"

/**
 * NotificationsPage — the "Notifications & comms" surface (operator-console design
 * §6.18), rebuilt 1:1 against `docs/design-ref/screens/Notifications.html`.
 *
 * Layout: a `1fr 1.3fr` row — a **Broadcast composer** (Audience / Template /
 * Schedule selects, a large-audience maker-checker warning, and the amber send
 * CTA) beside a read-only **Delivery log** (channel chip + name + audience·time +
 * status pill, closed by a bounce/complaint footnote).
 *
 * DATA: this is a design reproduction — the audience / template / schedule options
 * and the delivery log are the design's own module-level mock content (no fetching,
 * no TanStack Query). Real-data reintegration is a separate later step.
 *
 * FUNDS-SAFETY: composing a broadcast never sends on click. Every send opens the
 * shared confirm modal first — a large audience flips the composer into maker-checker
 * mode (the design's `bBig` warning + "Queue for approval" CTA) so the broadcast
 * enters Pending approval before it goes out; a small audience gets a plain confirm.
 * Only the modal's submit marks it queued/sent — matching the design's proposal-only
 * posture (root §3.1).
 */
import { useState } from "react"

import { MakerCheckerModal } from "@/components/admin/flows"
import { pushToast } from "@/lib/store/toast-store"
import { NativeSelect } from "@/components/ui/native-select"
import type {
  BroadcastOption,
  DeliveryChannel,
  DeliveryLogRow,
  DeliveryStatus,
} from "@/types/components"

// ─── Design mock content (docs/design-ref/screens/Notifications.html) ────────────────

/** Audience cohorts — the design's `<option>`s, each carrying its reach count. */
const AUDIENCE_OPTIONS: readonly BroadcastOption[] = [
  { value: "lagos", label: "Cohort: Lagos (2,140)" },
  { value: "tier_1", label: "tier_1 users (8,920)" },
  { value: "verified", label: "All verified (24,610)" },
  { value: "all", label: "All users (31,204)" },
]

/** Template keys — the design's `<option>`s. */
const TEMPLATE_OPTIONS: readonly BroadcastOption[] = [
  { value: "kyc_reminder", label: "kyc_reminder" },
  { value: "tx_confirmation", label: "tx_confirmation" },
  { value: "promo_ticketing", label: "promo_ticketing" },
]

/** Schedule options — the design's `<option>`s. */
const SCHEDULE_OPTIONS: readonly BroadcastOption[] = [
  { value: "now", label: "Send now" },
  { value: "9am", label: "Tomorrow 9:00" },
  { value: "custom", label: "Custom…" },
]

/**
 * The reach of each audience, used to flip the composer into maker-checker mode
 * (the design's `bBig`). Large cohorts require a second admin's approval.
 */
const AUDIENCE_REACH: Record<string, number> = {
  lagos: 2140,
  tier_1: 8920,
  verified: 24610,
  all: 31204,
}

/** Audiences at/above this reach require maker-checker (the design's `bBig`). */
const LARGE_AUDIENCE_THRESHOLD = 10000

// design mock: the design's representative delivery-log rows (seed()-shaped names).
const DELIVERY_ROWS: readonly DeliveryLogRow[] = [
  {
    id: "d1",
    channel: "WhatsApp",
    name: "kyc_reminder",
    audience: "tier_1 users",
    time: "12m ago",
    status: "Delivered",
  },
  {
    id: "d2",
    channel: "Email",
    name: "promo_ticketing",
    audience: "All verified",
    time: "1h ago",
    status: "Sent",
  },
  {
    id: "d3",
    channel: "WhatsApp",
    name: "tx_confirmation",
    audience: "Cohort: Lagos",
    time: "3h ago",
    status: "Delivered",
  },
  {
    id: "d4",
    channel: "SMS",
    name: "otp_fallback",
    audience: "All users",
    time: "5h ago",
    status: "Sending",
  },
  {
    id: "d5",
    channel: "Email",
    name: "kyc_reminder",
    audience: "tier_1 users",
    time: "Yesterday",
    status: "Bounced",
  },
]

// ─── Status → token maps (§5 status→token pairs) ─────────────────────────────────────

/** Channel chip → `{{ d.chanBg }}` / `{{ d.chanFg }}` (§5 status-token surface + text). */
const CHANNEL_CLASS: Record<DeliveryChannel, string> = {
  WhatsApp: "bg-sok text-tok",
  Email: "bg-sif text-tif",
  SMS: "bg-swn text-twn",
  "In-app": "bg-card2 text-ink2",
}

/** Delivery status pill → `{{ d.stBg }}` / `{{ d.stFg }}` (§5 status-token surface + text). */
const STATUS_CLASS: Record<DeliveryStatus, string> = {
  Delivered: "bg-sok text-tok",
  Sent: "bg-sok text-tok",
  Queued: "bg-sif text-tif",
  Scheduled: "bg-sif text-tif",
  Sending: "bg-swn text-twn",
  Bounced: "bg-sdn text-tdn",
  Failed: "bg-sdn text-tdn",
}

// ─── Sub-components ─────────────────────────────────────────────────────────────────

/** An uppercase eyebrow label above a composer field (design 11px/700 ink3). */
function FieldLabel({ children }: { children: string }) {
  return (
    <div className="mb-[5px] text-[11px] font-bold text-ink3">{children}</div>
  )
}

/** The large-audience maker-checker warning (design's `sc-if bBig`). */
function MakerCheckerWarning() {
  return (
    <div className="flex items-center gap-2 rounded-[9px] bg-swn px-3 py-[9px]">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="shrink-0 text-twn"
      >
        <path
          d="M12 4l9 16H3z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[11px] font-semibold text-twn">
        Large audience — requires maker-checker.
      </span>
    </div>
  )
}

/** The broadcast composer: Audience / Template / Schedule + the `bBig` warning + CTA. */
function BroadcastComposer() {
  const [audience, setAudience] = useState(AUDIENCE_OPTIONS[0].value)
  const [templateKey, setTemplateKey] = useState(TEMPLATE_OPTIONS[0].value)
  const [when, setWhen] = useState(SCHEDULE_OPTIONS[0].value)
  const [customAt, setCustomAt] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [queued, setQueued] = useState(false)

  const isLargeAudience =
    (AUDIENCE_REACH[audience] ?? 0) >= LARGE_AUDIENCE_THRESHOLD
  const isCustomSchedule = when === "custom"
  const audienceLabel =
    AUDIENCE_OPTIONS.find((o) => o.value === audience)?.label ?? audience
  const scheduleLabel = isCustomSchedule
    ? customAt || "Custom…"
    : (SCHEDULE_OPTIONS.find((o) => o.value === when)?.label ?? when)

  function onFieldChange(setter: (value: string) => void) {
    return (event: React.ChangeEvent<HTMLSelectElement>) => {
      setter(event.target.value)
      setQueued(false)
    }
  }

  // A broadcast is proposal-only: it never sends on click. Every send opens the
  // shared confirm modal first — a large audience carries the maker-checker
  // (dual-control) framing, a small audience a plain confirm — and only the
  // modal's submit marks it queued/sent.
  function queueBroadcast() {
    setConfirmOpen(true)
  }

  const cta = isLargeAudience
    ? "Queue broadcast for approval"
    : "Send broadcast"
  const ctaLabel = queued
    ? isLargeAudience
      ? "Queued for approval"
      : "Broadcast sent"
    : cta

  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3.5 text-[13px] font-extrabold text-ink">
        Broadcast composer
      </div>

      <div className="flex flex-col gap-[11px]">
        <div>
          <FieldLabel>AUDIENCE</FieldLabel>
          <NativeSelect
            aria-label="Broadcast audience"
            className="h-10 rounded-[10px] text-[13px] font-semibold"
            value={audience}
            onChange={onFieldChange(setAudience)}
          >
            {AUDIENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div>
          <FieldLabel>TEMPLATE</FieldLabel>
          <NativeSelect
            aria-label="Broadcast template"
            className="h-10 rounded-[10px] text-[13px] font-semibold"
            value={templateKey}
            onChange={onFieldChange(setTemplateKey)}
          >
            {TEMPLATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div>
          <FieldLabel>SCHEDULE</FieldLabel>
          <NativeSelect
            aria-label="Broadcast schedule"
            className="h-10 rounded-[10px] text-[13px] font-semibold"
            value={when}
            onChange={onFieldChange(setWhen)}
          >
            {SCHEDULE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>

          {isCustomSchedule && (
            <input
              type="datetime-local"
              aria-label="Custom send time"
              value={customAt}
              onChange={(event) => {
                setCustomAt(event.target.value)
                setQueued(false)
              }}
              className="mt-[7px] h-10 w-full rounded-[10px] border border-line bg-field px-3 text-[13px] font-semibold text-ink transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          )}
        </div>

        {isLargeAudience && <MakerCheckerWarning />}

        <button
          type="button"
          onClick={queueBroadcast}
          aria-label={ctaLabel}
          className="rounded-[11px] bg-brand-amber px-3 py-3 text-center text-[13.5px] font-extrabold text-[--ink-on-amber] transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {ctaLabel}
        </button>
      </div>

      <MakerCheckerModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={
          isLargeAudience ? "Queue broadcast for approval" : "Confirm broadcast"
        }
        diff={[
          { field: "Audience", from: "—", to: audienceLabel },
          { field: "Template", from: "—", to: templateKey },
          { field: "Schedule", from: "—", to: scheduleLabel },
        ]}
        onSubmit={() => {
          setConfirmOpen(false)
          setQueued(true)
          pushToast(
            isLargeAudience
              ? "Broadcast queued for approval"
              : "Broadcast sent",
            "ok"
          )
        }}
      />
    </div>
  )
}

/** A single delivery-log row: channel chip + name + audience·time + status pill. */
function DeliveryRow({ row }: { row: DeliveryLogRow }) {
  return (
    <div className="flex items-center gap-[11px] border-b border-line2 px-[18px] py-3 last:border-b-0">
      <span
        className={`flex-none rounded-md px-2 py-[2px] text-[10.5px] font-bold ${CHANNEL_CLASS[row.channel]}`}
      >
        {row.channel}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold text-ink">
          {row.name}
        </div>
        <div className="text-[10.5px] text-ink3">
          {row.audience} · {row.time}
        </div>
      </div>
      <span
        className={`rounded-full px-[9px] py-[2px] text-[10.5px] font-bold ${STATUS_CLASS[row.status]}`}
      >
        {row.status}
      </span>
    </div>
  )
}

/** The read-only delivery log (header + bounce/complaint footnote + rows). */
function DeliveryLog() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="flex items-center gap-2.5 border-b border-line px-[18px] py-3.5">
        <div className="flex-1 text-[13px] font-extrabold text-ink">
          Delivery log
        </div>
        <span className="text-[11px] text-ink3">
          bounce 0.4% · complaint 0.02% (Resend)
        </span>
      </div>
      {DELIVERY_ROWS.map((row) => (
        <DeliveryRow key={row.id} row={row} />
      ))}
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export function NotificationsPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Notifications &amp; comms
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Delivery log, bounce/complaint rates, and the broadcast composer.
        </p>
      </div>

      {/* ── 1fr 1.3fr: composer | delivery log ──────────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[1fr_1.3fr]">
        <BroadcastComposer />
        <DeliveryLog />
      </div>
    </div>
  )
}
