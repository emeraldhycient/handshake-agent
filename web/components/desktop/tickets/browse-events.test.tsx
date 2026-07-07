import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { BrowseEvents } from "./browse-events"
import { EventRow } from "./event-row"
import { ConfirmedTicketCard } from "./confirmed-ticket-card"
import type { EventListItem } from "@/lib/schemas"

const events: EventListItem[] = [
  { name: "Burna Boy Live", meta: "Lagos · Dec 2026", price: "₦20,000" },
]

describe("ConfirmedTicketCard", () => {
  it("renders the confirmed ticket details", () => {
    render(<ConfirmedTicketCard />)
    expect(screen.getByText(/Confirmed/i)).toBeInTheDocument()
    expect(screen.getByText(/Afrobeats Live 2026/i)).toBeInTheDocument()
    expect(screen.getByText(/AFL-26-7741/)).toBeInTheDocument()
  })
})

describe("EventRow", () => {
  it("fires onQuickAction('ticket', …) naming the event", async () => {
    const onQuickAction = vi.fn()
    const user = userEvent.setup()
    render(<EventRow event={events[0]} idx={0} onQuickAction={onQuickAction} />)
    await user.click(screen.getByRole("button", { name: /Get ticket/i }))
    expect(onQuickAction).toHaveBeenCalledWith(
      "ticket",
      "Get me a ticket to Burna Boy Live"
    )
  })
})

describe("BrowseEvents", () => {
  const base = {
    events,
    isLoading: false,
    isError: false,
    onQuickAction: () => {},
  }

  it("renders the headline and an event row", () => {
    render(<BrowseEvents {...base} />)
    expect(screen.getByText(/Browse events/i)).toBeInTheDocument()
    expect(screen.getByText(/Burna Boy Live/i)).toBeInTheDocument()
  })

  it("shows the empty message when there are no events", () => {
    render(<BrowseEvents {...base} events={[]} />)
    expect(screen.getByText(/No events available/i)).toBeInTheDocument()
  })

  it("shows the error state", () => {
    render(<BrowseEvents {...base} isError />)
    expect(screen.getByText(/Failed to load events/i)).toBeInTheDocument()
  })
})
