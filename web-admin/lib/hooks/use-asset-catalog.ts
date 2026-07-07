"use client"

import { useMemo, useState } from "react"

import {
  useAdminCatalog,
  useAdminMe,
  useDiscoveredAssets,
  useSetSetting,
  useSyncAssets,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import { pushToast } from "@/lib/store/toast-store"
import { INITIAL_LAST_SYNC } from "@/constants/assets"
import { assetEnabledKey, assetKey, toAssetRow } from "@/lib/assets/rows"
import type { AssetCatalogRow, MakerCheckerDiffRow } from "@/types/components"

/** Asset failures always surface a string toast (never null). */
function toastError(error: unknown): string {
  return toErrorMessage(error) ?? "Something went wrong."
}

/**
 * The asset-catalog view-model: the live catalog + discovered-assets reads, the Blockradar
 * sync action, and the per-asset live-toggle kill-switch (maker-checker → the real
 * step-up-guarded PATCH on `catalog.assets.<sym>.enabled`). A 403 opens the StepUpDialog
 * and the PATCH replays after re-auth. Nothing moves money (§3.1). Extracted so the page
 * is pure composition.
 */
export function useAssetCatalog() {
  const catalog = useAdminCatalog()
  const discovered = useDiscoveredAssets()
  const syncAssets = useSyncAssets()
  const me = useAdminMe()
  const setSetting = useSetSetting()
  const stepUp = useStepUpRetry()

  const assets = useMemo<AssetCatalogRow[]>(
    () => (catalog.data?.assets ?? []).map(toAssetRow),
    [catalog.data]
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

  /** Real "Sync Blockradar catalog" — a one-click POST (NOT step-up-gated). */
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
        pushToast(toastError(error), "warn")
      }
    })()
  }

  /** Dual-control approved: persist the new live status via the step-up-guarded PATCH. */
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
          void catalog.refetch()
          pushToast(
            `${asset.sym} ${enabling ? "enabled" : "paused"}`,
            enabling ? "ok" : "warn"
          )
        }
      } catch (error) {
        pushToast(toastError(error), "warn")
      }
    })()
  }

  function onStepUpSuccess() {
    void stepUp
      .retry()
      .then((done) => {
        if (done) void catalog.refetch()
      })
      .catch((error) => pushToast(toastError(error), "warn"))
  }

  const makerDiff: MakerCheckerDiffRow[] = toggleTarget
    ? [
        {
          field: `${toggleTarget.sym} · ${toggleTarget.chain} live`,
          from: toggleTarget.live ? "Live" : "Paused",
          to: toggleTarget.live ? "Paused" : "Live",
        },
      ]
    : []

  return {
    catalog,
    discovered,
    syncAssets,
    me,
    stepUp,
    assets,
    lastSync,
    toggleTarget,
    makerDiff,
    copyContract,
    runSync,
    openToggle: (asset: AssetCatalogRow) => setToggleKey(assetKey(asset)),
    closeToggle: () => setToggleKey(null),
    approveToggle,
    onStepUpSuccess,
  }
}
