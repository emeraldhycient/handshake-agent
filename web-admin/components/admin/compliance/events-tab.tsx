"use client"

import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { useComplianceEvents } from "@/lib/query/hooks"
import {
  ErrorPanel,
  LoadingRows,
  TableCard,
  EmptyNote,
} from "@/components/admin/compliance/compliance-shells"
import { SEVERITY_VARIANT } from "@/constants/compliance"
import { formatDate } from "@/lib/compliance/format"
import type { EventsTabProps } from "@/types"

/** Events tab — the flagged-event queue; a row opens the disposition drawer. */
export function EventsTab({ onOpen }: EventsTabProps) {
  const events = useComplianceEvents({})

  if (events.isLoading) return <LoadingRows />
  if (events.isError) return <ErrorPanel what="compliance events" />
  if (events.isSuccess && events.data.items.length === 0) {
    return <EmptyNote>No flagged events.</EmptyNote>
  }
  if (!events.isSuccess) return null

  return (
    <TableCard>
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.data.items.map((event) => (
          <TableRow
            key={event.id}
            role="button"
            tabIndex={0}
            aria-label={`Review event ${event.eventType}`}
            className="cursor-pointer focus-visible:bg-hov focus-visible:outline-none"
            onClick={() => onOpen(event.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onOpen(event.id)
              }
            }}
          >
            <TableCell className="font-semibold text-ink">
              {event.eventType}
            </TableCell>
            <TableCell>
              <Badge variant={SEVERITY_VARIANT[event.severity]}>
                {event.severity}
              </Badge>
            </TableCell>
            <TableCell className="text-ink2">{event.status}</TableCell>
            <TableCell className="text-ink2">
              {event.screeningProvider}
            </TableCell>
            <TableCell className="text-ink2 tabular-nums">
              {formatDate(event.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableCard>
  )
}
