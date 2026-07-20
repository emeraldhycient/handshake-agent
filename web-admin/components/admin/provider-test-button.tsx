"use client"

/**
 * ProviderTestButton — runs a provider "Test connection" liveness probe (Phase 7).
 *
 * The probe is a real, credential-free reachability check — it exposes NO secret
 * value (§3.4/§3.5) and moves NO money (§3.1). It is sensitive: if the mutation 403s
 * with ADMIN_STEP_UP_REQUIRED we open the StepUpDialog and replay after re-auth
 * (`useStepUpRetry`). The probe outcome (ok / degraded / down / mock / not_configured)
 * is shown inline with a status word — colour is never the sole signal.
 */
import { useState } from "react"

import type { ProviderProbeResult, ProviderTestResponse } from "@handshake-agent/contracts"

import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useAdminMe, useTestProviderConnection } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import type { ProviderTestButtonProps } from "@/types/components"

// Probe result → its inline status word + token colour (colour never the sole signal).
const RESULT_META: Record<
  ProviderProbeResult,
  { label: string; tone: string }
> = {
  ok: { label: "Reachable", tone: "text-tok" },
  degraded: { label: "Degraded", tone: "text-twn" },
  down: { label: "Unreachable", tone: "text-tdn" },
  not_configured: { label: "Not configured", tone: "text-ink3" },
  mock: { label: "Mock mode", tone: "text-tif" },
}

function resultLabel(result: ProviderTestResponse): string {
  const meta = RESULT_META[result.result]
  return result.latencyMs !== null
    ? `${meta.label} · ${result.latencyMs}ms`
    : meta.label
}

export function ProviderTestButton({ providerKey }: ProviderTestButtonProps) {
  const me = useAdminMe()
  const test = useTestProviderConnection()
  const stepUp = useStepUpRetry()
  const [result, setResult] = useState<ProviderTestResponse | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  function onTest() {
    setLocalError(null)
    void (async () => {
      try {
        await stepUp.run(() =>
          test.mutateAsync(providerKey).then((res) => {
            setResult(res)
          })
        )
      } catch (error) {
        setLocalError(toErrorMessage(error))
      }
    })()
  }

  return (
    <div className="mt-2.5 flex items-center gap-2.5">
      <button
        type="button"
        onClick={onTest}
        disabled={test.isPending}
        aria-busy={test.isPending}
        className="rounded-[9px] border border-line bg-card px-3 py-1.5 text-[11.5px] font-bold text-ink2 transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
      >
        {test.isPending ? "Testing…" : "Test connection"}
      </button>
      {result && !localError && (
        <span
          className={`text-[11px] font-bold ${RESULT_META[result.result].tone}`}
        >
          {resultLabel(result)}
        </span>
      )}
      {localError && (
        <span role="alert" className="text-[11px] font-semibold text-tdn">
          {localError}
        </span>
      )}

      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .catch((error) => setLocalError(toErrorMessage(error)))
        }}
      />
    </div>
  )
}
