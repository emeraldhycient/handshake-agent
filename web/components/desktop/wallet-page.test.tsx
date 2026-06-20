import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { WalletPage } from "./wallet-page"

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe("WalletPage", () => {
  it("shows loading skeletons initially", () => {
    render(<WalletPage onQuickAction={() => {}} />, { wrapper })
    const skeletons = document.querySelectorAll("[data-slot='skeleton']")
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it("renders asset cards grid after data loads", async () => {
    render(<WalletPage onQuickAction={() => {}} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/Tether USD/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Bitcoin/i)).toBeInTheDocument()
    expect(screen.getByText(/Naira/i)).toBeInTheDocument()
  })

  it("renders the deposit panel with USDT address", async () => {
    render(<WalletPage onQuickAction={() => {}} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/USDT deposit/i)).toBeInTheDocument()
    })
    expect(
      screen.getByText(/TQn9Y2khEb7g5mZ8FjpRt1cWnH4dHkLm3vQ/)
    ).toBeInTheDocument()
  })

  it("fires onQuickAction('receive', …) when 'Show QR in chat' is clicked", async () => {
    const onQuickAction = vi.fn()
    const user = userEvent.setup()
    render(<WalletPage onQuickAction={onQuickAction} />, { wrapper })
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Show QR in chat/i })
      ).toBeInTheDocument()
    })
    await user.click(screen.getByRole("button", { name: /Show QR in chat/i }))
    expect(onQuickAction).toHaveBeenCalledWith(
      "receive",
      "Show my deposit address"
    )
  })
})
