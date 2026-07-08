import type { SanctionsMonitoringView } from "@handshake-agent/contracts"

import { MONITOR_LABELS } from "@/constants/sanctions"
import type { SanctionsMonitorRow } from "@/types/components"

/** Projects the fetched monitoring view onto the ordered display rows. */
export function toMonitorRows(
  view: SanctionsMonitoringView
): SanctionsMonitorRow[] {
  return MONITOR_LABELS.map(({ key, label }) => ({
    key,
    label,
    on: view[key],
  }))
}
