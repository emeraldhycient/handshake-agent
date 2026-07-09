import Link from "next/link"

import { ShapeGapNote } from "./shape-gap-note"

/**
 * Live conversation monitor — there is no LIVE (streaming) monitor feed, but
 * WhatsApp threads are logged to the agent conversation log, readable from the
 * Agent console's Conversations section. Point the operator there instead of
 * fabricating redacted chat bubbles here.
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
      <ShapeGapNote title="No live feed — transcripts live in the Agent console">
        WhatsApp conversations are logged to the agent conversation log. Open{" "}
        <Link
          href="/agent"
          className="font-bold text-tif underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Agent config → Conversations
        </Link>{" "}
        to review read-only, intent-annotated transcripts.
      </ShapeGapNote>
    </div>
  )
}
