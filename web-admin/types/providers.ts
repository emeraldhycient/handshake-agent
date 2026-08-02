/** Providers page (§6.27). */

// ─── Providers page (design §6.27) ──────────────────────────────────────────────────
// Provider adapter cards + a mock→live readiness checklist, WIRED to the real
// provider-registry read endpoint (GET /admin/providers, Phase 6b). The card/
// readiness data shapes are contract-owned (`ProviderCardView` /
// `ProviderReadinessItem` from `@handshake-agent/contracts`) — this file keeps only
// the presentational prop type. The screen is READ-ONLY: the API returns
// secret-PRESENCE booleans, never key values (§3.4/§3.5), so there is no reveal of
// any real secret; "Test connection" / key reveal are Phase 7. Nothing moves money
// (§3.1). Status → pill token pair: ok=success, degraded=warn, down=danger,
// mock=info — colour is never the sole signal (the status word carries the state).

export interface ProviderCardViewProps {
  /** The provider adapter card this row renders (contract-owned shape). */
  provider: import("@handshake-agent/contracts").ProviderCardView
}

/** The readiness-row glyph — a check when done, a dash while pending. */
export interface ReadinessIconProps {
  done: boolean
}

/** The mock→live readiness checklist card — one check-icon row per gate. */
export interface ReadinessCardProps {
  items: readonly import("@handshake-agent/contracts").ProviderReadinessItem[]
}

/** Props for the ProviderTestButton (the Phase-7 "Test connection" liveness probe). */
export interface ProviderTestButtonProps {
  /** The stable provider key to probe (e.g. "blockradar"). */
  providerKey: string
}
