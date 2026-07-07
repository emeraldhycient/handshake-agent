import { cn } from "@/lib/utils"
import { StatusPill } from "@/components/shared"
import type { VerificationRowProps } from "@/types/components"

/**
 * A single verification summary row. When `iconNode` is provided it fills the
 * left slot directly (e.g. the selfie thumbnail); otherwise `icon` is wrapped in
 * the standard square icon-box.
 */
export function VerificationRow({
  iconNode,
  icon,
  label,
  value,
  valueMono,
  pillLabel,
}: VerificationRowProps) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5">
      {iconNode ?? (
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-background">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p
          className={cn(
            "text-[15px] font-bold text-foreground",
            valueMono && "font-mono tabular-nums"
          )}
        >
          {value}
        </p>
      </div>
      <StatusPill tone="success" className="flex-none">
        {pillLabel}
      </StatusPill>
    </div>
  )
}
