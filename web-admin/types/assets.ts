/** Asset catalog page (§6.23). */

// ─── Asset catalog page (design §6.23) ──────────────────────────────────────────────
// The console has no dedicated admin asset-catalog endpoint. The layered catalog
// config (`useSettings("Catalog")`) surfaces enablement flags as flat dot-path leaves,
// not the structured per-asset rows the design's table needs (chain / decimals /
// min-max / contract). So the asset table is design-faithful representative content
// matching launch reality (USDT + TRX on TRON, ADR-0006); each row's `live` state is
// resolved from the real catalog config where a matching capability leaf exists, else
// left as its design-faithful default. The "Sync Blockradar catalog" action and the
// "Newly discovered" review card have no endpoint either — read-only / design-faithful.

/**
 * One asset row in the catalog table (design §6.23). Mirrors the backend
 * `CatalogAsset` shape (symbol / displayName / decimals / networks) plus the
 * per-asset min-max + on-chain contract the design surfaces. Representative
 * content — see the page-level comment.
 */
export interface AssetCatalogRow {
  /** Ticker rendered in the green chip + bold cell (e.g. "USDT"). */
  sym: string
  /** Human display name shown under the ticker (e.g. "Tether USD"). */
  name: string
  /** Settlement network label (mono, e.g. "TRON · TRC-20"). */
  chain: string
  /** On-chain decimals (mono / tabular). */
  dec: number
  /** Per-transaction min / max, pre-formatted (mono / tabular). */
  minmax: string
  /** On-chain contract address (mono, click-to-copy); "—" for a native asset. */
  contract: string
  /**
   * Provider-discovered logo URL (Blockradar Cloudinary), or null → the tinted
   * text-badge fallback renders. A public asset image, never a secret.
   */
  logo: string | null
  /**
   * Whether the asset is enabled in the live catalog. Resolved from the real
   * catalog config when a matching capability leaf exists; else design-faithful.
   */
  live: boolean
}

/** The "Newly discovered on-chain assets" card (read-only Blockradar discovery review). */
export interface DiscoveredCardProps {
  items: readonly import("@handshake-agent/contracts").AdminDiscoveredAsset[]
  loading: boolean
}

/** One asset catalog row — copyable contract + the Live toggle-pill (→ maker-checker). */
export interface AssetRowProps {
  asset: AssetCatalogRow
  onCopy: (asset: AssetCatalogRow) => void
  onToggle: (asset: AssetCatalogRow) => void
}

/** The asset-catalog table — 6-column header + loading / error / empty / data. */
export interface AssetsTableProps {
  assets: AssetCatalogRow[]
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  onRetry: () => void
  onCopy: (asset: AssetCatalogRow) => void
  onToggle: (asset: AssetCatalogRow) => void
}

/**
 * TableFilterBar props — the filter/search strip rendered inside a table card's
 * header. `children` are the page-specific controls; `className` tweaks the strip.
 */
export interface TableFilterBarProps {
  children: import("react").ReactNode
  className?: string
}

/**
 * AssetLogo primitive props. Renders the provider logo image when a `logoUrl` is
 * supplied and loads; on a missing URL or an image load error it falls back to the
 * `sym` text badge. `className` styles the container (size, rounding, background,
 * and — for the fallback — the text color/size, which the symbol inherits).
 */
export interface AssetLogoProps {
  /** The asset ticker shown as the fallback badge text (e.g. "USDT"). */
  sym: string
  /** Absolute logo URL, or null when none was discovered. */
  logoUrl: string | null
  /** Container styling (size + rounding + background + fallback text classes). */
  className?: string
}

// The "Newly discovered" card (design §6.23) is now WIRED to the real GET
// /admin/config/assets/discovered read and maps `AdminDiscoveredAsset` from
// `@handshake-agent/contracts` directly — so it no longer needs a local row type here.
