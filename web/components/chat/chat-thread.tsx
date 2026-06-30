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
      {/* Date divider */}
      <div
        className={cn(
          "self-center rounded-full px-3 py-[5px]",
          "bg-foreground/[0.06] text-muted-foreground",
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
