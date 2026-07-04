"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { ChatMessageView } from "./chat-message"
import { TypingIndicator } from "./typing-indicator"
import type { ChatThreadProps } from "@/types/components"

/**
 * ChatThread — scrollable message list with auto-scroll to bottom.
 * Renders the "Today" date divider, all ChatMessageView instances,
 * and the TypingIndicator when the agent is composing a reply.
 */
export function ChatThread({
  messages,
  typing,
  density,
  onConfirm,
  onSelectTicket,
  onResolveBeneficiary,
}: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // scrollIntoView is not implemented in jsdom — guard before calling
    if (bottomRef.current?.scrollIntoView) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages.length, typing])

  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-[14px]",
        "overflow-y-auto px-4 pt-[18px] pb-2",
        "[scrollbar-width:none]"
      )}
    >
      {/* Date divider. Uses the opaque `bg-muted` surface, not a translucent
          `foreground/N%` tint: the tint darkened the underlying cream page bg to
          ≈#e2e1d8, dropping `muted-foreground` to 3-tier-failing 4.17:1 on /app.
          `bg-muted` is a fixed light neutral on every surface → muted text clears
          AA (≈4.93:1) deterministically. */}
      <div
        className={cn(
          "self-center rounded-full px-3 py-[5px]",
          "bg-muted text-muted-foreground",
          "text-[11.5px] font-semibold",
          "mb-[2px]"
        )}
      >
        Today
      </div>

      {/* Message list */}
      {messages.map((message) => (
        <ChatMessageView
          key={message.id}
          message={message}
          density={density}
          onConfirm={onConfirm}
          onSelectTicket={onSelectTicket}
          onResolveBeneficiary={onResolveBeneficiary}
        />
      ))}

      {/* Typing indicator */}
      {typing && <TypingIndicator />}

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  )
}
