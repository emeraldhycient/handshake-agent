import { Skeleton } from "@/components/ui/skeleton"
import { NOT_PROVIDED } from "@/constants/user-detail"
import type { UdDevicesTabProps } from "@/types"

/**
 * The Devices tab — the user's bound/revoked devices with a per-row unbind and,
 * when a SIM-swap is flagged, a re-verify action (§3.4). Four async branches.
 * Identity = verified KYC + bound device + PIN — a phone number never authenticates.
 */
export function DevicesTab({
  devices,
  simSwapFlagged,
  onReverify,
  onUnbind,
  onRetry,
}: UdDevicesTabProps) {
  return (
    <div className="rounded-2xl border border-line bg-card p-[6px_20px]">
      {devices.isLoading && (
        <div className="space-y-3 py-4" aria-busy="true">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      )}
      {devices.isError && (
        <div className="flex items-center justify-between gap-3 py-6">
          <span className="text-[12.5px] font-bold text-tdn">
            Failed to load devices.
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="cursor-pointer rounded-[9px] border border-line px-[13px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}
      {devices.isSuccess && devices.data.length === 0 && (
        <div className="py-8 text-center text-[12.5px] text-ink3">
          No bound devices for this user.
        </div>
      )}
      {devices.data?.map((d) => (
        <div
          key={d.id}
          className="flex items-center gap-3.5 border-b border-line2 py-4"
        >
          <span className="flex size-[42px] flex-none items-center justify-center rounded-[11px] bg-card2 text-ink2">
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <rect
                x="6"
                y="2.5"
                width="12"
                height="19"
                rx="2.5"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="M10.5 18.5h3"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-2 text-[13.5px] font-bold capitalize">
              {d.trustState} device
              {d.isPinned && (
                <span className="rounded-full bg-sok px-2 py-[2px] text-[10px] font-bold text-tok">
                  Pinned
                </span>
              )}
            </div>
            <div className="font-mono text-[11.5px] text-ink3">
              {d.id} · last seen {d.lastUsedAt ?? NOT_PROVIDED}
            </div>
          </div>
          {simSwapFlagged && (
            <span className="rounded-full bg-sdn px-2.5 py-1 text-[10.5px] font-extrabold text-tdn">
              SIM-SWAP
            </span>
          )}
          {simSwapFlagged && (
            <button
              type="button"
              onClick={onReverify}
              className="cursor-pointer rounded-[9px] border border-[#f0d0cb] bg-sdn px-[13px] py-2 text-xs font-bold text-tdn transition-colors hover:bg-sdn/80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              SIM-swap re-verify
            </button>
          )}
          <button
            type="button"
            onClick={() => onUnbind(d.id)}
            className="cursor-pointer rounded-[9px] border border-line px-[13px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Unbind
          </button>
        </div>
      ))}
      <div className="flex items-center gap-[9px] py-3.5 text-xs text-ink3">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M7 11V8a5 5 0 0 1 10 0v3"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <rect
            x="5"
            y="11"
            width="14"
            height="9"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </svg>
        Identity = verified KYC + bound device + PIN. A phone number alone never
        authenticates a session.
      </div>
    </div>
  )
}
