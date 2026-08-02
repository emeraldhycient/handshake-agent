"use client"

/**
 * KycReviewActions — Approve (promote to a verified tier) / Reject (with a
 * reason) for one KYC submission. Both are sensitive: we attempt the mutation,
 * and if it 403s with ADMIN_STEP_UP_REQUIRED we open the StepUpDialog and retry
 * after re-auth (`useStepUpRetry`). A server validation error surfaces inline.
 *
 * Approve never promotes to 'unverified' — the tier select is tier_1/2/3 only
 * (mirrors KycApproveRequest).
 */
import { useState } from "react"
import { KycApproveRequestSchema } from "@handshake-agent/contracts"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useAdminMe, useApproveKyc, useRejectKyc } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import type { KycReviewActionsProps } from "@/types"

const APPROVE_TIERS = KycApproveRequestSchema.shape.tier.options

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

export function KycReviewActions({ submission }: KycReviewActionsProps) {
  const me = useAdminMe()
  const approve = useApproveKyc()
  const reject = useRejectKyc()
  const stepUp = useStepUpRetry()
  const [tier, setTier] = useState<(typeof APPROVE_TIERS)[number]>("tier_1")
  const [reason, setReason] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  const { userId } = submission

  async function run(action: () => Promise<void>) {
    setLocalError(null)
    try {
      await stepUp.run(action)
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }

  function onApprove() {
    void run(() =>
      approve.mutateAsync({ userId, input: { tier } }).then(() => undefined)
    )
  }

  function onReject() {
    if (reason.trim().length === 0) {
      setLocalError("A rejection reason is required.")
      return
    }
    void run(() =>
      reject
        .mutateAsync({ userId, input: { reason: reason.trim() } })
        .then(() => undefined)
    )
  }

  const busy = approve.isPending || reject.isPending

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kyc-approve-tier">Approve to tier</Label>
          <NativeSelect
            id="kyc-approve-tier"
            aria-label="Approve to tier"
            value={tier}
            disabled={busy}
            onChange={(e) =>
              setTier(e.target.value as (typeof APPROVE_TIERS)[number])
            }
            className="w-40"
          >
            {APPROVE_TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button size="sm" onClick={onApprove} disabled={busy} aria-busy={busy}>
          Approve
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="kyc-reject-reason">Rejection reason</Label>
        <textarea
          id="kyc-reject-reason"
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this submission rejected?"
          rows={3}
          className="min-h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
        />
        <Button
          size="sm"
          variant="destructive"
          onClick={onReject}
          disabled={busy}
          aria-busy={busy}
          className="self-start"
        >
          Reject
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
