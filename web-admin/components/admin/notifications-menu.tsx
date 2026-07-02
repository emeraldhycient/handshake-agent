"use client"

/**
 * NotificationsMenu — the topbar bell dropdown (design chrome §4.2 `toggleNotif`).
 * A DropdownMenu anchored to the bell showing the operator's LIVE alerts; selecting
 * one navigates to the screen that resolves it.
 *
 * The alerts are DERIVED from existing read hooks (no alerts-feed endpoint yet, and
 * no new one is needed — §4.1's nav-badge composition principle): approvals awaiting
 * this admin, open reconciliation breaks, stuck transactions, and open compliance
 * cases. Each source is independently cached; a source still loading or errored
 * contributes `0`, so its row simply doesn't show rather than flashing a stale count.
 * The unread badge is the number of ACTIVE alerts (non-zero signal); when every
 * signal is zero the dropdown shows an "All clear" empty state and the bell carries
 * no badge. Nothing here moves money (§3.1).
 */
import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { DropdownMenu } from "radix-ui"
import {
  Bell,
  CheckCircle2,
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

interface AdminAlert {
  id: string
  icon: LucideIcon
  title: string
  description: string
  href: string
  /** Accent token for the icon chip — a status semantic, never a raw colour. */
  tone: "danger" | "warn" | "info"
}

const TONE_CHIP: Record<AdminAlert["tone"], string> = {
  danger: "bg-[color:var(--danger-muted)] text-[color:var(--destructive)]",
  warn: "bg-[color:var(--warn-muted)] text-[color:var(--warn)]",
  info: "bg-[color:var(--info-muted)] text-[color:var(--info)]",
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
 * Compose the live operator alerts from existing read hooks. Only alerts with a
 * non-zero signal are returned (a resolved-but-empty or still-loading source drops
 * out), newest-severity-first: compliance → reconciliation → stuck → approvals.
 */
function useOperatorAlerts(): AdminAlert[] {
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

export function NotificationsMenu() {
  const router = useRouter()
  const alerts = useOperatorAlerts()
  const unread = alerts.length

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Alerts (${unread} unread)` : "Alerts"}
          className="relative flex size-[38px] flex-none items-center justify-center rounded-[11px] border border-line text-ink2 transition-colors outline-none hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-hov"
        >
          <Bell aria-hidden="true" className="size-[18px]" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-card bg-[color:var(--destructive)] px-1 font-mono text-[10px] font-extrabold text-white tabular-nums">
              {unread}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[320px] overflow-hidden rounded-2xl border border-line bg-card p-[6px] shadow-flow outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DropdownMenu.Label className="px-[10px] pt-[8px] pb-[6px] text-[11px] font-bold tracking-[0.06em] text-ink3 uppercase">
            Notifications
          </DropdownMenu.Label>

          {unread === 0 ? (
            <div className="flex items-center gap-[10px] px-[10px] py-[14px]">
              <span className="flex size-[26px] flex-none items-center justify-center rounded-[8px] bg-[color:var(--success-muted)] text-[color:var(--success)]">
                <CheckCircle2 aria-hidden="true" className="size-[15px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold text-ink">
                  All clear
                </span>
                <span className="block text-[11.5px] leading-snug text-ink2">
                  No operator alerts need your attention.
                </span>
              </span>
            </div>
          ) : (
            alerts.map((alert) => {
              const Icon = alert.icon
              return (
                <DropdownMenu.Item
                  key={alert.id}
                  onSelect={() => router.push(alert.href)}
                  className="flex cursor-pointer items-start gap-[10px] rounded-xl px-[10px] py-[9px] outline-none data-[highlighted]:bg-hov"
                >
                  <span
                    className={`mt-px flex size-[26px] flex-none items-center justify-center rounded-[8px] ${TONE_CHIP[alert.tone]}`}
                  >
                    <Icon aria-hidden="true" className="size-[15px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-ink">
                      {alert.title}
                    </span>
                    <span className="block text-[11.5px] leading-snug text-ink2">
                      {alert.description}
                    </span>
                  </span>
                </DropdownMenu.Item>
              )
            })
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
