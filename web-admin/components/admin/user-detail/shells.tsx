import type { ReactNode } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import type { UdErrorProps } from "@/types/components"

/** The user-detail page frame — centered max-width column with the design padding. */
export function UserDetailShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1200px] overflow-y-auto px-[30px] pt-[22px] pb-[60px]">
      {children}
    </div>
  )
}

/** The loading branch — the design frame filled with skeletons. */
export function UserDetailSkeleton() {
  return (
    <UserDetailShell>
      <Skeleton className="mb-3.5 h-4 w-24" />
      <div className="mb-3.5 rounded-[18px] border border-line bg-card p-[20px_22px]">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        </div>
      </div>
      <div className="mb-4 flex gap-3">
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-3.5">
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    </UserDetailShell>
  )
}

/** The error branch — a back-link + a retry affordance. */
export function UserDetailError({ onBack, onRetry }: UdErrorProps) {
  return (
    <UserDetailShell>
      <button
        type="button"
        onClick={onBack}
        className="mb-3.5 inline-flex cursor-pointer items-center gap-[7px] text-[12.5px] font-bold text-ink2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M14 6l-6 6 6 6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        All users
      </button>
      <div className="rounded-[18px] border border-sdn bg-sdn/40 p-6 text-center">
        <p className="text-sm font-bold text-tdn">Failed to load user</p>
        <p className="mt-1 text-[12.5px] text-ink2">
          The user aggregate could not be fetched.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3.5 cursor-pointer rounded-[10px] border border-line bg-card px-[15px] py-2 text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Retry
        </button>
      </div>
    </UserDetailShell>
  )
}
