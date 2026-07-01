/**
 * TicketsPage (real-data wiring) tests — design §6.21.
 *
 * The "Recent orders" panel now reads the engine feed via `useTicketOrders` → the
 * mocked `@/lib/api/tickets` client; its rows come from `TicketOrderListResponse`.
 * These tests assert the loading→data branch, the empty branch, and the error branch,
 * plus that the order rows stay pure READ-ONLY display (no button/link — no navigation
 * to a non-existent transaction route). The "Vendor ports" panel is still design-mock
 * (no vendor-registry endpoint), so `ticketing.eventbrite` renders unconditionally.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { TicketOrderListResponse } from "@handshake-agent/contracts"

import { TicketsPage } from "@/components/admin/tickets-page"

vi.mock("@/lib/api/tickets", () => ({
  listTicketOrders: vi.fn(),
}))

import { listTicketOrders } from "@/lib/api/tickets"

const mockList = vi.mocked(listTicketOrders)

const UUID_A = "11111111-1111-1111-1111-111111111111"
const UUID_B = "22222222-2222-2222-2222-222222222222"

const RESPONSE: TicketOrderListResponse = {
  items: [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      userId: UUID_A,
      vendorKey: "ticketing.eventbrite",
      ticketType: "Afrobeats Live · Lagos",
      quantity: 2,
      totalAmount: "45000.00",
      paymentStatus: "captured",
      settlementStatus: "settled",
      deliveryStatus: "delivered",
      createdAt: "2026-07-01T09:42:00.000Z",
    },
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      userId: UUID_B,
      vendorKey: "ticketing.tix",
      ticketType: "Detty December Fest",
      quantity: 1,
      totalAmount: "120000.00",
      paymentStatus: "captured",
      settlementStatus: "pending",
      deliveryStatus: "pending",
      createdAt: "2026-07-01T10:15:00.000Z",
    },
  ],
  nextCursor: null,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TicketsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockList.mockReset()
  mockList.mockResolvedValue(RESPONSE)
})

describe("TicketsPage (real-data wiring)", () => {
  it("shows a loading state, then renders the real order rows", async () => {
    // Hold the request open so the loading (aria-busy) branch is observable.
    let resolve!: (v: TicketOrderListResponse) => void
    mockList.mockReturnValueOnce(
      new Promise<TicketOrderListResponse>((r) => {
        resolve = r
      })
    )

    renderPage()

    // Card headers + the still-mock Vendor ports panel are always present.
    expect(screen.getByText("Recent orders")).toBeInTheDocument()
    expect(screen.getByText("Vendor ports")).toBeInTheDocument()
    expect(screen.getByText("ticketing.eventbrite")).toBeInTheDocument()
    // Loading branch.
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()

    resolve(RESPONSE)

    // Data branch — the real ticketType line, formatted amount + mapped pill render.
    expect(
      await screen.findByText("Afrobeats Live · Lagos")
    ).toBeInTheDocument()
    expect(screen.getByText("₦45,000.00")).toBeInTheDocument()
    // settlementStatus "settled" → "Settled" pill; "pending" → "Pending".
    expect(screen.getByText("Settled")).toBeInTheDocument()
    expect(screen.getByText("Pending")).toBeInTheDocument()
  })

  it("renders order rows as read-only plain display — no interactive control", async () => {
    renderPage()

    await screen.findByText("Afrobeats Live · Lagos")

    // The ticket id is shown as plain mono text, not a control label.
    const id = screen.getByText("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    expect(id.tagName).not.toBe("BUTTON")
    expect(id.tagName).not.toBe("A")
    // No order row is a button or link (rows are pure display).
    expect(screen.queryAllByRole("link")).toHaveLength(0)
  })

  it("renders the design-consistent empty state when there are no orders", async () => {
    mockList.mockResolvedValue({ items: [], nextCursor: null })
    renderPage()

    expect(await screen.findByText("No ticket orders yet.")).toBeInTheDocument()
  })

  it("renders a tokened error with a retry affordance on failure", async () => {
    mockList.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(await screen.findByText("Couldn't load orders")).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
    )
  })
})
