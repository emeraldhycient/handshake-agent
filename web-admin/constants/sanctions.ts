/**
 * Sanctions & screening constants (design §6.5). Verdict / done-state token maps + the
 * ordered monitoring-toggle labels. Colour follows severity but is never the sole signal
 * — an explicit label always sits alongside it.
 */
import type {
  SanctionsMonitoringView,
  SanctionsRecordItem,
} from "@handshake-agent/contracts"
import type { SanctionsMatchDone } from "@/types/components"

/** Verdict token + label shown in the design's Score slot. */
export const VERDICT_META: Record<
  SanctionsRecordItem["verdict"],
  { label: string; fg: string; danger: boolean }
> = {
  hit: { label: "Hit", fg: "text-tdn", danger: true },
  inconclusive: { label: "Review", fg: "text-twn", danger: true },
  clear: { label: "Clear", fg: "text-tok", danger: false },
}

/** Done-label + token shown once a match has been dispositioned. */
export const DONE_META: Record<
  SanctionsMatchDone,
  { label: string; className: string }
> = {
  cleared: { label: "Cleared", className: "text-tok" },
  escalated: { label: "Escalated", className: "text-twn" },
  blocked: { label: "Blocked", className: "text-tdn" },
}

/** Ordered monitoring row labels keyed by the monitoring-view flag they surface. */
export const MONITOR_LABELS: readonly {
  key: keyof SanctionsMonitoringView
  label: string
}[] = [
  {
    key: "reScreenDaily",
    label: "Re-screen all customers daily against updated lists",
  },
  {
    key: "screenOnOutbound",
    label: "Screen every counterparty on outbound transfer",
  },
  {
    key: "pepAlert",
    label: "Alert on new PEP (politically exposed person) matches",
  },
  { key: "autoBlockOfac", label: "Auto-block confirmed OFAC SDN-list hits" },
]
