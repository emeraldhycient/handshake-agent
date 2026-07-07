"use client"

import { useState } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { MfaEnrollDialog } from "@/components/admin/mfa-enroll-dialog"
import { useAdminMe } from "@/lib/query/hooks"

import { ProfileCard } from "./profile-card"

/** Loading skeleton mirroring the profile card's height + shape. */
function ProfileCardSkeleton() {
  return (
    <div className="mb-[14px] flex items-center gap-[15px] rounded-[16px] border border-line bg-card p-[18px_20px]">
      <Skeleton className="size-[52px] flex-none rounded-full" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-2 h-3 w-52" />
      </div>
      <Skeleton className="h-7 w-24 rounded-full" />
    </div>
  )
}

/** Inline error card for a failed profile fetch, with a retry affordance. */
function ProfileCardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mb-[14px] rounded-[16px] border border-sdn bg-sdn/40 p-[18px_20px] text-center">
      <div className="text-[13.5px] font-bold text-tdn">
        Couldn&apos;t load your profile
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 text-[12.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Try again
      </button>
    </div>
  )
}

/**
 * The profile section — reads the operator's own identity (`useAdminMe`) and renders
 * the four branches (loading / error / data). When not enrolled, the card's "Enroll
 * 2FA" button opens the shared `MfaEnrollDialog`, whose open-state this section owns.
 */
export function ProfileSection() {
  const meQuery = useAdminMe()
  const [enrollOpen, setEnrollOpen] = useState(false)

  return (
    <>
      {meQuery.isLoading && <ProfileCardSkeleton />}
      {meQuery.isError && (
        <ProfileCardError onRetry={() => void meQuery.refetch()} />
      )}
      {meQuery.isSuccess && (
        <ProfileCard
          displayName={meQuery.data.displayName}
          email={meQuery.data.email}
          roleLabel={meQuery.data.role.name}
          mfaEnabled={meQuery.data.mfaEnabled}
          onEnroll={() => setEnrollOpen(true)}
        />
      )}

      <MfaEnrollDialog open={enrollOpen} onOpenChange={setEnrollOpen} />
    </>
  )
}
