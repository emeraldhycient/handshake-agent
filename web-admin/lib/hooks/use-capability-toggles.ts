"use client"

import { useMemo, useState } from "react"

import { useAdminMe, useSetSetting, useSettings } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import { pushToast } from "@/lib/store/toast-store"
import { buildRows } from "@/lib/capabilities/build"

/** Capability failures always surface a string toast (never null). */
function toastError(error: unknown): string {
  return toErrorMessage(error) ?? "Something went wrong."
}

/**
 * The Capabilities switchboard state machine: resolves the live kill-switch rows from
 * the `catalog.capabilities.crypto.*` registry, and drives the maker-checker → step-up
 * flip. A toggle is a KILL-SWITCH (§7) — never a direct flip; the approve step fires the
 * step-up-guarded PATCH which re-validates + hot-reloads + audits server-side. A 403
 * opens the StepUpDialog and the PATCH replays after re-auth. Nothing moves money (§3.1).
 */
export function useCapabilityToggles() {
  const query = useSettings("Catalog")
  const rows = useMemo(() => buildRows(query.data ?? []), [query.data])

  const me = useAdminMe()
  const setSetting = useSetSetting()
  const stepUp = useStepUpRetry()

  // Which capability's toggle is pending dual-control approval. Held by id so the
  // resolved row (with its setting key) is re-derived from the freshest rows.
  const [pendingId, setPendingId] = useState<string | null>(null)
  const pending = rows.find((r) => r.id === pendingId) ?? null

  // The from→to change preview for the maker-checker modal (design's diff table).
  const diff = useMemo(() => {
    if (!pending) return []
    return [
      {
        field: `capability: ${pending.label}`,
        from: pending.on ? "Enabled" : "Disabled",
        to: pending.on ? "Disabled" : "Enabled",
      },
    ]
  }, [pending])

  /** Approve the kill-switch flip via the real step-up-guarded PATCH (§7). */
  function approveToggle() {
    if (!pending) return
    const cap = pending
    const enabling = !cap.on
    setPendingId(null)
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          setSetting
            .mutateAsync({
              key: cap.settingKey,
              input: {
                value: enabling,
                scope: cap.scope,
                scopeValue: cap.scopeValue,
              },
            })
            .then(() => undefined)
        )
        if (ok)
          pushToast(
            `${cap.label} ${enabling ? "enabled" : "disabled"}`,
            enabling ? "ok" : "warn"
          )
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
    diff,
    openToggle: (id: string) => setPendingId(id),
    closeToggle: () => setPendingId(null),
    approveToggle,
    onStepUpSuccess,
  }
}
