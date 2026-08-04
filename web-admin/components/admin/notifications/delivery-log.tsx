"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { useDeliveryLog } from "@/lib/query/hooks"
import {
  CHANNEL_CLASS,
  CHANNEL_LABEL,
  STATUS_CLASS,
  STATUS_LABEL,
} from "@/constants/notifications"
import { eventLabel, pct, relativeTime } from "@/lib/notifications/format"
import type { DeliveryRowProps } from "@/types"

/** A single delivery-log row: channel chip + template name + event·time + status pill. */
function DeliveryRow({ entry }: DeliveryRowProps) {
  const channel = CHANNEL_LABEL[entry.channel]
  const status = STATUS_LABEL[entry.status]
  // A plain-fallback notification (no template) renders its event as the name.
  const name = entry.templateKey ?? eventLabel(entry.eventType)
  return (
    <div className="flex items-center gap-[11px] border-b border-line2 px-[18px] py-3 last:border-b-0">
      <span
        className={`flex-none rounded-md px-2 py-[2px] text-[10.5px] font-bold ${CHANNEL_CLASS[channel]}`}
      >
        {channel}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold text-ink">
          {name}
        </div>
        <div className="text-[10.5px] text-ink3">
          {eventLabel(entry.eventType)} · {relativeTime(entry.createdAt)}
        </div>
      </div>
      <span
        className={`rounded-full px-[9px] py-[2px] text-[10.5px] font-bold ${STATUS_CLASS[status]}`}
      >
        {status}
      </span>
    </div>
  )
}

/** Skeleton rows for the delivery-log loading branch (matches the row rhythm). */
function DeliveryRowsSkeleton() {
  return (
    <div aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-[11px] border-b border-line2 px-[18px] py-3 last:border-b-0"
        >
          <Skeleton className="h-4 w-16 rounded-md" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-1.5 h-2.5 w-24" />
          </div>
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

/**
 * The read-only delivery log — wired to `useDeliveryLog()`. Header carries the real
 * bounce/complaint footnote (aggregate dispatch stats); four async branches
 * (loading / error / empty / data).
 */
export function DeliveryLog() {
  const { data, isLoading, isError, refetch } = useDeliveryLog()

  const footnote = data
    ? `bounce ${pct(data.stats.bounceRate)} · complaint ${pct(
        data.stats.complaintRate
      )} (Resend + WhatsApp)`
    : "bounce / complaint (Resend + WhatsApp)"

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="flex items-center gap-2.5 border-b border-line px-[18px] py-3.5">
        <div className="flex-1 text-[13px] font-extrabold text-ink">
          Delivery log
        </div>
        <span className="text-[11px] text-ink3">{footnote}</span>
      </div>

      {isLoading && <DeliveryRowsSkeleton />}

      {isError && (
        <div className="m-[18px] rounded-[9px] border border-sdn bg-sdn/40 px-3 py-[11px] text-center">
          <p className="text-[12px] font-bold text-tdn">
            Couldn&apos;t load the delivery log
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-1 cursor-pointer rounded-md px-1 text-[11.5px] font-bold text-tif hover:bg-hov focus-visible:outline focus-visible:outline-2 focus-visible:outline-tif"
          >
            Retry
          </button>
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="px-[18px] py-10 text-center">
          <p className="text-[13px] font-bold text-ink">No deliveries yet</p>
          <p className="mt-1 text-[12px] text-ink2">
            Notifications sent to customers will appear here.
          </p>
        </div>
      )}

      {data &&
        data.items.length > 0 &&
        data.items.map((entry) => <DeliveryRow key={entry.id} entry={entry} />)}
    </div>
  )
}
