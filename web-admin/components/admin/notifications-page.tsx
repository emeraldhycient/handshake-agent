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
 * DATA (Phase 6a): the TEMPLATE select is wired to the real
 * `GET /admin/notification-templates` endpoint via `useNotificationTemplates()`
 * (its keys become the options).
 *
 * DATA (Phase 6b, Comms READ enrichment): the DELIVERY LOG is now wired to the
 * real `GET /admin/notifications/delivery-log` endpoint via `useDeliveryLog()` —
 * each row is an issued `Notification` (primary channel · template key · triggering
 * event · relative issue-time · derived status) and the footnote's bounce/complaint
 * rates come from the aggregate dispatch stats (Resend + WhatsApp). Four async
 * branches (loading / error / empty / data). The AUDIENCE cohorts are the design's
 * module-level `<option>`s whose values map to the `BroadcastAudience` contract
 * cohorts; the SERVER resolves each cohort's real membership.
 *
 * WRITE (Phase 7): the composer's send is LIVE — the confirm-modal submit fires
 * POST /admin/notifications/broadcast via `useSendBroadcast()` (step-up-wrapped).
 * The SERVER re-resolves the cohort size and decides the disposition: a small
 * audience is `dispatched` through the notifications outbox now; a large audience is
 * `queued_for_approval` as a maker-checker ChangeRequest for a second admin (§3.5).
 *
 * FUNDS-SAFETY: a broadcast moves no money (§3.1) but is high-impact. It NEVER sends
 * on click — every send opens the shared confirm modal first (a large audience
 * carries the design's `bBig` maker-checker framing), and only the modal's submit
 * fires the real send. The client's reach estimate is only a UX hint; the server is
 * authoritative on the size gate.
 */
import { useState } from "react"

import { MakerCheckerModal, StepUpModal } from "@/components/admin/flows"
import { TemplateEditorDialog } from "@/components/admin/template-editor-dialog"
import { pushToast } from "@/lib/store/toast-store"
import { NativeSelect } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useDeliveryLog,
  useNotificationTemplates,
  useSendBroadcast,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import type {
  BroadcastSchedule,
  BroadcastSendRequest,
  DeliveryLogEntry,
  DeliveryLogStatus,
  NotificationChannel,
} from "@handshake-agent/contracts"
import type {
  BroadcastOption,
  DeliveryChannel,
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

/**
 * Fallback template `<option>`s — used only while the real
 * `GET /admin/notification-templates` list is loading or empty, so the composer
 * always has a valid selection to render (the design's own keys).
 */
const FALLBACK_TEMPLATE_OPTIONS: readonly BroadcastOption[] = [
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

// ─── Contract → presentation mapping (delivery log) ──────────────────────────────────

/** The contract's lowercase channel enum → the design's cased chip label + tokens. */
const CHANNEL_LABEL: Record<NotificationChannel, DeliveryChannel> = {
  whatsapp: "WhatsApp",
  email: "Email",
  sms: "SMS",
  in_app: "In-app",
}

/** The contract's lowercase status enum → the design's cased pill label + tokens. */
const STATUS_LABEL: Record<DeliveryLogStatus, DeliveryStatus> = {
  delivered: "Delivered",
  sent: "Sent",
  sending: "Sending",
  bounced: "Bounced",
  failed: "Failed",
}

/**
 * Humanize a notification event type into the design's audience/context slot
 * (`kyc_approved` → "Kyc approved"). The backend surfaces the triggering event,
 * not a broadcast cohort, so this is the audience column's real backing.
 */
function eventLabel(eventType: string): string {
  const spaced = eventType.replace(/_/g, " ").trim()
  return spaced.length === 0
    ? eventType
    : spaced[0].toUpperCase() + spaced.slice(1)
}

/** A compact relative "time ago" label from an ISO issue-time (design's `time`). */
function relativeTime(iso: string): string {
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

/** Distinct template keys become the composer's TEMPLATE `<option>`s, in list order. */
function toTemplateOptions(
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
 * Map the composer's schedule select (+ optional custom `datetime-local` value) to
 * the contract's schedule union. Only a `custom` selection with a parseable time is
 * a scheduled send; everything else (Send now / an unfilled custom) is immediate —
 * the server re-validates a scheduled `sendAt` anyway.
 */
function buildSchedule(when: string, customAt: string): BroadcastSchedule {
  if (when === "custom" && customAt) {
    const at = new Date(customAt)
    if (!Number.isNaN(at.getTime())) {
      return { kind: "scheduled", sendAt: at.toISOString() }
    }
  }
  return { kind: "now" }
}

/** A human message for a failed broadcast send (surfaced as a danger toast). */
function sendErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "Couldn't send the broadcast. Please try again."
}

/** The broadcast composer: Audience / Template / Schedule + the `bBig` warning + CTA. */
function BroadcastComposer() {
  // The TEMPLATE options come from the real notification-templates list; while it
  // loads (or if it is empty) the composer falls back to the design's own keys so
  // it always has a valid selection.
  const templatesQuery = useNotificationTemplates()
  const templateOptions =
    templatesQuery.data && templatesQuery.data.items.length > 0
      ? toTemplateOptions(templatesQuery.data.items.map((t) => t.templateKey))
      : FALLBACK_TEMPLATE_OPTIONS

  const [audience, setAudience] = useState(AUDIENCE_OPTIONS[0].value)
  const [templateKey, setTemplateKey] = useState(
    FALLBACK_TEMPLATE_OPTIONS[0].value
  )
  const [when, setWhen] = useState(SCHEDULE_OPTIONS[0].value)
  const [customAt, setCustomAt] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [queued, setQueued] = useState(false)
  // The shared template editor — opened from the composer to author a new template
  // (POST via useUpsertTemplate + step-up). On save it invalidates the templates
  // list, so the TEMPLATE select above picks up the new key.
  const [editorOpen, setEditorOpen] = useState(false)

  // The REAL broadcast send (Phase 7). A broadcast moves no money (§3.1) but is
  // high-impact, so the endpoint is step-up gated — a 403 opens the step-up dialog
  // and replays the send (useStepUpRetry). The SERVER decides the disposition from
  // the resolved cohort size (dispatched vs queued-for-approval); the client's reach
  // estimate is only a UX hint for the confirm-modal framing.
  const sendBroadcast = useSendBroadcast()
  const stepUp = useStepUpRetry()

  // Keep the select controlled against whatever options are live: if the current
  // key isn't among the resolved options (e.g. real templates just loaded), show
  // the first available one instead of an out-of-range value.
  const selectedTemplate = templateOptions.some((o) => o.value === templateKey)
    ? templateKey
    : (templateOptions[0]?.value ?? templateKey)

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
  // modal's submit fires the real send.
  function queueBroadcast() {
    setConfirmOpen(true)
  }

  // Build the contract request from the composer's fields. `datetime-local` has no
  // timezone, so a custom time is normalized to an ISO instant for the wire.
  function buildRequest(): BroadcastSendRequest {
    return {
      // The AUDIENCE_OPTIONS values are exactly the BroadcastAudience cohorts; the
      // api client re-parses the body through the contract schema before it fires.
      audience: audience as BroadcastSendRequest["audience"],
      templateKey: selectedTemplate,
      schedule: buildSchedule(when, customAt),
      reason: `Broadcast to ${audienceLabel}`,
    }
  }

  // The confirm-modal submit: fire the REAL send (step-up-wrapped). On success the
  // SERVER's outcome drives the toast — a large audience returns queued-for-approval
  // (a maker-checker request for a second admin), a small one dispatched now. The
  // send is the ONLY thing the modal's submit does — a broadcast never sends without
  // the confirm modal (root §3.1/§3.5).
  async function submitBroadcast() {
    const request = buildRequest()
    try {
      const completed = await stepUp.run(() => runSend(request))
      // If the send completed (or triggered a step-up challenge), close the confirm
      // modal — the step-up dialog now owns the flow until the operator re-auths.
      if (completed || stepUp.open) setConfirmOpen(false)
    } catch (error) {
      // A non-step-up failure (validation / server error) — surface it, keep the
      // composer open so the operator can retry. Never silently swallow (root §13.6).
      setConfirmOpen(false)
      pushToast(sendErrorMessage(error), "warn")
    }
  }

  // Replay the send after a successful step-up re-auth (useStepUpRetry.retry).
  async function retryAfterStepUp() {
    stepUp.setOpen(false)
    try {
      await stepUp.retry()
    } catch (error) {
      pushToast(sendErrorMessage(error), "warn")
    }
  }

  // The single send action, shared by the first attempt + the post-step-up replay:
  // fire the mutation and let the SERVER's outcome drive the confirmation toast.
  async function runSend(request: BroadcastSendRequest): Promise<void> {
    const result = await sendBroadcast.mutateAsync(request)
    setQueued(true)
    pushToast(
      result.outcome === "queued_for_approval"
        ? "Broadcast queued for approval"
        : "Broadcast sent",
      "ok"
    )
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
          <div className="mb-[5px] flex items-center justify-between">
            <FieldLabel>TEMPLATE</FieldLabel>
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="text-[11px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              New template
            </button>
          </div>
          <NativeSelect
            aria-label="Broadcast template"
            className="h-10 rounded-[10px] text-[13px] font-semibold"
            value={selectedTemplate}
            onChange={onFieldChange(setTemplateKey)}
          >
            {templateOptions.map((option) => (
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
          { field: "Template", from: "—", to: selectedTemplate },
          { field: "Schedule", from: "—", to: scheduleLabel },
        ]}
        onSubmit={() => void submitBroadcast()}
      />

      {/* Step-up (TOTP) — opened when the send 403s ADMIN_STEP_UP_REQUIRED; on
          completion the stashed send is replayed (useStepUpRetry). */}
      <StepUpModal
        open={stepUp.open}
        onOpenChange={stepUp.setOpen}
        title="send broadcast"
        onComplete={() => void retryAfterStepUp()}
      />

      {/* Author a new notification template inline (POST via useUpsertTemplate). */}
      <TemplateEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        template={null}
      />
    </div>
  )
}

/** A single delivery-log row: channel chip + template name + event·time + status pill. */
function DeliveryRow({ entry }: { entry: DeliveryLogEntry }) {
  const channel = CHANNEL_LABEL[entry.channel]
  const status = STATUS_LABEL[entry.status]
  // A plain-fallback notification (no template) renders its event as the name.
  const name = entry.templateKey ?? eventLabel(entry.eventType)
  return (
    <div className="flex items-center gap-[11px] border-b border-line2 px-[18px] py-3 last:border-b-0">
      <span
        className={`flex-none rounded-md px-2 py-[2px] text-[10.5px] font-bold ${CHANNEL_CLASS[channel]}`}
      >
        {channel}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold text-ink">
          {name}
        </div>
        <div className="text-[10.5px] text-ink3">
          {eventLabel(entry.eventType)} · {relativeTime(entry.createdAt)}
        </div>
      </div>
      <span
        className={`rounded-full px-[9px] py-[2px] text-[10.5px] font-bold ${STATUS_CLASS[status]}`}
      >
        {status}
      </span>
    </div>
  )
}

/** Percent label for a rate fraction in [0,1] (0.004 → "0.4%"). */
function pct(rate: number): string {
  return `${(rate * 100).toFixed(2).replace(/\.?0+$/, "")}%`
}

/** Skeleton rows for the delivery-log loading branch (matches the row rhythm). */
function DeliveryRowsSkeleton() {
  return (
    <div aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-[11px] border-b border-line2 px-[18px] py-3 last:border-b-0"
        >
          <Skeleton className="h-4 w-16 rounded-md" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-1.5 h-2.5 w-24" />
          </div>
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

/**
 * The read-only delivery log — wired to `useDeliveryLog()`. Header carries the
 * real bounce/complaint footnote (aggregate dispatch stats); four async branches
 * (loading / error / empty / data).
 */
function DeliveryLog() {
  const { data, isLoading, isError, refetch } = useDeliveryLog()

  const footnote = data
    ? `bounce ${pct(data.stats.bounceRate)} · complaint ${pct(
        data.stats.complaintRate
      )} (Resend + WhatsApp)`
    : "bounce / complaint (Resend + WhatsApp)"

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="flex items-center gap-2.5 border-b border-line px-[18px] py-3.5">
        <div className="flex-1 text-[13px] font-extrabold text-ink">
          Delivery log
        </div>
        <span className="text-[11px] text-ink3">{footnote}</span>
      </div>

      {isLoading && <DeliveryRowsSkeleton />}

      {isError && (
        <div className="m-[18px] rounded-[9px] border border-sdn bg-sdn/40 px-3 py-[11px] text-center">
          <p className="text-[12px] font-bold text-tdn">
            Couldn&apos;t load the delivery log
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-1 cursor-pointer rounded-md px-1 text-[11.5px] font-bold text-tif hover:bg-hov focus-visible:outline focus-visible:outline-2 focus-visible:outline-tif"
          >
            Retry
          </button>
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="px-[18px] py-10 text-center">
          <p className="text-[13px] font-bold text-ink">No deliveries yet</p>
          <p className="mt-1 text-[12px] text-ink2">
            Notifications sent to customers will appear here.
          </p>
        </div>
      )}

      {data &&
        data.items.length > 0 &&
        data.items.map((entry) => (
          <DeliveryRow key={entry.id} entry={entry} />
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
