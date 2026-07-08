"use client"

import { useMemo, useState } from "react"
import type { AdminCustomFiatCreateRequest } from "@handshake-agent/contracts"

import {
  useAdminCatalog,
  useAdminMe,
  useAddCurrency,
  useSetSetting,
  useUpdateCurrency,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { pushToast } from "@/lib/store/toast-store"
import { toErrorMessage } from "@/lib/error-message"
import {
  existingCodesFrom,
  toCatalogRows,
  toggleDiff,
} from "@/lib/currencies/rows"
import type { CurrencyCatalogRow } from "@/types/components"

/** Currency failures always surface a string toast (never null). */
function toastError(error: unknown): string {
  return toErrorMessage(error) ?? "Something went wrong."
}

/**
 * The currency-catalog data layer: reads the FULL fiat catalog (incl. disabled/off)
 * and drives the two dual-control writes — the Live-pill toggle (maker-checker →
 * step-up-guarded PATCH; a CUSTOM fiat toggles via the currency endpoint, a BUILT-IN
 * via the settings key `catalog.fiats.<code>.enabled`) and the add-currency dialog
 * (creates a fiat DISABLED — enabled-needs-pricing is fail-closed server-side). A 403
 * opens the StepUpDialog and the write replays after re-auth. Nothing moves money
 * (§3.1). Extracted so the page is composition.
 */
export function useCurrencyCatalog() {
  const { data, isLoading, isError, isSuccess, refetch } = useAdminCatalog()
  const me = useAdminMe()
  const setSetting = useSetSetting()
  const addCurrency = useAddCurrency()
  const updateCurrency = useUpdateCurrency()
  const stepUp = useStepUpRetry()

  // Whether the "Add currency" dialog is open.
  const [addOpen, setAddOpen] = useState(false)

  const rows = useMemo<CurrencyCatalogRow[]>(
    () => toCatalogRows(data?.fiats),
    [data]
  )

  // Which currency's Live toggle is pending dual-control approval (drives the modal).
  const [pending, setPending] = useState<CurrencyCatalogRow | null>(null)

  const diff = toggleDiff(pending)

  // Dual-control approved. Persists the new live status via the real step-up-guarded
  // PATCH — the server re-validates the multi-currency invariant + hot-reloads + audits.
  // A 403 opens the StepUpDialog and the PATCH replays after re-auth. Nothing moves money.
  const applyToggle = () => {
    if (!pending) return
    const fiat = pending
    const enabling = !fiat.live
    setPending(null)
    void (async () => {
      try {
        // A CUSTOM fiat toggles via the currency endpoint (PATCH /admin/config/
        // currencies/:code — enabling is fail-closed on pricing server-side); a
        // BUILT-IN toggles the settings key. Both are step-up-gated + audited.
        const ok = await stepUp.run(() =>
          (fiat.custom
            ? updateCurrency.mutateAsync({
                code: fiat.code,
                patch: { enabled: enabling },
              })
            : setSetting.mutateAsync({
                key: `catalog.fiats.${fiat.code}.enabled`,
                input: { value: enabling, scope: "global", scopeValue: null },
              })
          ).then(() => undefined)
        )
        if (ok) {
          // useSetSetting invalidates the settings prefix, not the admin catalog this
          // page reads from — refetch it so the Live/Off pill re-resolves.
          void refetch()
          pushToast(
            `${fiat.code} ${enabling ? "enabled" : "disabled"}`,
            enabling ? "ok" : "warn"
          )
        }
      } catch (error) {
        pushToast(toastError(error), "warn")
      }
    })()
  }

  // Every code already in the catalog (built-in + custom), for the dialog's fast
  // local duplicate check ahead of the server's 409.
  const existingCodes = useMemo(() => existingCodesFrom(data?.fiats), [data])

  // Add-currency submit. The new fiat is created DISABLED (the enabled-needs-pricing
  // invariant is fail-closed server-side); the write is step-up-gated + audited. On a
  // step-up challenge the add dialog resolves + closes and the StepUpDialog takes over
  // (its onSuccess replays the add). A collision/validation error rejects so the dialog
  // shows it inline. Nothing moves money (§3.1).
  async function saveNewCurrency(input: AdminCustomFiatCreateRequest) {
    const ok = await stepUp.run(() =>
      addCurrency.mutateAsync(input).then(() => undefined)
    )
    if (ok) {
      void refetch()
      pushToast(`${input.code} added — enable it once pricing is set`, "ok")
    }
  }

  function onStepUpSuccess() {
    void stepUp
      .retry()
      .then((done) => {
        if (done) void refetch()
      })
      .catch((error) => pushToast(toastError(error), "warn"))
  }

  return {
    rows,
    isLoading,
    isError,
    isSuccess,
    refetch,
    me,
    stepUp,
    addOpen,
    setAddOpen,
    pending,
    setPending,
    diff,
    applyToggle,
    existingCodes,
    saveNewCurrency,
    onStepUpSuccess,
  }
}
