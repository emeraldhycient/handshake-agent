"use client"

import type { CSSProperties, KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { chipLabel } from "@/lib/chat/flow"
import { cn } from "@/lib/utils"
import type { ChatComposerProps } from "@/types/components"

export function ChatComposer({
  chips,
  value,
  onChange,
  onSubmit,
  onChip,
  // density accepted for future sizing variants; currently drives no changes
  // (both mobile and desktop use the same compact composer layout)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  density: _density,
  recording,
  recordSeconds,
  canRecord,
  onRecordStart,
  onRecordStop,
  onRecordCancel,
}: ChatComposerProps) {
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="bg-white pt-3 pb-4">
      {/* Chips row — horizontal scroll, no scrollbar */}
      <div
        className="flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pt-1.5 pb-2.5"
        style={{ WebkitOverflowScrolling: "touch" } as CSSProperties}
      >
        {chips.map((action) => (
          <Button
            key={action}
            type="button"
            variant="outline"
            onClick={() => onChip(action)}
            className={cn(
              "flex-none rounded-full whitespace-nowrap",
              "bg-card px-3.5 py-2 text-[13px] font-semibold text-foreground",
              "h-auto border-border shadow-sm"
            )}
          >
            {chipLabel(action)}
          </Button>
        ))}
      </div>

      {/* Input row */}
      <div className="flex items-center gap-2.5 px-3.5">
        {/* Input pill */}
        <div className="flex flex-1 items-center gap-2.5 rounded-full border border-border bg-card px-4 py-[11px]">
          {/* Attachment glyph — decorative; interaction reserved for a future attachment feature */}
          <span
            aria-hidden="true"
            className="shrink-0 text-xl leading-none text-muted-foreground"
          >
            +
          </span>

          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Handshake Agent…"
            className={cn(
              "h-auto min-w-0 flex-1 border-none bg-transparent p-0 text-sm text-foreground",
              "shadow-none outline-none focus-visible:border-transparent focus-visible:ring-0",
              "placeholder:text-muted-foreground"
            )}
          />

          {/* Mic / record control */}
          {recording ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-danger tabular-nums">
                {Math.floor(recordSeconds / 60)}:
                {String(recordSeconds % 60).padStart(2, "0")}
              </span>
              <button
                type="button"
                aria-label="Cancel recording"
                onClick={onRecordCancel}
                className="text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                ✕
              </button>
              <button
                type="button"
                aria-label="Stop recording"
                onClick={onRecordStop}
                className="text-danger focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="block h-3 w-3 rounded-[2px] bg-danger" />
              </button>
            </div>
          ) : (
            canRecord && (
              <button
                type="button"
                aria-label="Record voice note"
                onClick={onRecordStart}
                className="shrink-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 17 17"
                  fill="none"
                  aria-hidden="true"
                >
                  <rect
                    x="6"
                    y="1.5"
                    width="5"
                    height="9"
                    rx="2.5"
                    className="fill-muted-foreground"
                  />
                  <path
                    d="M3.5 7.5a5 5 0 0010 0M8.5 12.5v2.5"
                    className="stroke-muted-foreground"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )
          )}
        </div>

        {/* Send button */}
        <Button
          type="button"
          size="icon"
          aria-label="Send"
          onClick={onSubmit}
          className={cn(
            "h-[46px] w-[46px] shrink-0 rounded-full bg-accent shadow-cta",
            "hover:bg-accent/90"
          )}
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 19 19"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 9.5h11M9.5 5l5 4.5-5 4.5"
              className="stroke-accent-foreground"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Button>
      </div>
    </div>
  )
}
