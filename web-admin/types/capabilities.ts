/** Capabilities / service registry page (§6.25). */

// ─── Capabilities / service registry page (design §6.25) ─────────────────────────
// PIXEL reproduction of `docs/design-ref/screens/Capabilities.html`: the master
// switchboard. Each transactable capability is bound to a provider port and rendered
// as a full-width kill-switch row — icon tile + mono label + ENABLED/DISABLED status
// pill + desc·port + a 52px soft toggle. This is a design reproduction: the rows are
// the design's own module-level mock content (the seed `caps` array, logic.js lines
// 113-120), no fetching / TanStack Query. Toggling opens the shared MakerCheckerModal
// (kill-switch = maker-checker) exactly as the design does.

/** The icon-tile tint for a capability row → a status-token surface/text pair. */
export type CapabilityTone = "success" | "info" | "warn" | "neutral"

/**
 * One capability switchboard row — the design's `caps` seed shape (logic.js 113-120).
 * `label` is the mono capability id; `provider` is the bound provider port; `on` is the
 * current enablement; `icon` is the 24×24 stroke path; `tone` tints the icon tile.
 */
export interface CapabilityRow {
  /** Stable row id (the design's `caps[].id`, also the mono label). */
  id: string
  /** The mono capability label shown in the switchboard row. */
  label: string
  /** One-line description of what the capability enables. */
  desc: string
  /** The bound provider port name. */
  provider: string
  /** Current enablement (drives the pill label + toggle position). */
  on: boolean
  /** The icon-tile tint token pair. */
  tone: CapabilityTone
  /** The 24×24 stroke-1.8 SVG `path` `d` for the row's icon tile. */
  icon: string
}

/**
 * One capability switchboard row's props: the row data joined with its toggle handler.
 * Toggling never flips the switch directly — it opens the maker-checker modal.
 */
export interface CapabilityRowProps {
  /** The capability row's design-faithful content. */
  row: CapabilityRow
  /** Fired when the operator flips the kill-switch (opens maker-checker). */
  onToggle: (row: CapabilityRow) => void
}

/**
 * Per-capability display metadata the config contract does NOT provide — the human
 * label, description, bound provider port, icon path, and tint. Keyed by the crypto
 * capability leaf; `on` is NOT here (it comes from the live setting value).
 */
export interface CapabilityPresentation {
  /** The `catalog.capabilities.crypto.<x>` registry key backing this row. */
  settingKey: string
  label: string
  desc: string
  provider: string
  tone: CapabilityTone
  icon: string
}

/**
 * A resolved capability row plus the registry key + scope that back it — carried so
 * the write path targets the same leaf the read resolved.
 */
export interface ResolvedCapability extends CapabilityRow {
  settingKey: string
  scope: import("@handshake-agent/contracts").EffectiveSetting["scope"]
  scopeValue: string | null
}
