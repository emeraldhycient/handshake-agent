"use client"

/**
 * Live operator alerts, DERIVED from existing read hooks (no alerts-feed endpoint —
 * the §4.1 nav-badge composition principle): approvals awaiting this admin, open
 * reconciliation breaks, stuck transactions, and open compliance cases. Each source
 * is independently cached; a still-loading or errored source contributes `0`, so its
 * row simply drops out rather than flashing a stale count. Shared by the topbar bell
 * (NotificationsMenu) and the dashboard AlertsCard so the two never diverge.
 */
import { useMemo } from "react"
import {
  Scale,
  ScanSearch,
  ArrowLeftRight,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react"

import {
  useApprovalsInbox,
  useComplianceEvents,
  useReconStatus,
  useTransactions,
} from "@/lib/query/hooks"

export interface AdminAlert {
  id: string
  icon: LucideIcon
  title: string
  description: string
  href: string
  /** Accent token for the icon chip — a status semantic, never a raw colour. */
  tone: "danger" | "warn" | "info"
}

/** English pluralization for a count-driven noun (1 break, 3 breaks). */
function plural(count: number, noun: string): string {
  return count === 1 ? `${count} ${noun}` : `${count} ${noun}s`
}

/** The unfiltered transactions query whose response `counts.stuck` feeds an alert. */
const ALL_TRANSACTIONS: Parameters<typeof useTransactions>[0] = {}
/** The unfiltered compliance-event query; we count the still-open states client-side. */
const ALL_COMPLIANCE_EVENTS: Parameters<typeof useComplianceEvents>[0] = {}
/** The compliance-event states that count as an OPEN case (awaiting a decision). */
const OPEN_COMPLIANCE_STATUSES = new Set(["flagged", "under_review"])

/**
 * Compose the live operator alerts. Only alerts with a non-zero signal are returned,
 * severity-first: compliance → reconciliation → stuck → approvals.
 */
export function useOperatorAlerts(): AdminAlert[] {
  const approvals = useApprovalsInbox()
  const recon = useReconStatus()
  const txns = useTransactions(ALL_TRANSACTIONS)
  const compliance = useComplianceEvents(ALL_COMPLIANCE_EVENTS)

  const awaitingMe = approvals.data?.counts.awaitingMe ?? 0
  const openBreaks = recon.data?.openBreakCount ?? 0
  const stuck = txns.data?.counts.stuck ?? 0
  const openCases =
    compliance.data?.items.filter((e) =>
      OPEN_COMPLIANCE_STATUSES.has(e.status)
    ).length ?? 0

  return useMemo<AdminAlert[]>(() => {
    const alerts: AdminAlert[] = []
    if (openCases > 0) {
      alerts.push({
        id: "compliance-cases",
        icon: ScanSearch,
        title: `${plural(openCases, "open compliance case")}`,
        description: "Flagged events awaiting a compliance decision.",
        href: "/compliance",
        tone: "danger",
      })
    }
    if (openBreaks > 0) {
      alerts.push({
        id: "recon-break",
        icon: Scale,
        title: `${plural(openBreaks, "reconciliation break")}`,
        description: "Provider ledger diverges from internal balances.",
        href: "/reconciliation",
        tone: "warn",
      })
    }
    if (stuck > 0) {
      alerts.push({
        id: "stuck-settlement",
        icon: ArrowLeftRight,
        title: `${plural(stuck, "transaction")} stuck in settlement`,
        description: "Awaiting provider confirmation past SLA.",
        href: "/transactions",
        tone: "info",
      })
    }
    if (awaitingMe > 0) {
      alerts.push({
        id: "approvals-awaiting",
        icon: ClipboardCheck,
        title: `${plural(awaitingMe, "approval")} awaiting you`,
        description: "Maker-checker requests need your review.",
        href: "/approvals",
        tone: "warn",
      })
    }
    return alerts
  }, [openCases, openBreaks, stuck, awaitingMe])
}
