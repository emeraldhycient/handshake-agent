import { cn } from "@/lib/utils"

const DOT_DELAYS = ["0s", "0.2s", "0.4s"] as const

export function TypingIndicator() {
  return (
    <div
      data-testid="typing"
      role="status"
      aria-label="Agent is typing"
      className={cn(
        "flex gap-[5px] self-start",
        "border border-border bg-card",
        "rounded-[18px_18px_18px_5px] px-[15px] py-[13px]"
      )}
    >
      {DOT_DELAYS.map((delay) => (
        <span
          key={delay}
          className="size-[7px] animate-hs-blink rounded-full bg-muted-foreground-subtle"
          style={{ animationDelay: delay }}
        />
      ))}
    </div>
  )
}
