import type { ReactNode } from "react"

import type { TxPanelTitleProps } from "@/types/components"

/** Card primitive (design §5: white/--card, 1px --line, radius 16, pad 18/20). */
export function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[16px] border border-line bg-card p-[18px_20px]">
      {children}
    </div>
  )
}

/** A panel's bold title, with an optional muted trailing note (" · {note}"). */
export function PanelTitle({ children, note }: TxPanelTitleProps) {
  return (
    <div className="mb-3 text-[13px] font-extrabold text-ink">
      {children}
      {note && <span className="font-semibold text-ink3"> · {note}</span>}
    </div>
  )
}
