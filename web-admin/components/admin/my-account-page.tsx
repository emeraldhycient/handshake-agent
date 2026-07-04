"use client"

/**
 * MyAccountPage — the signed-in operator's self-service profile (`/account`).
 * Every operator can edit their OWN account here (display name); managing OTHER
 * admins' details / roles / status is the permissioned Admins & roles surface.
 *
 * Reads `useAdminMe()` (four branches: loading / error / data — an authenticated
 * identity is always present, so there is no empty branch). The editable field is
 * the display name, validated with `AdminSelfUpdateRequestSchema` (RHF +
 * zodResolver) and saved via `useUpdateOwnProfile` → `PATCH /admin/me`, which
 * needs no elevated permission (self-edit). Email / role / status / 2FA / last
 * login are shown read-only — role and status are changed only by an admin with
 * the permission, never self-service.
 */
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  AdminSelfUpdateRequestSchema,
  type AdminMe,
  type AdminSelfUpdateRequest,
} from "@handshake-agent/contracts"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useAdminMe, useUpdateOwnProfile } from "@/lib/query/hooks"
import { ApiError } from "@/lib/api/client"
import { pushToast } from "@/lib/store/toast-store"

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

export function MyAccountPage() {
  const me = useAdminMe()

  return (
    <div className="mx-auto w-full max-w-[720px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          My account
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Your operator profile. Edit your display name; role and status are
          managed by an admin.
        </p>
      </div>

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {me.isLoading && (
        <div
          className="rounded-[16px] border border-line bg-card p-[22px]"
          aria-busy="true"
        >
          <div className="flex flex-col gap-4">
            <Skeleton className="h-10 w-full rounded-[10px]" />
            <Skeleton className="h-24 w-full rounded-[10px]" />
          </div>
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {me.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn/40 p-6 text-center">
          <p className="text-[13.5px] font-bold text-tdn">
            Couldn&apos;t load your account
          </p>
          <button
            type="button"
            onClick={() => void me.refetch()}
            className="mt-2 text-[12.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Try again
          </button>
        </div>
      )}

      {/* ── Data ───────────────────────────────────────────────────────────── */}
      {me.data && <AccountForm me={me.data} />}
    </div>
  )
}

function AccountForm({ me }: { me: AdminMe }) {
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
  const serverError = errorMessage(update.error)

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
        <ReadOnlyRow label="2FA" value={me.mfaEnabled ? "Enrolled" : "Not set"} />
      </dl>

      <div className="mt-5 flex justify-end">
        <Button type="submit" disabled={loading || !isDirty} aria-busy={loading}>
          {loading ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  )
}

function ReadOnlyRow({
  label,
  value,
  capitalize,
}: {
  label: string
  value: string
  capitalize?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line2 py-[9px] last:border-b-0">
      <dt className="text-[12.5px] text-ink2">{label}</dt>
      <dd
        className={
          capitalize
            ? "text-[12.5px] font-semibold text-ink capitalize"
            : "text-[12.5px] font-semibold text-ink"
        }
      >
        {value}
      </dd>
    </div>
  )
}
