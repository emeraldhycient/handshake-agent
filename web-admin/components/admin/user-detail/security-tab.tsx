import { Skeleton } from "@/components/ui/skeleton"
import { Panel } from "@/components/admin/user-detail/panel"
import type { UdSecurityTabProps } from "@/types/components"

/**
 * The Security tab — PIN & authentication (the reset-directive is step-up-gated;
 * lockout/2FA state is a documented backend-enrichment gap) and the user's active +
 * recent auth sessions with a per-row and revoke-all control. Four async branches.
 */
export function SecurityTab({
  sessions,
  onResetPin,
  onRevokeAll,
  onRevokeSession,
  onRetry,
}: UdSecurityTabProps) {
  return (
    <div className="grid grid-cols-2 items-start gap-3.5">
      <Panel>
        <div className="mb-3 text-[13px] font-extrabold">
          PIN & authentication
        </div>
        {/* PIN-set time / lockout counts / 2FA state are not projected by any
            read endpoint yet (see shapeGaps) — the reset directive below is
            the live action; the status rows stay a documented gap. */}
        <div className="py-4 text-center text-[12px] text-ink3">
          PIN status, lockout counters, and 2FA state are not yet surfaced in
          this view.
        </div>
        <button
          type="button"
          onClick={onResetPin}
          className="mt-3.5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[11px] border border-line p-[11px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d="M4 12a8 8 0 1 1 2.3 5.6M4 20v-4h4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Reset PIN directive · step-up
        </button>
      </Panel>
      <Panel>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[13px] font-extrabold">Active sessions</div>
          <button
            type="button"
            onClick={onRevokeAll}
            className="cursor-pointer text-xs font-bold text-tdn focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Revoke all
          </button>
        </div>
        {sessions.isLoading && (
          <div className="space-y-3 py-2" aria-busy="true">
            <Skeleton className="h-9 rounded-lg" />
            <Skeleton className="h-9 rounded-lg" />
          </div>
        )}
        {sessions.isError && (
          <div className="flex items-center justify-between gap-3 py-4">
            <span className="text-[12px] font-bold text-tdn">
              Failed to load sessions.
            </span>
            <button
              type="button"
              onClick={onRetry}
              className="cursor-pointer rounded-[9px] border border-line px-3 py-1.5 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}
        {sessions.isSuccess && sessions.data.length === 0 && (
          <div className="py-6 text-center text-[12px] text-ink3">
            No active or recent sessions.
          </div>
        )}
        {sessions.data?.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-[11px] border-b border-line2 py-2.5"
          >
            <span
              className="size-2 flex-none rounded-full"
              style={{ background: s.isActive ? "#1f8a5b" : "#8b948a" }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold">
                {s.userAgent ?? s.channel}
                {!s.isActive && (
                  <span className="ml-1.5 text-[10.5px] font-bold text-ink3">
                    · ended
                  </span>
                )}
              </div>
              <div className="truncate font-mono text-[11px] text-ink3">
                {(s.ipAddress ?? "—") +
                  " · " +
                  (s.lastActivityAt ?? s.issuedAt)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onRevokeSession(s.id)}
              disabled={!s.isActive}
              className="cursor-pointer text-[11.5px] font-bold text-ink2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default disabled:opacity-40"
            >
              Revoke
            </button>
          </div>
        ))}
      </Panel>
    </div>
  )
}
