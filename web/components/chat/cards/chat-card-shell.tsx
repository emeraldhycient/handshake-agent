import { cn } from "@/lib/utils"
import type { ChatCardShellProps } from "@/types/chat"

/** Raised desktop shadow shared by the "heavy" chat cards (kept as one literal). */
const DESKTOP_SHADOW = "shadow-[0_4px_14px_oklch(0.244_0.024_162_/_0.06)]"

/**
 * The canonical chat message-card shell: bordered card surface with the
 * density-based width/rounding used by every non-gradient chat card. Kept
 * pixel-identical to the inline markup it replaces (root §16).
 */
export function ChatCardShell({
  density,
  desktopShadow = false,
  className,
  children,
}: ChatCardShellProps) {
  const isMobile = density === "mobile"
  return (
    <div
      className={cn(
        "overflow-hidden border border-border bg-card",
        isMobile
          ? "w-[88%] rounded-[20px] shadow-card"
          : cn("w-[92%] rounded-[16px]", desktopShadow && DESKTOP_SHADOW),
        className
      )}
    >
      {children}
    </div>
  )
}
