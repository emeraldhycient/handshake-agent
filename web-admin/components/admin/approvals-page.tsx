"use client"

/**
 * ApprovalsPage — the maker-checker approval inbox (design §6 Approvals). Wired to
 * the real Phase-7 approvals subsystem: `useApprovalsInbox` reads the two
 * caller-relative buckets (Awaiting me / My requests) + their counts; Approve and
 * Reject are the checker's dispositions of a pending change request.
 *
 * Funds-safety (root §3.1): this screen never moves money. A disposition routes
 * through the deterministic engine / config writer server-side — Approve hands the
 * recorded change to the target service to APPLY, Reject applies nothing — and both
 * are sensitive (step-up-gated, audited, idempotent). The UI enforces the chain:
 *   • Approve → StepUpDialog (re-auth) → POST /admin/approvals/:id/approve
 *   • Reject  → ReasonModal (required, audited reason) → POST .../reject
 * Both may 403 with ADMIN_STEP_UP_REQUIRED; `useStepUpRetry` re-auths and replays.
 * On success the inbox is invalidated so the buckets + badges re-resolve.
 *
 * Four async branches (loading / error / empty / data) on the inbox read. The
 * dual-control guard ("your own request") is server-authoritative — a request the
 * caller raised only ever appears under "My requests", never with live actions —
 * and the UI mirrors it by comparing the maker's admin id to the signed-in admin.
 */
import { useState } from "react"
import type {
  ChangeRequest,
  ChangeRequestKind,
} from "@handshake-agent/contracts"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ReasonModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import {
  useAdminMe,
  useApprovalsInbox,
  useApproveChange,
  useRejectChange,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import type { ApprovalDiffRow } from "@/types/components"

// Kind → the design's kind-pill token pair (info / warn / success) + a human label.
// Colour is paired with the label text, so it is never the sole signal.
//   pricing_change / refund → info
//   capability_flip / tier_override → warn
const KIND_META: Record<
  ChangeRequestKind,
  { label: string; variant: "info" | "warn" | "success" }
> = {
  pricing_change: { label: "Pricing change", variant: "info" },
  capability_flip: { label: "Capability", variant: "warn" },
  tier_override: { label: "Tier override", variant: "warn" },
  refund: { label: "Refund", variant: "info" },
  manual_credit: { label: "Manual credit", variant: "warn" },
  notification_broadcast: { label: "Broadcast", variant: "warn" },
  payout_release: { label: "Payout release", variant: "warn" },
}

type AprTab = "awaiting" | "mine"

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

/** Compact relative-time label ("34m ago" / "2h ago" / "3d ago") from an ISO date. */
function relativeAgo(iso: string, now: number = Date.now()): string {
  const deltaMs = Math.max(0, now - new Date(iso).getTime())
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Derive the design's from→to diff rows from a change request's opaque payload.
 * A `{ from, to }` pair renders as a struck-old → new row; any other value renders
 * as a "set to" row. This is display-only — the server re-validates the payload on
 * approval (§3.1); nothing here is trusted as a financial instruction.
 */
function diffRows(cr: ChangeRequest): ApprovalDiffRow[] {
  const entries = Object.entries(cr.payload)
  if (entries.length === 0) {
    return [{ field: cr.resource, from: "current", to: "requested change" }]
  }
  return entries.map(([field, value]) => {
    if (
      value !== null &&
      typeof value === "object" &&
      "from" in value &&
      "to" in value
    ) {
      const pair = value as { from: unknown; to: unknown }
      return { field, from: String(pair.from), to: String(pair.to) }
    }
    return { field, from: "—", to: String(value) }
  })
}

/** A short title for the request row (kind label + target resource). */
function requestTitle(cr: ChangeRequest): string {
  return `${KIND_META[cr.kind].label} · ${cr.resource}`
}

/** A document / reason glyph for the reason box (design line 16). */
function ReasonIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="mt-px shrink-0 text-ink3"
    >
      <path
        d="M8 10h8M8 14h5M6 4h12a1 1 0 0 1 1 1v14l-4-3H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The from→to arrow that separates the struck-through old value from the new. */
function DiffArrow() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-ink3"
    >
      <path
        d="M5 12h14m0 0-5-5m5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** A single from→to change row inside a request card (design line 17). */
function DiffLine({ diff }: { diff: ApprovalDiffRow }) {
  return (
    <div className="mb-3 flex items-center gap-3 rounded-[10px] border border-line px-3 py-2">
      <span className="flex-1 text-[11px] font-semibold text-ink3">
        {diff.field}
      </span>
      <span className="font-mono text-xs font-bold text-tdn/70 tabular-nums line-through">
        {diff.from}
      </span>
      <DiffArrow />
      <span className="font-mono text-[12.5px] font-extrabold text-tok tabular-nums">
        {diff.to}
      </span>
    </div>
  )
}

/** One request card — kind pill, meta, reason, diff, and the disposition footer. */
function RequestCard({
  request,
  mine,
  busy,
  onApprove,
  onReject,
}: {
  request: ChangeRequest
  mine: boolean
  busy: boolean
  onApprove: () => void
  onReject: () => void
}) {
  const meta = KIND_META[request.kind]
  const by = request.requestedByEmail ?? request.requestedByAdminId

  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      {/* ── Header: kind pill · title + meta · mono id ── */}
      <div className="mb-3 flex items-start gap-3">
        <Badge
          variant={meta.variant}
          className="mt-px shrink-0 px-2.5 py-1 text-[10.5px] font-extrabold tracking-[0.04em] uppercase"
        >
          {meta.label}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-bold text-ink">
            {requestTitle(request)}
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink3">
            Requested by {by} · {relativeAgo(request.createdAt)} ·{" "}
            {request.resource}
          </div>
        </div>
        <span className="shrink-0 font-mono text-[10.5px] text-ink3">
          {request.id.slice(0, 8)}
        </span>
      </div>

      {/* ── Reason box ── */}
      <div className="mb-3 flex items-start gap-2 rounded-[11px] bg-card2 px-3 py-2.5">
        <ReasonIcon />
        <span className="text-xs leading-[1.4] text-ink2">
          {request.reason}
        </span>
      </div>

      {/* ── Itemized from→to diff ── */}
      {diffRows(request).map((diff, i) => (
        <DiffLine key={`${diff.field}-${i}`} diff={diff} />
      ))}

      {/* ── Footer: your-own-request guard · Reject / Approve actions ── */}
      <div className="flex items-center gap-2.5">
        {mine ? (
          <div className="flex flex-1 items-center gap-1.5 text-[11.5px] font-semibold text-twn">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 8v5M12 16h.01M12 3l9 16H3z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Your own request — needs a different admin to approve.
          </div>
        ) : (
          <>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onReject}
              disabled={busy}
              className="rounded-[10px] border border-[#f0d0cb] px-4 py-[9px] text-[12.5px] font-bold text-tdn transition-colors hover:bg-sdn focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={onApprove}
              disabled={busy}
              aria-busy={busy}
              className="rounded-[10px] bg-tok px-[18px] py-[9px] text-[12.5px] font-extrabold text-white transition-colors hover:bg-tok/90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              Approve
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** The "Inbox zero" empty bucket (design line 7). */
function InboxZero() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[60px] text-center">
      <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-[12px] bg-sok text-tok">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m5 12 5 5L20 7"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="text-sm font-bold text-ink">Inbox zero</div>
      <div className="mt-[3px] text-[12.5px] text-ink3">
        Nothing awaiting your approval.
      </div>
    </div>
  )
}

export function ApprovalsPage() {
  const [tab, setTab] = useState<AprTab>("awaiting")
  const me = useAdminMe()
  const inbox = useApprovalsInbox()
  const approve = useApproveChange()
  const reject = useRejectChange()
  const stepUp = useStepUpRetry()

  // The request whose Reject reason is being captured (opens ReasonModal).
  const [rejecting, setRejecting] = useState<ChangeRequest | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const awaiting = inbox.data?.awaitingMe ?? []
  const mineList = inbox.data?.myRequests ?? []
  // Prefer the server's authoritative counts; fall back to the loaded list lengths.
  const awaitingCount = inbox.data?.counts.awaitingMe ?? awaiting.length
  const myCount = inbox.data?.counts.myRequests ?? mineList.length
  const visible = tab === "mine" ? mineList : awaiting

  // A request is "mine" when I raised it — dual control means a different admin must
  // approve. Server-authoritative (own requests never land in `awaitingMe`); the UI
  // mirrors it so a stray own-request row still shows the guard, not live actions.
  const myAdminId = me.data?.id
  const busy = approve.isPending || reject.isPending

  // Run a sensitive disposition through the step-up-then-retry gate. `stepUp.run`
  // returns false (and opens the re-auth dialog) on a 403 ADMIN_STEP_UP_REQUIRED;
  // any other error surfaces inline.
  async function runStepUp(action: () => Promise<void>) {
    setActionError(null)
    try {
      await stepUp.run(action)
    } catch (error) {
      setActionError(errorMessage(error))
    }
  }

  function onApprove(request: ChangeRequest) {
    void runStepUp(() =>
      approve.mutateAsync(request.id).then(() => undefined)
    )
  }

  function confirmReject(reason: string) {
    const request = rejecting
    setRejecting(null)
    if (!request) return
    void runStepUp(() =>
      reject
        .mutateAsync({ id: request.id, input: { reason } })
        .then(() => undefined)
    )
  }

  return (
    <div className="mx-auto w-full max-w-[940px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header ── */}
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Approvals
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Dual-control queue. High-risk changes require a second admin before
          they take effect.
        </p>
      </div>

      {actionError && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-sdn bg-sdn/40 px-4 py-3 text-[12.5px] font-semibold text-tdn"
        >
          {actionError}
        </p>
      )}

      {/* ── Tabs: Awaiting me · My requests (counts from the inbox read) ── */}
      <div
        className="mb-4 flex gap-[9px]"
        role="tablist"
        aria-label="Approval buckets"
      >
        {(
          [
            ["awaiting", "Awaiting me", awaitingCount],
            ["mine", "My requests", myCount],
          ] as const
        ).map(([id, label, count]) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={cn(
                "flex h-9 items-center gap-2 rounded-[10px] border px-[15px] text-[12.5px] font-bold transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                active
                  ? "border-btn-dark bg-btn-dark text-white"
                  : "border-line bg-card text-ink2 hover:bg-hov"
              )}
            >
              {label}
              <span
                className={cn(
                  "rounded-full px-[7px] py-px text-[10px] tabular-nums",
                  active ? "bg-white/20 text-white" : "bg-card2 text-ink3"
                )}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Loading / error / empty / data ── */}
      {inbox.isLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-[168px] rounded-2xl" />
          <Skeleton className="h-[168px] rounded-2xl" />
        </div>
      ) : inbox.isError ? (
        <div className="rounded-2xl border border-sdn bg-sdn/40 px-5 py-8 text-center">
          <p className="text-[12.5px] font-semibold text-tdn">
            Failed to load the approvals inbox
          </p>
          <button
            type="button"
            onClick={() => void inbox.refetch()}
            className="mt-2 rounded-[9px] bg-btn-dark px-3.5 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      ) : visible.length === 0 ? (
        <InboxZero />
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              mine={
                tab === "mine" || request.requestedByAdminId === myAdminId
              }
              busy={busy}
              onApprove={() => onApprove(request)}
              onReject={() => setRejecting(request)}
            />
          ))}
        </div>
      )}

      {/* ── Reject flow: reason (audit) → POST .../reject ── */}
      <ReasonModal
        open={rejecting !== null}
        onOpenChange={(open) => {
          if (!open) setRejecting(null)
        }}
        title={rejecting ? `Reject · ${requestTitle(rejecting)}` : "Reject"}
        onContinue={(reason) => confirmReject(reason)}
      />

      {/* ── Step-up re-auth → replays the stashed approve/reject mutation ── */}
      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .catch((error) => setActionError(errorMessage(error)))
        }}
      />
    </div>
  )
}
