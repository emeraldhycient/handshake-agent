"use client"

/**
 * ApprovalsPage — pixel-faithful reproduction of the operator-console design's
 * maker-checker approval inbox (design §6 Approvals — `docs/design-ref/screens/
 * Approvals.html`, data logic `docs/design-ref/logic.js` `vApprovals()` +
 * `approveItem()` / `rejectItem()` + the `approvals` seed at lines 76-79).
 *
 *   • header ("Approvals" + dual-control subtitle),
 *   • two pill tabs with count badges — "Awaiting me" / "My requests"
 *     (design `aprTabs`),
 *   • an "Inbox zero" empty state when the active bucket is empty (`aprEmpty`),
 *   • a column of request cards (`aprRows`): a kind pill, title + "Requested by …
 *     · ago · resource" meta, a mono request id, a reason box, an itemized from→to
 *     diff, then a footer that is either the "your own request" guard, the Reject /
 *     Approve actions, or a "requires an approver role" locked note.
 *
 * DATA IS THE DESIGN'S OWN MOCK CONTENT (design-faithful, no API): `SAMPLE_REQUESTS`
 * translates the design's `approvals` seed verbatim; the current operator is the
 * design's default `super_admin` role (`ROLE`) so every request reads as
 * "Awaiting me" and the Approve/Reject actions are live — matching what the design
 * renders on first paint. Real API reintegration is a later step.
 *
 * ACTIONS mirror the design's destinations: Approve dismisses the row directly
 * (design `approveItem` — no modal), Reject opens the shared ReasonModal
 * (design `rejectItem` → `runFlow({steps:['reason']})`) and dismisses on continue.
 *
 * Funds-safety (root §3.1): this screen never moves money — Approve / Reject are
 * design-faithful and only dismiss the local queue row.
 */
import { useMemo, useState } from "react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { ReasonModal } from "@/components/admin/flows"
import type {
  ApprovalDiffRow,
  ApprovalKind,
  ApprovalRequest,
} from "@/types/components"

// The design's default viewer role (`state.role`, logic.js line 147). super_admin
// holds every capability incl. `approve` (`can('approve')`), so on first paint the
// four seed requests are all "Awaiting me" with live Approve / Reject actions.
const ROLE = "super_admin"

// super_admin holds the `approve` capability (design `can()`, logic.js 175-186).
const CAN_APPROVE = true

// Kind pill → the design's `kindColor` token pair (logic.js line 764) as a Badge
// variant. Colour is paired with the kind label text, so it is never the sole signal.
//   Pricing change / Refund / KYC decision → --sif/--tif (info)
//   Capability / Tier override             → --swn/--twn (warn)  [design's #f6ead6/#a86f16 ≈ warn tokens]
//   Manual credit                          → --sok/--tok (success)
const KIND_VARIANT: Record<ApprovalKind, "info" | "warn" | "success"> = {
  "Pricing change": "info",
  Capability: "warn",
  Refund: "info",
  "Tier override": "warn",
  "KYC decision": "info",
  "Manual credit": "success",
}

// The design's `approvals` seed (logic.js lines 76-79): four representative
// dual-control requests spanning pricing, capability, refund and tier-override
// changes, each with its maker, originating role, reason and itemized from→to diff.
const SAMPLE_REQUESTS: ApprovalRequest[] = [
  {
    id: "apr_5001",
    kind: "Pricing change",
    title: "USDT/NGN buy spread 85 → 110 bps",
    by: "Tunde Adeyemi",
    byRole: "config_admin",
    ago: "34m ago",
    resource: "Pricing",
    reason: "Cover rising FX volatility on TRON corridor",
    diff: [
      { field: "crypto.buy · USDT/NGN spread", from: "85 bps", to: "110 bps" },
    ],
  },
  {
    id: "apr_5002",
    kind: "Capability",
    title: "Disable swap (global)",
    by: "Amara Okeke",
    byRole: "super_admin",
    ago: "1h ago",
    resource: "Capabilities",
    reason: "Blockradar swap enrollment paused for maintenance",
    diff: [{ field: "capability: swap", from: "Enabled", to: "Disabled" }],
  },
  {
    id: "apr_5003",
    kind: "Refund",
    title: "Partial refund — tx_80257 · ₦180,000.00",
    by: "Kelechi Chukwu",
    byRole: "treasury_ops",
    ago: "2h ago",
    resource: "Transactions",
    reason: "Duplicate charge confirmed with Flutterwave",
    diff: [{ field: "Refund amount", from: "₦0.00", to: "₦180,000.00" }],
  },
  {
    id: "apr_5004",
    kind: "Tier override",
    title: "Ngozi Eze — tier_2 → tier_3",
    by: "Ifeoma Bello",
    byRole: "compliance_officer",
    ago: "3h ago",
    resource: "Users",
    reason: "Enhanced due diligence complete, corporate KYC verified",
    diff: [{ field: "KYC tier", from: "tier_2", to: "tier_3" }],
  },
]

type AprTab = "awaiting" | "mine"

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

/** The from→to arrow that separates the struck-through old value from the new (design line 17). */
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

/** One request card — kind pill, meta, reason, diff, and the RBAC footer (design lines 10-23). */
function RequestCard({
  request,
  mine,
  canApprove,
  onApprove,
  onReject,
}: {
  request: ApprovalRequest
  mine: boolean
  canApprove: boolean
  onApprove: () => void
  onReject: () => void
}) {
  const canAct = canApprove && !mine
  const locked = !canApprove

  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      {/* ── Header: kind pill · title + meta · mono id (design lines 11-15) ── */}
      <div className="mb-3 flex items-start gap-3">
        <Badge
          variant={KIND_VARIANT[request.kind]}
          className="mt-px shrink-0 px-2.5 py-1 text-[10.5px] font-extrabold tracking-[0.04em] uppercase"
        >
          {request.kind}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-bold text-ink">
            {request.title}
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink3">
            Requested by {request.by} · {request.ago} · {request.resource}
          </div>
        </div>
        <span className="shrink-0 font-mono text-[10.5px] text-ink3">
          {request.id}
        </span>
      </div>

      {/* ── Reason box (card2 inset, design line 16) ──────────────────────── */}
      <div className="mb-3 flex items-start gap-2 rounded-[11px] bg-card2 px-3 py-2.5">
        <ReasonIcon />
        <span className="text-xs leading-[1.4] text-ink2">
          {request.reason}
        </span>
      </div>

      {/* ── Itemized from→to diff (design line 17) ────────────────────────── */}
      {request.diff.map((diff) => (
        <DiffLine key={diff.field} diff={diff} />
      ))}

      {/* ── Footer: your-own-request guard · actions · locked note (18-22) ── */}
      <div className="flex items-center gap-2.5">
        {mine && (
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
        )}

        {canAct && (
          <>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onReject}
              className="rounded-[10px] border border-[#f0d0cb] px-4 py-[9px] text-[12.5px] font-bold text-tdn transition-colors hover:bg-sdn focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={onApprove}
              className="rounded-[10px] bg-tok px-[18px] py-[9px] text-[12.5px] font-extrabold text-white transition-colors hover:bg-tok/90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Approve
            </button>
          </>
        )}

        {locked && (
          <>
            <div className="flex-1" />
            <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-ink3">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M6 10V8a6 6 0 0 1 12 0v2M5 10h14v10H5z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                />
              </svg>
              Requires an approver role
            </div>
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
  // Locally-dismissed requests (design Approve/Reject remove the row from the queue).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  // The ReasonModal is the design's reject flow (`rejectItem` → runFlow(['reason'])).
  const [rejecting, setRejecting] = useState<ApprovalRequest | null>(null)

  // A request is "mine" when it was raised by my own role — dual control means it
  // needs a different admin (design `mine: a.role === st.role`, logic.js line 765).
  const requests = useMemo(
    () => SAMPLE_REQUESTS.filter((r) => !dismissed.has(r.id)),
    [dismissed]
  )
  const awaiting = useMemo(
    () => requests.filter((r) => r.byRole !== ROLE),
    [requests]
  )
  const mine = useMemo(
    () => requests.filter((r) => r.byRole === ROLE),
    [requests]
  )
  const visible = tab === "mine" ? mine : awaiting

  function dismiss(id: string) {
    setDismissed((prev) => new Set(prev).add(id))
  }

  function confirmReject() {
    if (rejecting) dismiss(rejecting.id)
    setRejecting(null)
  }

  return (
    <div className="mx-auto w-full max-w-[940px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header (design line 3) ──────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Approvals
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Dual-control queue. High-risk changes require a second admin before
          they take effect.
        </p>
      </div>

      {/* ── Tabs: Awaiting me · My requests (design lines 4-6) ──────────── */}
      <div
        className="mb-4 flex gap-[9px]"
        role="tablist"
        aria-label="Approval buckets"
      >
        {(
          [
            ["awaiting", "Awaiting me", awaiting.length],
            ["mine", "My requests", mine.length],
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

      {/* ── Empty (Inbox zero) / Data: request cards (design lines 7-25) ── */}
      {visible.length === 0 ? (
        <InboxZero />
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              mine={tab === "mine"}
              canApprove={CAN_APPROVE}
              onApprove={() => dismiss(request.id)}
              onReject={() => setRejecting(request)}
            />
          ))}
        </div>
      )}

      {/* ── Reject flow (design `rejectItem` → reason step) ─────────────── */}
      <ReasonModal
        open={rejecting !== null}
        onOpenChange={(open) => {
          if (!open) setRejecting(null)
        }}
        title={rejecting ? `Reject · ${rejecting.title}` : "Reject"}
        onContinue={confirmReject}
      />
    </div>
  )
}
