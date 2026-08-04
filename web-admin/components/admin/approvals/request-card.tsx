import { Badge } from "@/components/ui/badge"
import { KIND_META } from "@/constants/approvals"
import { diffRows, relativeAgo, requestTitle } from "@/lib/approvals/rows"
import type { RequestCardProps } from "@/types"

import { DiffLine } from "./diff-line"
import { OwnRequestIcon, ReasonIcon } from "./approval-icons"

/** One request card — kind pill, meta, reason, diff, and the disposition footer. */
export function RequestCard({
  request,
  mine,
  busy,
  onApprove,
  onReject,
}: RequestCardProps) {
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
            <OwnRequestIcon />
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
