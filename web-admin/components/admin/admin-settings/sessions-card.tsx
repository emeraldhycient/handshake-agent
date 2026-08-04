"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { useSessions } from "@/lib/query/hooks"
import { expiryLabel } from "@/lib/admin-settings/format"
import type { SessionRowProps } from "@/types"

/** One active-session row — device (UA), IP, and expiry. Metadata only. */
function SessionRow({ session }: SessionRowProps) {
  const stepUp = session.stepUpCompletedAt !== null
  return (
    <div className="flex items-center justify-between border-b border-line2 py-[12px] last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-bold text-ink">
          {session.userAgent ?? "Unknown device"}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-ink3 tabular-nums">
          {session.ipAddress ?? "—"} · expires {expiryLabel(session.expiresAt)}
        </div>
      </div>
      {stepUp && (
        <span className="ml-3 flex-none rounded-full bg-sok px-[9px] py-[2px] text-[10.5px] font-bold text-tok">
          Stepped up
        </span>
      )}
    </div>
  )
}

/**
 * Active-sessions card — the operator's own console sessions (`useSessions`).
 * Metadata only; the token hash is never surfaced. Read-only here — revoking a
 * session is a later phase. Four branches (loading / error / empty / data).
 */
export function SessionsCard() {
  const query = useSessions()
  const sessions = query.data?.items ?? []

  return (
    <div className="mt-[14px] rounded-[16px] border border-line bg-card p-[18px_20px]">
      <div className="mb-[6px] text-[13px] font-extrabold text-ink">
        Active sessions
      </div>

      {query.isLoading && (
        <div className="flex flex-col gap-2 py-1" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {query.isError && (
        <div className="py-6 text-center">
          <div className="text-[13px] font-bold text-tdn">
            Couldn&apos;t load your sessions
          </div>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="mt-2 text-[12.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Try again
          </button>
        </div>
      )}

      {query.isSuccess && sessions.length === 0 && (
        <p className="py-4 text-[12.5px] text-ink3">No active sessions.</p>
      )}

      {query.isSuccess &&
        sessions.map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}
    </div>
  )
}
