import { AlertTriangleIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * DepositNetworkWarning — the single canonical "only send X on Y" warning shown
 * on every deposit-address surface (chat ReceiveCard + the wallet deposit panel).
 *
 * Sending the wrong asset or on the wrong network to a custodial address loses
 * the funds permanently, so this is the highest-signal warning on the deposit
 * path: warn-token background + a warning glyph (danger is never color-alone,
 * CLAUDE.md §13.8) + role="alert" for assistive tech.
 *
 * Props are declared inline here (leaf shared primitive); the shared XxxProps
 * registry in web/types lives in another layer.
 */
export interface DepositNetworkWarningProps {
  /** Asset the address can receive, e.g. "USDT". */
  asset: string
  /** Network/standard the address is on, e.g. "TRON · TRC-20". */
  network: string
  className?: string
}

export function DepositNetworkWarning({
  asset,
  network,
  className,
}: DepositNetworkWarningProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-[12px] border border-warn bg-warn-muted px-3 py-2.5",
        className
      )}
    >
      <AlertTriangleIcon
        className="mt-px h-4 w-4 shrink-0 text-warn"
        aria-hidden="true"
      />
      <p className="text-[12px] leading-snug font-medium text-warn-foreground">
        Send only <span className="font-bold">{asset}</span> on the{" "}
        <span className="font-bold">{network}</span> network. Any other asset or
        network will be lost permanently.
      </p>
    </div>
  )
}
