"use client"

/**
 * NotificationsMenu — the topbar bell dropdown (design chrome §4.2
 * `toggleNotif`). A DropdownMenu anchored to the bell showing a short list of
 * operational alerts; selecting one navigates to the screen that resolves it.
 *
 * The alerts are LOCAL mock data (there is no alerts-feed endpoint yet) — kept
 * here rather than imported from any page so this component stands alone. The
 * unread badge count is derived from the list length.
 */
import { useRouter } from "next/navigation"
import { DropdownMenu } from "radix-ui"
import {
  Bell,
  Scale,
  ScanSearch,
  ArrowLeftRight,
  type LucideIcon,
} from "lucide-react"

interface AdminAlert {
  id: string
  icon: LucideIcon
  title: string
  description: string
  href: string
  /** Accent token for the icon chip — a status semantic, never a raw colour. */
  tone: "danger" | "warn" | "info"
}

/** Mock operator alerts — the design's reconciliation / sanctions / stuck-tx set. */
const ALERTS: readonly AdminAlert[] = [
  {
    id: "recon-break",
    icon: Scale,
    title: "Reconciliation break — 3 unresolved",
    description: "Provider ledger diverges from internal balances.",
    href: "/reconciliation",
    tone: "warn",
  },
  {
    id: "sanctions-hit",
    icon: ScanSearch,
    title: "Sanctions hit — Musa Sani flagged",
    description: "A screening match needs a compliance decision.",
    href: "/sanctions",
    tone: "danger",
  },
  {
    id: "stuck-settlement",
    icon: ArrowLeftRight,
    title: "5 transactions stuck in settlement",
    description: "Awaiting provider confirmation past SLA.",
    href: "/transactions",
    tone: "info",
  },
]

const TONE_CHIP: Record<AdminAlert["tone"], string> = {
  danger: "bg-[color:var(--danger-muted)] text-[color:var(--destructive)]",
  warn: "bg-[color:var(--warn-muted)] text-[color:var(--warn)]",
  info: "bg-[color:var(--info-muted)] text-[color:var(--info)]",
}

export function NotificationsMenu() {
  const router = useRouter()
  const unread = ALERTS.length

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

          {ALERTS.map((alert) => {
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
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
