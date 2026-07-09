"use client"

import { useState } from "react"
import { PencilIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AvatarPlaceholder } from "@/components/shared"
import { useProfile } from "@/lib/query/auth"
import { useConfig } from "@/lib/query/hooks"
import { tierLabel } from "@/lib/format/tier"
import { EditProfileDialog } from "./edit-profile-dialog"

/**
 * Profile card (loading / error / data) + the edit dialog for the two
 * self-service fields (phone, display currency).
 */
export function ProfileSection() {
  const profile = useProfile()
  const config = useConfig()
  const [editing, setEditing] = useState(false)

  if (profile.isLoading) {
    return (
      <div className="flex items-center gap-[14px] rounded-[16px] border border-border bg-card px-5 py-[18px]">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-1.5 h-3 w-40" />
        </div>
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>
    )
  }

  if (profile.isError || !profile.data) {
    return (
      <div className="rounded-[16px] border border-danger/20 bg-danger/5 px-5 py-[18px]">
        <p className="text-sm font-semibold text-danger">
          Could not load your profile.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Please refresh the page.
        </p>
      </div>
    )
  }

  const { data } = profile
  return (
    <div className="flex items-center gap-[14px] rounded-[16px] border border-border bg-card px-5 py-[18px]">
      <AvatarPlaceholder size={48} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-bold text-foreground">
          {data.fullName ?? data.email}
        </p>
        {data.phone ? (
          <p className="text-[13px] text-muted-foreground tabular-nums">
            {data.phone}
          </p>
        ) : data.fullName ? (
          <p className="truncate text-[13px] text-muted-foreground">
            {data.email}
          </p>
        ) : null}
      </div>
      <span className="rounded-full bg-success-muted px-3 py-1.5 text-xs font-bold text-success">
        {data.kycStatus === "verified" ? "Verified" : data.kycStatus} ·{" "}
        {tierLabel(data.kycTier)}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Edit profile"
        onClick={() => setEditing(true)}
      >
        <PencilIcon aria-hidden="true" />
      </Button>
      <EditProfileDialog
        open={editing}
        onOpenChange={setEditing}
        profile={data}
        fiats={config.data?.fiats ?? []}
      />
    </div>
  )
}
