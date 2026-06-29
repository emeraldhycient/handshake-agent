import type {
  NotificationListResponse,
  NotificationItem,
} from "@handshake-agent/contracts"
import type { AppNotification } from "@/lib/schemas"

// Presentation for each notification event type (icon/title/tint are display data).
const META: Record<
  string,
  { icon: string; tint: string; col: string; title: string }
> = {
  transaction_completed: {
    icon: "+",
    tint: "#e6f3ec",
    col: "#1f8a5b",
    title: "Purchase complete",
  },
  transaction_pending: {
    icon: "↗",
    tint: "#fbeece",
    col: "#9a6a12",
    title: "Transaction pending",
  },
  transaction_failed: {
    icon: "!",
    tint: "#fbeece",
    col: "#9a6a12",
    title: "Transaction failed",
  },
  deposit_confirmed: {
    icon: "↓",
    tint: "#e6f3ec",
    col: "#1f8a5b",
    title: "Deposit confirmed",
  },
  kyc_approved: {
    icon: "✓",
    tint: "#e6f3ec",
    col: "#1f8a5b",
    title: "Identity verified",
  },
}
const DEFAULT_META = {
  icon: "•",
  tint: "#f3efe7",
  col: "#16261e",
  title: "Notification",
}

function relTime(createdAt: string, now: Date): string {
  const diffMs = now.getTime() - new Date(createdAt).getTime()
  const m = Math.max(0, Math.round(diffMs / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}

function bodyFor(it: NotificationItem): string {
  const v = it.templateVars
  if (typeof v.amount === "string" && typeof v.asset === "string")
    return `${v.amount} ${v.asset}`
  if (typeof v.message === "string") return v.message
  return it.eventRef
}

export function mapNotifications(
  res: NotificationListResponse,
  now: Date = new Date()
): AppNotification[] {
  return res.items.map((it) => {
    const meta = META[it.eventType] ?? DEFAULT_META
    return {
      icon: meta.icon,
      tint: meta.tint,
      col: meta.col,
      title: meta.title,
      sub: bodyFor(it),
      time: relTime(it.createdAt, now),
    }
  })
}
