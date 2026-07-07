import { cn } from "@/lib/utils"
import { TIMELINE_TONE } from "@/constants/transaction-detail"
import { formatWhen, timelineTone } from "@/lib/transactions/tx-detail"
import type { TxTimelineStepProps } from "@/types/components"

/** One derived lifecycle event → the design's vertical stepper node. */
export function TimelineStep({ entry, hasNext }: TxTimelineStepProps) {
  const tone = TIMELINE_TONE[timelineTone(entry.status)]
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-[22px] flex-none items-center justify-center rounded-full",
            tone.dotBg,
            tone.dotFg
          )}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d={tone.icon}
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        {hasNext && <span className="min-h-4 w-0.5 flex-1 bg-line2" />}
      </div>
      <div className="flex-1 pb-3.5">
        <div className={cn("text-[12.5px] font-bold capitalize", tone.fg)}>
          {entry.status}
        </div>
        <div className="font-mono text-[10.5px] text-ink3 tabular-nums">
          {formatWhen(entry.at)}
        </div>
      </div>
    </div>
  )
}
