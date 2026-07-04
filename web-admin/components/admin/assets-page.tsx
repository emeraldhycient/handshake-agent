"use client"

/**
 * AssetsPage — the Configuration group's asset-catalog screen (operator-console
 * design system §6.23, `docs/design-ref/screens/Assets.html`).
 *
 * WIRED (Phase 6b) to the real `GET /admin/config/catalog` read
 * (`useAdminCatalog`) — the FULL *effective* asset catalog (static config assets
 * PLUS provider-discovered assets not yet in the static config), including
 * *disabled* (Paused) listings and each entry's effective live status, which the
 * enabled-only, secret-stripped public `GET /config` cannot provide. Each
 * `AdminCatalogAsset` (symbol / displayName / kind / decimals / networks / live /
 * logoUrl) maps onto an `AssetCatalogRow`. The asset badge renders the discovered
 * `logoUrl` (Blockradar Cloudinary) via `AssetLogo`, falling back to the tinted
 * ticker chip. The design's Min/max + Contract columns have NO backing field
 * (per-asset limits + contract addresses are not surfaced — the latter is a
 * secret), so they render "—" (design-faithful).
 *
 * Layout (verbatim from the markup): a header + "Sync Blockradar catalog" ghost
 * action, a last-sync line, an info-toned "Newly discovered" card (WIRED to the real
 * GET /admin/config/assets/discovered), then the six-column asset table (Asset [logo
 * + sym/name] · Chain · Decimals · Min/max · Contract [mono, click-to-copy] · Live
 * toggle-pill).
 *
 * Actions wire to the SAME destinations as the design:
 * - Sync Blockradar / "Review & add" → the shared ReasonModal (recorded action).
 * - Live toggle-pill → the shared MakerCheckerModal (a dual-control config change).
 *   WIRED (Phase 9 — WRITE): approving the maker-checker fires the real step-up-guarded
 *   PATCH /admin/settings/:key (`useSetSetting`) on `catalog.assets.<sym>.enabled`, which
 *   the server re-validates (multi-currency invariant) + hot-reloads + audits; the
 *   catalog query then invalidates so the row re-resolves. A 403 opens the StepUpDialog
 *   and the PATCH replays after re-auth (`useStepUpRetry`). Nothing moves money (§3.1).
 * - Contract cell → click-to-copy (pure clipboard write, as in the design).
 */
import { useMemo, useState } from "react"

import { cn } from "@/lib/utils"
import { MakerCheckerModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { AssetLogo } from "@/components/ui/asset-logo"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/client"
import {
  useAdminCatalog,
  useAdminMe,
  useDiscoveredAssets,
  useSetSetting,
  useSyncAssets,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { pushToast } from "@/lib/store/toast-store"
import type { AdminDiscoveredAsset } from "@handshake-agent/contracts"
import type { AssetCatalogRow } from "@/types/components"

// Design §6.23 table grid — Asset / Chain / Decimals / Min-max / Contract / Live.
const ASSETS_GRID = "grid-cols-[1.4fr_0.8fr_0.7fr_1fr_1.6fr_0.7fr]"

// The last-sync caption, advanced when a manual Blockradar re-sync completes. Boot runs
// a sync automatically (CatalogSyncService), so the initial state reflects that.
const INITIAL_LAST_SYNC = "on boot · from the live catalog"

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
 * The info-toned "Newly discovered on-chain assets" card (design §6.23), WIRED to the
 * real GET /admin/config/assets/discovered read. It lists assets the Blockradar sync
 * found that are NOT yet in the static catalog, with their live status (discovered
 * assets are auto-enabled in the money-path overlay). Read-only review surface — the
 * card renders nothing when no new assets were discovered. Loading / empty / data.
 */
function DiscoveredCard({
  items,
  loading,
}: {
  items: readonly AdminDiscoveredAsset[]
  loading: boolean
}) {
  return (
    <div className="mb-3.5 rounded-[16px] border border-[#cfe0fb] bg-sif px-5 py-4">
      <div className="mb-2.5 flex items-center gap-2 text-[13px] font-extrabold text-tif">
        <DiscoveredIcon />
        Newly discovered on-chain assets
      </div>

      {loading && (
        <div className="flex items-center gap-3.5 py-2.5" aria-busy="true">
          <Skeleton className="size-[38px] flex-none rounded-[10px]" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2.5 w-48" />
          </div>
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="py-2 text-[12px] text-ink2">
          No new assets discovered. Run a sync to check the Blockradar catalog for
          assets not yet in this catalog.
        </div>
      )}

      {!loading &&
        items.map((asset) => (
          <div
            key={asset.symbol}
            className="flex items-center gap-3.5 py-2.5"
          >
            <AssetLogo
              sym={asset.symbol}
              logoUrl={asset.logoUrl}
              className="h-[38px] w-[38px] rounded-[10px] border border-[#cfe0fb] bg-white text-[11px] font-extrabold text-tif"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-ink">
                {asset.displayName} · {asset.symbol}
              </div>
              <div className="truncate font-mono text-[11px] text-ink3">
                {asset.networks.join(" · ") || "—"} · {asset.decimals} dp ·{" "}
                {asset.contractAddress ?? "native"}
              </div>
            </div>
            <span
              className={cn(
                "flex-none rounded-full px-[10px] py-[3px] text-[10.5px] font-bold",
                asset.enabled ? "bg-sok text-tok" : "bg-card2 text-ink3"
              )}
            >
              {asset.enabled ? "Live" : "Off"}
            </span>
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
      {/* Asset — logo (or green-chip fallback) + ticker + name */}
      <div className="flex min-w-0 items-center gap-2.5">
        <AssetLogo
          sym={asset.sym}
          logoUrl={asset.logo}
          className="h-[34px] w-[34px] rounded-[9px] bg-brand-green text-[11px] font-extrabold text-brand-amber"
        />
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

      {/* Min / max — not surfaced by the catalog read (per-asset limits are not
          modeled); renders "—" (design-faithful). */}
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

/** Stable identity for an asset row (ticker + chain uniquely name a listing). */
function assetKey(asset: AssetCatalogRow) {
  return `${asset.sym}-${asset.chain}`
}

/** The registry key backing an asset's live status (`catalog.assets.<sym>.enabled`). */
function assetEnabledKey(asset: AssetCatalogRow) {
  return `catalog.assets.${asset.sym}.enabled`
}

/** Normalizes a mutation/step-up failure into a user-facing message. */
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "Something went wrong."
}

export function AssetsPage() {
  // Real asset catalog (full — incl. disabled/paused), fetched from
  // GET /admin/config/catalog. Min/max + contract are not surfaced by the read,
  // so they render "—" (design-faithful).
  const { data, isLoading, isError, isSuccess, refetch } = useAdminCatalog()
  const discovered = useDiscoveredAssets()
  const syncAssets = useSyncAssets()
  const me = useAdminMe()
  const setSetting = useSetSetting()
  const stepUp = useStepUpRetry()

  const assets = useMemo<AssetCatalogRow[]>(
    () =>
      (data?.assets ?? []).map((a) => ({
        sym: a.symbol,
        name: a.displayName,
        chain: a.networks.join(" · ") || "—",
        dec: a.decimals,
        minmax: "—",
        contract: "—",
        logo: a.logoUrl,
        live: a.live,
      })),
    [data]
  )

  const [lastSync, setLastSync] = useState(INITIAL_LAST_SYNC)

  // The toggle target is held by key so the modal reads the row's live flag from
  // current data.
  const [toggleKey, setToggleKey] = useState<string | null>(null)
  const toggleTarget =
    assets.find((asset) => assetKey(asset) === toggleKey) ?? null

  function copyContract(asset: AssetCatalogRow) {
    if (asset.contract !== "—")
      void navigator.clipboard?.writeText(asset.contract)
  }

  /**
   * Real "Sync Blockradar catalog" — a one-click POST /admin/config/assets/sync
   * (permissioned + audited server-side; NOT step-up-gated — it is a catalog refresh, the
   * same discovery boot runs). On success advances the last-sync caption + toasts the
   * counts; the mutation invalidates the discovered list + admin catalog. Nothing here
   * moves money (§3.1) — discovery reads the provider's asset listing.
   */
  function runSync() {
    void (async () => {
      try {
        const res = await syncAssets.mutateAsync()
        setLastSync("just now")
        pushToast(
          res.newCount > 0
            ? `Blockradar sync — ${res.newCount} new asset(s) discovered`
            : `Blockradar synced — ${res.discoveredCount} asset(s), none new`,
          res.newCount > 0 ? "ok" : "info"
        )
      } catch (error) {
        pushToast(errorMessage(error), "warn")
      }
    })()
  }

  /**
   * Dual-control approved. Persists the new live status via the real step-up-guarded
   * PATCH /admin/settings/:key (`useSetSetting`) on `catalog.assets.<sym>.enabled` — the
   * server re-validates the multi-currency invariant + hot-reloads + audits; the catalog
   * query then invalidates so the row re-resolves. A 403 opens the StepUpDialog and the
   * PATCH replays after re-auth. Nothing moves money (§3.1).
   */
  function approveToggle() {
    if (!toggleTarget) return
    const asset = toggleTarget
    const enabling = !asset.live
    setToggleKey(null)
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          setSetting
            .mutateAsync({
              key: assetEnabledKey(asset),
              input: { value: enabling, scope: "global", scopeValue: null },
            })
            .then(() => undefined)
        )
        if (ok) {
          // useSetSetting invalidates the settings prefix, not the admin catalog this
          // page reads from — refetch it so the Live/Paused pill re-resolves.
          void refetch()
          pushToast(
            `${asset.sym} ${enabling ? "enabled" : "paused"}`,
            enabling ? "ok" : "warn"
          )
        }
      } catch (error) {
        pushToast(errorMessage(error), "warn")
      }
    })()
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
          onClick={runSync}
          disabled={syncAssets.isPending}
          aria-label="Sync Blockradar catalog"
          className="flex h-[38px] items-center gap-2 rounded-[11px] border border-line bg-card px-[15px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SyncIcon />
          {syncAssets.isPending ? "Syncing…" : "Sync Blockradar catalog"}
        </button>
      </div>

      {/* Last-sync line */}
      <div className="mb-3.5 text-[11px] text-ink3">Last sync: {lastSync}</div>

      {/* ── Newly discovered — real Blockradar discovery review ──────────────── */}
      <DiscoveredCard
        items={discovered.data?.items ?? []}
        loading={discovered.isLoading}
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

        {/* Loading */}
        {isLoading &&
          Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "grid items-center gap-3 border-b border-line2 px-[18px] py-[13px] last:border-b-0",
                ASSETS_GRID
              )}
              aria-busy="true"
            >
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-[34px] flex-none rounded-[9px]" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-2.5 w-24" />
                </div>
              </div>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-6" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-4 w-12 rounded-full" />
            </div>
          ))}

        {/* Error */}
        {isError && (
          <div className="px-5 py-[52px] text-center">
            <div className="text-[14px] font-bold text-tdn">
              Couldn&apos;t load the asset catalog
            </div>
            <div className="mt-1 text-[12.5px] text-ink2">
              The catalog failed to load. Check your connection and try again.
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-3 inline-flex h-[34px] items-center rounded-[10px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty */}
        {isSuccess && assets.length === 0 && (
          <div className="px-5 py-[60px] text-center text-ink3">
            <div className="text-[14px] font-bold text-ink2">
              No assets in the catalog
            </div>
            <div className="mt-1 text-[12.5px]">
              Sync the Blockradar catalog to discover and add assets.
            </div>
          </div>
        )}

        {/* Rows */}
        {isSuccess &&
          assets.map((asset) => (
            <AssetRow
              key={assetKey(asset)}
              asset={asset}
              onCopy={copyContract}
              onToggle={(a) => setToggleKey(assetKey(a))}
            />
          ))}
      </div>

      {/* ── Flow modals (shared, design template §5) ─────────────────────────── */}
      <MakerCheckerModal
        open={toggleTarget !== null}
        onOpenChange={(open) => !open && setToggleKey(null)}
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
        onSubmit={approveToggle}
      />

      {/* Server-side step-up re-auth: a 403 on the enabled PATCH opens this; the
          PATCH replays after re-authentication (the catalog then invalidates). */}
      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .then((done) => {
              if (done) void refetch()
            })
            .catch((error) => pushToast(errorMessage(error), "warn"))
        }}
      />
    </div>
  )
}
