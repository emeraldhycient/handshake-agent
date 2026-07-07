import type { ProviderRegistryStatus } from "@handshake-agent/contracts"

import type { BadgeVariant } from "@/types/components"

/**
 * Provider status word → the canonical status→token pill variant (§5). Colour is
 * never the sole signal — the status word text carries the state. `degraded` is
 * reserved for a future live probe (Phase 7); the read endpoint emits only the
 * posture-derived ok / down / mock today, but the map stays exhaustive.
 */
export const STATUS_VARIANT: Record<ProviderRegistryStatus, BadgeVariant> = {
  ok: "success",
  degraded: "warn",
  down: "danger",
  mock: "info",
}
