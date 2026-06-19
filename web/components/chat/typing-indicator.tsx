import { cn } from "@/lib/utils"

export function TypingIndicator() {
  return (
    <div
      data-testid="typing"
      className={cn(
        "flex gap-[5px] self-start",
        "border border-border bg-card",
        "rounded-[18px_18px_18px_5px] px-[15px] py-[13px]"
      )}
    >
      <span
        className={cn(
          "size-[7px] rounded-full bg-muted-foreground-subtle",
          "animate-hs-blink"
        )}
      />
      <span
        className={cn(
          "size-[7px] rounded-full bg-muted-foreground-subtle",
          "animate-hs-blink"
        )}
        style={{ animationDelay: "0.2s" }}
      />
      <span
        className={cn(
          "size-[7px] rounded-full bg-muted-foreground-subtle",
          "animate-hs-blink"
        )}
        style={{ animationDelay: "0.4s" }}
      />
    </div>
  )
}
