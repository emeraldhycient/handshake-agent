"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  AdminSelfUpdateRequestSchema,
  type AdminSelfUpdateRequest,
} from "@handshake-agent/contracts"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useUpdateOwnProfile } from "@/lib/query/hooks"
import { toErrorMessage } from "@/lib/error-message"
import { pushToast } from "@/lib/store/toast-store"
import type { AccountFormProps } from "@/types"

import { ReadOnlyRow } from "./read-only-row"

/**
 * The self-service profile form — the display name is editable (validated with
 * `AdminSelfUpdateRequestSchema`, saved via `useUpdateOwnProfile` → PATCH /admin/me,
 * which needs no elevated permission). Email / role / status / 2FA are read-only —
 * role and status are changed only by an admin with the permission, never self-service.
 */
export function AccountForm({ me }: AccountFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AdminSelfUpdateRequest>({
    resolver: zodResolver(AdminSelfUpdateRequestSchema),
    defaultValues: { displayName: me.displayName },
  })

  const update = useUpdateOwnProfile()

  async function onSubmit(values: AdminSelfUpdateRequest) {
    try {
      await update.mutateAsync(values)
      pushToast("Your profile was updated", "ok")
    } catch {
      // Surfaces via update.error below.
    }
  }

  const loading = isSubmitting || update.isPending
  const serverError = toErrorMessage(update.error)

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="rounded-[16px] border border-line bg-card p-[22px]"
    >
      {serverError && (
        <div
          role="alert"
          className="mb-4 rounded-[10px] border border-sdn bg-sdn px-4 py-3 text-[13px] font-semibold text-tdn"
        >
          {serverError}
        </div>
      )}

      {/* Editable — display name */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="account-display-name">Display name</Label>
        <Input
          id="account-display-name"
          aria-invalid={!!errors.displayName}
          placeholder="Your name"
          disabled={loading}
          {...register("displayName")}
        />
        {errors.displayName && (
          <p role="alert" className="text-[11.5px] font-semibold text-tdn">
            {errors.displayName.message ?? "Enter a display name"}
          </p>
        )}
      </div>

      {/* Read-only identity (managed by an admin, not self-service) */}
      <dl className="mt-5 border-t border-line2 pt-4">
        <ReadOnlyRow label="Email" value={me.email} />
        <ReadOnlyRow label="Role" value={me.role.name} />
        <ReadOnlyRow label="Status" value={me.status} capitalize />
        <ReadOnlyRow
          label="2FA"
          value={me.mfaEnabled ? "Enrolled" : "Not set"}
        />
      </dl>

      <div className="mt-5 flex justify-end">
        <Button
          type="submit"
          disabled={loading || !isDirty}
          aria-busy={loading}
        >
          {loading ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  )
}
