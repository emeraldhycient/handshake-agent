"use client"

/**
 * UserActions — the sensitive operator actions for one end user: adjust KYC tier
 * (select), change account status (suspend / reactivate / deactivate), force a
 * PIN reset, and trigger a SIM-swap re-verification.
 *
 * Each action is gated by a fresh step-up: we attempt the mutation, and if it
 * 403s with ADMIN_STEP_UP_REQUIRED we open the StepUpDialog; after re-auth the
 * stashed mutation is retried (`useStepUpRetry`). The signed-in admin's
 * `mfaEnabled` decides whether step-up asks for a password or a TOTP.
 */
import { useState } from "react"
import { KeyRound, ShieldAlert } from "lucide-react"
import { KycTierSchema } from "@handshake-agent/contracts"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import {
  useAdjustTier,
  useAdminMe,
  useForcePinReset,
  useSetUserStatus,
  useSimSwapReverify,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import type { UserActionsProps } from "@/types/components"

const TIERS = KycTierSchema.options

// Status transitions offered per current status (settable statuses only;
// 'provisional' is a system-only initial state, never set here).
const NEXT_STATUS: Record<
  string,
  { label: string; status: "active" | "suspended" | "deactivated" }[]
> = {
  provisional: [{ label: "Activate", status: "active" }],
  active: [
    { label: "Suspend", status: "suspended" },
    { label: "Deactivate", status: "deactivated" },
  ],
  suspended: [
    { label: "Reactivate", status: "active" },
    { label: "Deactivate", status: "deactivated" },
  ],
  deactivated: [{ label: "Reactivate", status: "active" }],
}

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

export function UserActions({ user }: UserActionsProps) {
  const me = useAdminMe()
  const adjustTier = useAdjustTier()
  const setStatus = useSetUserStatus()
  const pinReset = useForcePinReset()
  const simSwap = useSimSwapReverify()
  const stepUp = useStepUpRetry()
  const [localError, setLocalError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    setLocalError(null)
    try {
      await stepUp.run(action)
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }

  function changeTier(tier: string) {
    if (tier === user.kycTier) return
    void run(() =>
      adjustTier
        .mutateAsync({
          id: user.id,
          input: { tier: tier as (typeof TIERS)[number] },
        })
        .then(() => undefined)
    )
  }

  function changeStatus(status: "active" | "suspended" | "deactivated") {
    void run(() =>
      setStatus
        .mutateAsync({ id: user.id, input: { status } })
        .then(() => undefined)
    )
  }

  const busy =
    adjustTier.isPending ||
    setStatus.isPending ||
    pinReset.isPending ||
    simSwap.isPending
  const transitions = NEXT_STATUS[user.status] ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user-tier-adjust">KYC tier</Label>
        <NativeSelect
          id="user-tier-adjust"
          aria-label="Adjust KYC tier"
          value={user.kycTier}
          disabled={busy}
          onChange={(e) => changeTier(e.target.value)}
          className="w-44"
        >
          {TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {tier}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {transitions.map((t) => (
          <Button
            key={t.status}
            size="sm"
            variant={t.status === "active" ? "outline" : "destructive"}
            disabled={busy}
            onClick={() => changeStatus(t.status)}
          >
            {t.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(() => pinReset.mutateAsync(user.id).then(() => undefined))
          }
        >
          <KeyRound aria-hidden="true" />
          Force PIN reset
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(() => simSwap.mutateAsync(user.id).then(() => undefined))
          }
        >
          <ShieldAlert aria-hidden="true" />
          SIM-swap re-verify
        </Button>
      </div>

      {localError && (
        <p role="alert" className="text-xs text-destructive">
          {localError}
        </p>
      )}

      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .catch((error) => setLocalError(errorMessage(error)))
        }}
      />
    </div>
  )
}
