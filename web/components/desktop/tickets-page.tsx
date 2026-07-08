"use client"

import { ConfirmedTicketCard } from "@/components/desktop/tickets/confirmed-ticket-card"
import { BrowseEvents } from "@/components/desktop/tickets/browse-events"
import { useEvents } from "@/lib/query/hooks"
import { cn } from "@/lib/utils"
import type { PageWithQuickActionProps } from "@/types/components"

/**
 * Desktop tickets page — orchestrator. Composes the confirmed-ticket showcase and
 * the browse-events list (which owns its own four async branches); root §16.
 */
export function TicketsPage({
  onQuickAction,
  className,
}: PageWithQuickActionProps) {
  const events = useEvents()

  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-4 overflow-y-auto p-6",
        className
      )}
    >
      <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
        Your tickets
      </h1>

      <ConfirmedTicketCard />

      <BrowseEvents
        events={events.data ?? []}
        isLoading={events.isLoading}
        isError={events.isError}
        onQuickAction={onQuickAction}
      />
    </div>
  )
}
