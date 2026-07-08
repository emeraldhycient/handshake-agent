"use client"

import { useMemo, useState } from "react"

import { useAdminMe, useSetSetting, useSettings } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { pushToast } from "@/lib/store/toast-store"
import { toErrorMessage } from "@/lib/error-message"
import { resolveFlags, toggleDiff } from "@/lib/flags/rows"
import type { ResolvedFlag } from "@/types/components"

/** Flag failures always surface a string toast (never null). */
function toastError(error: unknown): string {
  return toErrorMessage(error) ?? "Something went wrong."
}

/**
 * The feature-flags data layer: resolves each flag's effective `on` from the settings
 * registry and drives the dual-control toggle. A REGISTRY-BACKED flag persists a flip
 * via the step-up-guarded PATCH /admin/settings/:key (re-validated + hot-reloaded +
 * audited server-side); an UNBACKED flag has no key to persist, so its toggle stays an
 * acknowledged design intent. A 403 opens the StepUpDialog and the PATCH replays after
 * re-auth. Nothing moves money (§3.1). Extracted so the page is composition.
 */
export function useFeatureFlags() {
  const query = useSettings()
  const rows = useMemo(() => resolveFlags(query.data ?? []), [query.data])

  const me = useAdminMe()
  const setSetting = useSetSetting()
  const stepUp = useStepUpRetry()

  // Which flag's toggle is pending dual-control approval (drives the modal + write).
  const [pending, setPending] = useState<ResolvedFlag | null>(null)

  const diff = toggleDiff(pending)

  /**
   * Confirmed. A REGISTRY-BACKED flag persists the flip via the real step-up-guarded
   * PATCH; the settings query then invalidates so the row re-resolves. A 403 opens
   * the StepUpDialog and the PATCH replays after re-auth. An UNBACKED flag has no
   * key to persist — it renders read-only and can never reach this path (guarded
   * fail-closed; no fake-success toast). Nothing moves money.
   */
  const applyToggle = () => {
    if (!pending) return
    const flag = pending
    const nextOn = !flag.on
    setPending(null)

    if (!flag.settingKey) return

    const key = flag.settingKey
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          setSetting
            .mutateAsync({
              key,
              input: {
                value: nextOn,
                scope: flag.scope,
                scopeValue: flag.scopeValue,
              },
            })
            .then(() => undefined)
        )
        if (ok) pushToast(`${flag.key} · eval → ${nextOn ? "on" : "off"}`, "ok")
      } catch (error) {
        pushToast(toastError(error), "warn")
      }
    })()
  }

  function onStepUpSuccess() {
    void stepUp
      .retry()
      .then(() => undefined)
      .catch((error) => pushToast(toastError(error), "warn"))
  }

  return {
    query,
    rows,
    me,
    stepUp,
    pending,
    setPending,
    diff,
    applyToggle,
    onStepUpSuccess,
  }
}
