import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ActionButtonProps } from "@/types/components"

/**
 * ActionButton — the single canonical Buy/Send/Receive/Swap quick-action button
 * (§13.1). It replaces the three divergent raw `<button>` forks on the overview
 * hero, the wallet page header, and the mobile wallet tab so every surface
 * renders an identical control.
 *
 * - Built on the `Button` primitive, so it inherits the focus-visible ring,
 *   disabled handling, and active-press treatment (no re-implementation).
 * - `label` is always the accessible name; `icon` is decorative (aria-hidden).
 * - `variant`: "primary" = accent fill (the lead action, e.g. Buy);
 *   "secondary" = bordered card surface (Send/Receive/Swap).
 * - `layout`: "inline" pill (desktop) or "stacked" icon-tile (mobile wallet).
 * - Tokens only — no hex literals (status/brand semantics from CSS vars).
 */
export function ActionButton({
  label,
  icon,
  variant = "secondary",
  layout = "inline",
  onClick,
  className,
}: ActionButtonProps) {
  const stacked = layout === "stacked"

  return (
    <Button
      type="button"
      aria-label={label}
      onClick={onClick}
      variant={variant === "primary" ? "default" : "outline"}
      className={cn(
        "rounded-[12px] font-bold",
        // Unified primary: accent fill across every surface so the lead action
        // looks the same on the dark hero and the light wallet header.
        variant === "primary" &&
          "bg-accent text-accent-foreground hover:bg-accent-deep",
        stacked
          ? "flex h-auto flex-col items-center gap-1.5 px-2 py-[11px] text-[12px]"
          : "px-5 py-[11px] text-sm",
        className
      )}
    >
      {icon != null && (
        <span aria-hidden="true" className={cn(stacked && "text-[17px]")}>
          {icon}
        </span>
      )}
      <span>{label}</span>
    </Button>
  )
}
