"use client"

import { UsersBulkActions } from "@/components/admin/users-bulk-actions"
import type { UsersBulkBarProps } from "@/types/components"

/**
 * The contextual bulk-actions bar (inset inside the table header) shown when rows
 * are selected: count · Export · step-up-guarded Tag/Message · Clear. Nothing here
 * moves money — a tag is an annotation, a message enqueues onto the outbox (§3.1).
 */
export function UsersBulkBar({
  count,
  exporting,
  onExport,
  selectedIds,
  onActionDone,
  onClear,
}: UsersBulkBarProps) {
  return (
    <div className="m-[14px] flex items-center gap-[14px] rounded-[13px] bg-btn-dark px-4 py-[11px] text-white motion-safe:animate-hs-in">
      <span className="text-[13px] font-bold tabular-nums">
        {count} selected
      </span>
      <div className="h-[18px] w-px bg-white/20" />
      <button
        type="button"
        onClick={onExport}
        disabled={exporting}
        className="text-[12.5px] font-semibold opacity-90 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none disabled:opacity-50"
      >
        {exporting ? "Exporting…" : "Export"}
      </button>
      <UsersBulkActions selectedIds={selectedIds} onDone={onActionDone} />
      <div className="flex-1" />
      <button
        type="button"
        onClick={onClear}
        className="text-[12.5px] font-semibold opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
      >
        Clear
      </button>
    </div>
  )
}
