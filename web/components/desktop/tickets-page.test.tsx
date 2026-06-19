import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { TicketsPage } from "./tickets-page"

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe("TicketsPage", () => {
  it("renders the page headline", () => {
    render(<TicketsPage onQuickAction={() => {}} />, { wrapper })
    expect(screen.getByText(/Your tickets/i)).toBeInTheDocument()
  })

  it("renders the static confirmed ticket card", () => {
    render(<TicketsPage onQuickAction={() => {}} />, { wrapper })
    expect(screen.getByText(/Afrobeats Live 2026/i)).toBeInTheDocument()
    expect(screen.getByText(/Confirmed/i)).toBeInTheDocument()
    expect(screen.getByText(/AFL-26-7741/)).toBeInTheDocument()
    expect(screen.getByText(/Gate B/i)).toBeInTheDocument()
  })

  it("shows loading skeleton for events list", () => {
    render(<TicketsPage onQuickAction={() => {}} />, { wrapper })
    const skeletons = document.querySelectorAll("[data-slot='skeleton']")
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it("renders Browse events list after data loads", async () => {
    render(<TicketsPage onQuickAction={() => {}} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/Burna Boy/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Browse events/i)).toBeInTheDocument()
  })

  it("fires onQuickAction with 'ticket' action when Get ticket is clicked", async () => {
    const onQuickAction = vi.fn()
    const user = userEvent.setup()
    render(<TicketsPage onQuickAction={onQuickAction} />, { wrapper })
    await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: /Get ticket/i })
      expect(btns.length).toBeGreaterThan(0)
    })
    const btns = screen.getAllByRole("button", { name: /Get ticket/i })
    await user.click(btns[0])
    expect(onQuickAction).toHaveBeenCalledWith(
      "ticket",
      expect.stringMatching(/Get me a ticket to/)
    )
  })
})
