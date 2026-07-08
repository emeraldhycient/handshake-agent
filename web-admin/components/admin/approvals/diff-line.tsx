import type { DiffLineProps } from "@/types/components"

import { DiffArrow } from "./approval-icons"

/** A single from→to change row inside a request card (design line 17). */
export function DiffLine({ diff }: DiffLineProps) {
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
