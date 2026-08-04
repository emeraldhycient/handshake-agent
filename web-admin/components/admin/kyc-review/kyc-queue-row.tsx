import { cn } from "@/lib/utils"
import { KYC_GRID, MISSING } from "@/constants/kyc-review"
import type { KycQueueRowProps } from "@/types"

/** One queue row — the design's clickable applicant line (Kyc.html `kycRows`). */
export function KycQueueRowLine({ row, onOpen }: KycQueueRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Review ${row.name}`}
      onClick={() => onOpen(row.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen(row.id)
        }
      }}
      className={cn(
        KYC_GRID,
        "cursor-pointer items-center border-b border-line2 px-[18px] py-[13px] last:border-b-0 hover:bg-hov focus-visible:bg-hov focus-visible:outline-none"
      )}
    >
      {/* Applicant */}
      <div className="flex items-center gap-[11px]">
        <span
          aria-hidden="true"
          style={{ background: row.avatar }}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white"
        >
          {row.initials}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-ink">
            {row.name}
          </div>
          <div className="truncate font-mono text-[10.5px] text-ink3">
            {row.id}
          </div>
        </div>
      </div>

      {/* Requested tier (not provided by the queue contract) */}
      <div>
        {row.tier ? (
          <span className="rounded-full bg-card2 px-[9px] py-[3px] text-[11px] font-bold text-ink2">
            {row.tier}
          </span>
        ) : (
          <span className="text-[12px] text-ink3">{MISSING}</span>
        )}
      </div>

      {/* SLA age (not provided by the queue contract) */}
      <div
        className={cn(
          "text-[12.5px] font-bold tabular-nums",
          row.slaTone === "danger" ? "text-tdn" : "text-ink"
        )}
      >
        {row.sla || <span className="font-normal text-ink3">{MISSING}</span>}
      </div>

      {/* Assignee (not provided by the queue contract) */}
      <div className="truncate text-[12px] text-ink2">
        {row.assignee || <span className="text-ink3">{MISSING}</span>}
      </div>

      {/* Review → */}
      <div className="text-right text-[11.5px] font-bold text-tif">
        Review →
      </div>
    </div>
  )
}
