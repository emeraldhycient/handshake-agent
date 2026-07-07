"use client"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { STATUS_VARIANT } from "@/constants/webhooks"
import { formatDate, truncateId } from "@/lib/webhooks/format"
import type { WebhookQueueProps } from "@/types/components"

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-11 w-full rounded-[10px]" />
      <Skeleton className="h-11 w-full rounded-[10px]" />
      <Skeleton className="h-11 w-full rounded-[10px]" />
    </div>
  )
}

function ErrorRows({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-[16px] border border-sdn bg-sdn/40 p-5 text-center">
      <p className="text-sm font-bold text-tdn">Failed to load webhooks</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 cursor-pointer rounded-[9px] border border-line bg-card px-[14px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Retry
      </button>
    </div>
  )
}

function EmptyRows() {
  return (
    <div className="rounded-[16px] border border-line bg-card px-5 py-8 text-center">
      <p className="text-sm font-bold text-ink">No webhooks</p>
      <p className="mt-1 text-[12.5px] text-ink2">
        Inbound provider webhooks matching your filters will appear here.
      </p>
    </div>
  )
}

/** The webhook queue — the four async branches over the Provider/Event/Status/Attempts/Received table. */
export function WebhookQueue({
  items,
  isLoading,
  isError,
  isSuccess,
  onRetry,
  onView,
}: WebhookQueueProps) {
  if (isLoading) return <LoadingRows />
  if (isError) return <ErrorRows onRetry={onRetry} />
  if (isSuccess && items.length === 0) return <EmptyRows />
  if (!isSuccess) return null

  return (
    <div className="overflow-hidden rounded-[16px] border border-line bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Provider</TableHead>
            <TableHead>Event ID</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead>Received</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-semibold text-ink">
                {item.provider}
              </TableCell>
              <TableCell className="font-mono text-ink2">
                {truncateId(item.providerEventId)}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[item.status]}>
                  {item.status}
                </Badge>
              </TableCell>
              <TableCell className="text-ink tabular-nums">
                {item.attempts}
              </TableCell>
              <TableCell className="text-ink2 tabular-nums">
                {formatDate(item.receivedAt)}
              </TableCell>
              <TableCell className="text-right">
                <button
                  type="button"
                  onClick={() => onView(item.id)}
                  className="cursor-pointer rounded-[9px] border border-line px-[13px] py-1.5 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  View
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
