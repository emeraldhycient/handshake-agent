"use client"

/**
 * AssetsPage — the asset-catalog surface (design §6.23). Orchestrator: pulls the catalog +
 * sync + live-toggle view-model from `useAssetCatalog` and composes the Sync action, the
 * newly-discovered card, the catalog table, and the maker-checker + step-up modals. The
 * live toggle is a kill-switch (dual-control → step-up-guarded PATCH); nothing moves money (§3.1).
 */
import { MakerCheckerModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useAssetCatalog } from "@/lib/hooks/use-asset-catalog"
import { DiscoveredCard } from "@/components/admin/assets/discovered-card"
import { AssetsTable } from "@/components/admin/assets/assets-table"

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

export function AssetsPage() {
  const a = useAssetCatalog()

  return (
    <div className="mx-auto w-full max-w-[1200px] flex-1 overflow-y-auto px-[30px] pt-[26px] pb-[60px]">
      {/* Header + Sync action */}
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
          onClick={a.runSync}
          disabled={a.syncAssets.isPending}
          aria-label="Sync Blockradar catalog"
          className="flex h-[38px] items-center gap-2 rounded-[11px] border border-line bg-card px-[15px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SyncIcon />
          {a.syncAssets.isPending ? "Syncing…" : "Sync Blockradar catalog"}
        </button>
      </div>

      <div className="mb-3.5 text-[11px] text-ink3">
        Last sync: {a.lastSync}
      </div>

      <DiscoveredCard
        items={a.discovered.data?.items ?? []}
        loading={a.discovered.isLoading}
      />

      <AssetsTable
        assets={a.assets}
        isLoading={a.catalog.isLoading}
        isError={a.catalog.isError}
        isSuccess={a.catalog.isSuccess}
        onRetry={() => a.catalog.refetch()}
        onCopy={a.copyContract}
        onToggle={a.openToggle}
      />

      {/* Flow modals (shared, design template §5) */}
      <MakerCheckerModal
        open={a.toggleTarget !== null}
        onOpenChange={(open) => !open && a.closeToggle()}
        title={
          a.toggleTarget
            ? `${a.toggleTarget.live ? "Pause" : "Enable"} ${a.toggleTarget.sym}`
            : ""
        }
        diff={a.makerDiff}
        onSubmit={a.approveToggle}
      />

      {/* Server-side step-up re-auth: a 403 on the enabled PATCH opens this. */}
      <StepUpDialog
        open={a.stepUp.open}
        mfaEnabled={a.me.data?.mfaEnabled ?? false}
        onOpenChange={a.stepUp.setOpen}
        onSuccess={a.onStepUpSuccess}
      />
    </div>
  )
}
