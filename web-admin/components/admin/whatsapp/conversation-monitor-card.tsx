import { ShapeGapNote } from "./shape-gap-note"

/**
 * Live conversation monitor — there is NO WhatsApp conversation-monitor read endpoint
 * yet, so rather than fabricate redacted chat bubbles this shows an honest shape-gap
 * note (deferred).
 */
export function ConversationMonitorCard() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 flex items-center gap-[9px]">
        <div className="flex-1 text-[13px] font-extrabold text-ink">
          Live conversation monitor
        </div>
        <span className="text-[11px] text-ink3">read-only · redacted</span>
      </div>
      <ShapeGapNote title="No conversation feed yet">
        There is no read endpoint for live WhatsApp conversations yet. A
        read-only, redacted transcript will appear here once a monitor feed is
        added.
      </ShapeGapNote>
    </div>
  )
}
