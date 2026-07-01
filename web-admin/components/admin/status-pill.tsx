"use client"

/**
 * StatusPill — the canonical status → semantic pill helper (design §5 status→token
 * map). Maps the design's `stMeta` / `kycMeta` status keys (docs/design-ref/logic.js
 * lines 496 / 593 / 687 / 699 / 1829) onto a single `Badge` variant + its canonical
 * label. One primitive reused everywhere a transaction / KYC status renders (root
 * §13.1). Colour is never the sole signal — the label carries the state; a "stuck"
 * pending status adds a pulsing dot (design line 605).
 */
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import type { StatusPillProps, StatusPillStatus } from "@/types/components"

type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>["variant"]>

/**
 * Status → { variant, label } from the design's stMeta/kycMeta maps. Success surfaces
 * for terminal-good states, warn for in-flight, danger for failures, info for
 * refunds/needs-info, neutral for quoted/initiated.
 */
const META: Record<StatusPillStatus, { variant: BadgeVariant; label: string }> =
  {
    // stMeta (transactions / ledger)
    settled: { variant: "success", label: "Settled" },
    pending_settlement: { variant: "warn", label: "Pending" },
    failed: { variant: "danger", label: "Failed" },
    refunded: { variant: "info", label: "Refunded" },
    refund: { variant: "info", label: "Refund" },
    quoted: { variant: "neutral", label: "Quoted" },
    initiated: { variant: "neutral", label: "Initiated" },
    receive: { variant: "success", label: "Received" },
    // kycMeta (KYC / users)
    verified: { variant: "success", label: "Verified" },
    pending: { variant: "warn", label: "Pending" },
    needs_info: { variant: "info", label: "Needs info" },
    rejected: { variant: "danger", label: "Rejected" },
  }

export function StatusPill({ status, label, stuck }: StatusPillProps) {
  const meta = META[status]
  return (
    <Badge variant={meta.variant}>
      {stuck && (
        <span
          aria-hidden
          className={cn(
            "size-[5px] rounded-full bg-current motion-safe:animate-hs-pulse"
          )}
        />
      )}
      {label ?? meta.label}
    </Badge>
  )
}
