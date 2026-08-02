import type { ShapeGapNoteProps } from "@/types"

/**
 * An honest shape-gap note for a panel whose backing read endpoint does not exist yet.
 * Shown instead of fabricating design-representative data.
 */
export function ShapeGapNote({ title, children }: ShapeGapNoteProps) {
  return (
    <div className="rounded-[12px] border border-dashed border-line2 px-4 py-6 text-center">
      <p className="text-[13px] font-bold text-ink">{title}</p>
      <p className="mt-1 text-[12px] leading-snug text-ink2">{children}</p>
    </div>
  )
}
