"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  ClaimPayIdSchema,
  normalizeHandle,
  type ClaimPayId,
} from "@handshake-agent/contracts"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { FormField } from "@/components/shared/form-field"
import { CopyButton } from "@/components/shared/copy-button"
import { useProfile } from "@/lib/query/auth"
import { useChangePayId } from "@/lib/query/profile"
import { toErrorMessage } from "@/lib/error-message"
import { ApiError } from "@/lib/api/client"
import type { ChangePayIdFormProps } from "@/types"

/**
 * Inline one-time PayID change form. A 409 `PAYID_ALREADY_CHANGED` is
 * distinguished from every other failure (bad format, `HANDLE_TAKEN`,
 * network): the parent locks the whole section on it instead of leaving the
 * form open for a retry that can never succeed.
 */
function ChangePayIdForm({ onDone, onAlreadyChanged }: ChangePayIdFormProps) {
  const changePayId = useChangePayId()
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClaimPayId>({
    resolver: zodResolver(ClaimPayIdSchema),
    defaultValues: { payId: "" },
  })

  async function onSubmit(values: ClaimPayId) {
    setServerError(null)
    try {
      await changePayId.mutateAsync(values)
      onDone()
    } catch (err) {
      if (err instanceof ApiError && err.code === "PAYID_ALREADY_CHANGED") {
        onAlreadyChanged(err.message)
        return
      }
      setServerError(toErrorMessage(err))
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-3 border-t border-border px-5 py-4"
      noValidate
    >
      <FormField
        id="payid-new-handle"
        label="New handle"
        placeholder="yourhandle"
        hint="3-30 characters: lowercase letters, numbers, underscore. This can only be done once."
        error={errors.payId?.message}
        {...register("payId", {
          setValueAs: (v: unknown) => normalizeHandle(String(v ?? "")),
        })}
      />
      {serverError && (
        <p className="text-[12.5px] text-danger" role="alert">
          {serverError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDone}
          disabled={changePayId.isPending}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={changePayId.isPending}>
          {changePayId.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  )
}

/**
 * PayID card: the user's public `@handle` (with copy-to-clipboard) plus a
 * one-time change form. The backend enforces exactly one change; there is no
 * persisted "already changed" flag on the profile response to gate the
 * control up front (root CLAUDE.md §3.3 — the server re-enforces regardless
 * of what this UI shows), so this locks reactively the first time a 409
 * `PAYID_ALREADY_CHANGED` is hit in the session.
 */
export function PayIdSection() {
  const profile = useProfile()
  const [editing, setEditing] = useState(false)
  const [lockedMessage, setLockedMessage] = useState<string | null>(null)

  if (profile.isLoading) {
    return (
      <div className="rounded-[16px] border border-border bg-card px-5 py-[18px]">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-2 h-5 w-40" />
      </div>
    )
  }

  if (profile.isError || !profile.data) {
    return (
      <div className="rounded-[16px] border border-danger/20 bg-danger/5 px-5 py-[18px]">
        <p className="text-sm font-semibold text-danger">
          Could not load your PayID.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Please refresh the page.
        </p>
      </div>
    )
  }

  const { payId } = profile.data
  const locked = lockedMessage !== null

  return (
    <div className="rounded-[16px] border border-border bg-card">
      <p className="border-b border-border px-5 py-[13px] text-xs font-bold tracking-widest text-muted-foreground uppercase">
        PayID
      </p>
      <div className="flex items-center gap-3 px-5 py-[15px]">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Your handle</p>
          {payId ? (
            <div className="flex items-center text-[13px] text-muted-foreground">
              <span className="font-mono" translate="no">
                @{payId}
              </span>
              <CopyButton value={`@${payId}`} label="PayID" />
            </div>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              Not yet claimed
            </p>
          )}
        </div>
        {!locked && !editing && (
          <button
            type="button"
            className="cursor-pointer text-[13px] font-bold text-primary"
            onClick={() => setEditing(true)}
          >
            Change
          </button>
        )}
      </div>
      {locked && (
        <p
          className="border-t border-border px-5 py-3 text-[12.5px] text-muted-foreground"
          role="status"
        >
          {lockedMessage}
        </p>
      )}
      {editing && !locked && (
        <ChangePayIdForm
          onDone={() => setEditing(false)}
          onAlreadyChanged={(message) => {
            setLockedMessage(message)
            setEditing(false)
          }}
        />
      )}
    </div>
  )
}
