/**
 * TicketsPage test (design §6.21).
 *
 * This screen is a pure design reproduction (no TanStack Query) — it renders the
 * design's own representative sample content from module-level constants. Per the
 * design markup (`docs/design-ref/screens/Ticketing.html`) the recent-order rows are
 * PURE READ-ONLY DISPLAY: plain mono text, no `<button>`, no navigation. The tests
 * assert that:
 *
 *  1. The Vendor ports and Recent orders content renders.
 *  2. Order rows carry the mono ticket id as plain text and are NOT interactive
 *     (no button/link, so no navigation to a non-existent transaction route).
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { TicketsPage } from "@/components/admin/tickets-page"

describe("TicketsPage", () => {
  it("renders vendor ports and recent orders content", () => {
    render(<TicketsPage />)

    expect(screen.getByText("Vendor ports")).toBeInTheDocument()
    expect(screen.getByText("ticketing.eventbrite")).toBeInTheDocument()

    expect(screen.getByText("Recent orders")).toBeInTheDocument()
    expect(screen.getByText("Afrobeats Live · Lagos")).toBeInTheDocument()
    expect(screen.getByText("Amara Okeke")).toBeInTheDocument()
  })

  it("renders order ids as read-only plain text — no interactive row", () => {
    render(<TicketsPage />)

    // The ticket id is shown as plain mono text, not a control label.
    const id = screen.getByText("tkt_80231")
    expect(id.tagName).not.toBe("BUTTON")
    expect(id.tagName).not.toBe("A")

    // No order row is a button or link (rows are pure display), so nothing here
    // can navigate to a (non-existent) /transactions/tkt_* route.
    expect(screen.queryAllByRole("button")).toHaveLength(0)
    expect(screen.queryAllByRole("link")).toHaveLength(0)
  })
})
