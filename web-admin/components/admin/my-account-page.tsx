"use client"

/**
 * MyAccountPage — the signed-in operator's self-service profile (`/account`).
 * Composition only: `useAdminMe` drives the three async branches (an authenticated
 * identity is always present, so there is no empty branch); the editable form lives in
 * `components/admin/my-account/*`. Every operator can edit their OWN display name here;
 * role / status are managed only by an admin with the permission (never self-service).
 */
import { Skeleton } from "@/components/ui/skeleton"
import { useAdminMe } from "@/lib/query/hooks"
import { AccountForm } from "@/components/admin/my-account/account-form"

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
