"use client"

/**
 * AssetsPage — the Configuration group's asset-catalog screen (operator-console
 * design system §6.23, `docs/design-ref/screens/Assets.html`).
 *
 * PIXEL REPRODUCTION of the imported design. This screen prioritises matching the
 * design 1:1 over wiring real data — there is no TanStack Query / useQuery here.
 * The content is the design's OWN mock catalog, embedded as module-level consts
 * (translated from the `pAssets` markup + the seed() dataset shapes in
 * docs/design-ref/logic.js, which truncates this view method). Real-data
 * reintegration is a separate later step.
 *
 * Layout (verbatim from the markup): a header + "Sync Blockradar catalog" ghost
 * action, a last-sync line, an info-toned "Newly discovered · review to add" card,
 * then the six-column asset table (Asset [green chip + sym/name] · Chain ·
 * Decimals · Min/max · Contract [mono, click-to-copy] · Live toggle-pill).
 *
 * Actions wire to the SAME destinations as the design:
 * - Sync Blockradar / "Review & add" → the shared ReasonModal (recorded action).
 * - Live toggle-pill → the shared MakerCheckerModal (enabling/disabling an asset is
 *   a dual-control config change; spec §6.23 / §6.25 "Toggling = maker-checker").
 * - Contract cell → click-to-copy (pure clipboard write, as in the design).
 */
import { useState } from "react"

import { cn } from "@/lib/utils"
import { MakerCheckerModal, ReasonModal } from "@/components/admin/flows"
import type { AssetCatalogRow, DiscoveredAssetRow } from "@/types/components"

// Design §6.23 table grid — Asset / Chain / Decimals / Min-max / Contract / Live.
const ASSETS_GRID = "grid-cols-[1.4fr_0.8fr_0.7fr_1fr_1.6fr_0.7fr]"

// The design's last-sync caption (matches the seed()'s recent-sync timestamp shape).
const LAST_SYNC = "2 hours ago · 14 assets, 3 chains"

// The design's mock asset rows (green-chip catalog). Values reproduce the markup +
// the launch dataset (USDT + TRX on TRON, ADR-0006) with representative extras so
// the table reads exactly as the design renders it.
const ASSET_ROWS: readonly AssetCatalogRow[] = [
  {
    sym: "USDT",
    name: "Tether USD",
    chain: "TRON · TRC-20",
    dec: 6,
    minmax: "5 / 50,000",
    contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    live: true,
  },
  {
    sym: "USDT",
    name: "Tether USD",
    chain: "Ethereum · ERC-20",
    dec: 6,
    minmax: "5 / 50,000",
    contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    live: true,
  },
  {
    sym: "USDC",
    name: "USD Coin",
    chain: "TRON · TRC-20",
    dec: 6,
    minmax: "5 / 50,000",
    contract: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",
    live: true,
  },
  {
    sym: "TRX",
    name: "TRON",
    chain: "TRON · native",
    dec: 6,
    minmax: "25 / 250,000",
    contract: "—",
    live: true,
  },
  {
    sym: "BTC",
    name: "Bitcoin",
    chain: "Bitcoin · native",
    dec: 8,
    minmax: "0.0002 / 2",
    contract: "—",
    live: false,
  },
]

// The design's mock newly-discovered rows (info-toned "review to add" card).
const DISCOVERED_ROWS: readonly DiscoveredAssetRow[] = [
  {
    sym: "USDC",
    name: "USD Coin",
    chain: "Ethereum",
    dec: 6,
    contract: "0xA0b8…eB48",
  },
  {
    sym: "DAI",
    name: "Dai Stablecoin",
    chain: "Ethereum",
    dec: 18,
    contract: "0x6B17…1d0F",
  },
]

/** The circular refresh glyph beside "Sync Blockradar catalog". */
function SyncIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 12a8 8 0 0 1 14-5.3L20 8M20 4v4h-4M20 12a8 8 0 0 1-14 5.3L4 16M4 20v-4h4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The up-arrow-into-tray glyph on the "Newly discovered" card header. */
function DiscoveredIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 3v5M12 3l-3 3M12 3l3 3M5 13v6h14v-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The info-toned "Newly discovered · review to add" card (design §6.23). Each row
 * carries an info chip, the asset name + ticker, its chain/decimals/contract meta,
 * and a "Review & add" affordance that opens the reason flow (a recorded action).
 */
function DiscoveredCard({
  onReview,
}: {
  onReview: (asset: DiscoveredAssetRow) => void
}) {
  return (
    <div className="mb-3.5 rounded-[16px] border border-[#cfe0fb] bg-sif px-5 py-4">
      <div className="mb-2.5 flex items-center gap-2 text-[13px] font-extrabold text-tif">
        <DiscoveredIcon />
        Newly discovered · review to add
      </div>
      {DISCOVERED_ROWS.map((asset) => (
        <div
          key={`${asset.sym}-${asset.chain}`}
          className="flex items-center gap-3.5 py-2.5"
        >
          <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] border border-[#cfe0fb] bg-white text-[11px] font-extrabold text-tif">
            {asset.sym}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold text-ink">
              {asset.name} · {asset.sym}
            </div>
            <div className="truncate font-mono text-[11px] text-ink3">
              {asset.chain} · {asset.dec} dp · {asset.contract}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onReview(asset)}
            aria-label={`Review and add ${asset.name}`}
            className="flex-none rounded-[9px] bg-tif px-[15px] py-2 text-[12px] font-extrabold text-white transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Review &amp; add
          </button>
        </div>
      ))}
    </div>
  )
}

/**
 * One asset row — green chip + sym/name, chain, decimals, min-max, copyable
 * contract, and the Live toggle-pill (click → maker-checker, as the design does).
 */
function AssetRow({
  asset,
  onCopy,
  onToggle,
}: {
  asset: AssetCatalogRow
  onCopy: (asset: AssetCatalogRow) => void
  onToggle: (asset: AssetCatalogRow) => void
}) {
  return (
    <div
      className={cn(
        "grid items-center gap-3 border-b border-line2 px-[18px] py-[13px] last:border-b-0",
        ASSETS_GRID
      )}
    >
      {/* Asset — green chip + ticker + name */}
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-brand-green text-[11px] font-extrabold text-brand-amber">
          {asset.sym}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-ink">{asset.sym}</div>
          <div className="truncate text-[11px] text-ink3">{asset.name}</div>
        </div>
      </div>

      {/* Chain */}
      <div className="font-mono text-[12px] text-ink2">{asset.chain}</div>

      {/* Decimals */}
      <div className="font-mono text-[12px] text-ink tabular-nums">
        {asset.dec}
      </div>

      {/* Min / max */}
      <div className="font-mono text-[11px] text-ink2 tabular-nums">
        {asset.minmax}
      </div>

      {/* Contract — mono, click-to-copy (pure clipboard write) */}
      {asset.contract === "—" ? (
        <div className="truncate font-mono text-[11px] text-ink3">—</div>
      ) : (
        <button
          type="button"
          onClick={() => onCopy(asset)}
          aria-label={`Copy ${asset.sym} contract address`}
          className="truncate text-left font-mono text-[11px] text-ink3 transition-colors hover:text-ink2 focus-visible:text-ink2 focus-visible:outline-none"
        >
          {asset.contract}
        </button>
      )}

      {/* Live toggle-pill — click opens maker-checker (dual-control change) */}
      <div>
        <button
          type="button"
          onClick={() => onToggle(asset)}
          aria-label={`Toggle ${asset.sym} on ${asset.chain} live status`}
          className="cursor-pointer focus-visible:outline-none"
        >
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-[3px] text-[10.5px] font-bold",
              asset.live ? "bg-sok text-tok" : "bg-card2 text-ink2"
            )}
          >
            {asset.live ? "Live" : "Paused"}
          </span>
        </button>
      </div>
    </div>
  )
}

export function AssetsPage() {
  // Which flow modal is open, and the row/asset it targets. Presentation-only —
  // these reproduce the design's action destinations without a real mutation.
  const [reasonFor, setReasonFor] = useState<string | null>(null)
  const [toggleTarget, setToggleTarget] = useState<AssetCatalogRow | null>(null)

  function copyContract(asset: AssetCatalogRow) {
    if (asset.contract !== "—")
      void navigator.clipboard?.writeText(asset.contract)
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] flex-1 overflow-y-auto px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header + Sync action ─────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Asset catalog
          </h1>
          <p className="mt-[5px] text-[13.5px] text-ink2">
            Assets, networks, decimals and live status. Sync the Blockradar
            catalog to discover new assets.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReasonFor("Sync Blockradar catalog")}
          aria-label="Sync Blockradar catalog"
          className="flex h-[38px] items-center gap-2 rounded-[11px] border border-line bg-card px-[15px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <SyncIcon />
          Sync Blockradar catalog
        </button>
      </div>

      {/* Last-sync line */}
      <div className="mb-3.5 text-[11px] text-ink3">Last sync: {LAST_SYNC}</div>

      {/* ── Newly discovered — review-to-add card ────────────────────────────── */}
      <DiscoveredCard
        onReview={(asset) => setReasonFor(`Add ${asset.name} (${asset.sym})`)}
      />

      {/* ── Asset table ──────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[16px] border border-line bg-card">
        {/* Column header row (design grid) */}
        <div
          className={cn(
            "grid gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase",
            ASSETS_GRID
          )}
        >
          <div>Asset</div>
          <div>Chain</div>
          <div>Decimals</div>
          <div>Min / max</div>
          <div>Contract</div>
          <div>Live</div>
        </div>
        {ASSET_ROWS.map((asset) => (
          <AssetRow
            key={`${asset.sym}-${asset.chain}`}
            asset={asset}
            onCopy={copyContract}
            onToggle={setToggleTarget}
          />
        ))}
      </div>

      {/* ── Flow modals (shared, design template §5) ─────────────────────────── */}
      <ReasonModal
        open={reasonFor !== null}
        onOpenChange={(open) => !open && setReasonFor(null)}
        title={reasonFor ?? ""}
        onContinue={() => setReasonFor(null)}
      />

      <MakerCheckerModal
        open={toggleTarget !== null}
        onOpenChange={(open) => !open && setToggleTarget(null)}
        title={
          toggleTarget
            ? `${toggleTarget.live ? "Pause" : "Enable"} ${toggleTarget.sym}`
            : ""
        }
        diff={
          toggleTarget
            ? [
                {
                  field: `${toggleTarget.sym} · ${toggleTarget.chain} live`,
                  from: toggleTarget.live ? "Live" : "Paused",
                  to: toggleTarget.live ? "Paused" : "Live",
                },
              ]
            : []
        }
        onSubmit={() => setToggleTarget(null)}
      />
    </div>
  )
}
