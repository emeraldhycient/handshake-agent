"use client"

import type { KeyboardEvent } from "react"
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
}: ChatComposerProps) {
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="bg-background">
      {/* Chips row — horizontal scroll, no scrollbar */}
      <div
        className="flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pt-1.5 pb-2.5"
        style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
      >
        {chips.map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => onChip(action)}
            className={cn(
              "flex-none cursor-pointer rounded-full border border-border whitespace-nowrap",
              "bg-card px-3.5 py-2 text-[13px] font-semibold text-foreground",
              "shadow-[0_1px_2px_rgba(20,40,32,0.05)] focus-visible:outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring/50"
            )}
          >
            {chipLabel(action)}
          </button>
        ))}
      </div>

      {/* Input row */}
      <div className="flex items-center gap-2.5 px-3.5">
        {/* Input pill */}
        <div className="flex flex-1 items-center gap-2.5 rounded-full border border-border bg-card px-4 py-[11px]">
          {/* Attachment glyph */}
          <span className="shrink-0 text-xl leading-none text-muted-foreground">
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

          {/* Mic icon */}
          <svg
            width="17"
            height="17"
            viewBox="0 0 17 17"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
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
        </div>

        {/* Send button */}
        <button
          type="button"
          onClick={onSubmit}
          aria-label="Send"
          className={cn(
            "flex h-[46px] w-[46px] shrink-0 cursor-pointer items-center justify-center",
            "rounded-full bg-accent shadow-cta",
            "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
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
        </button>
      </div>
    </div>
  )
}
