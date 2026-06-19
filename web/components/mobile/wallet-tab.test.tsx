import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { WalletTab } from "./wallet-tab"

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return Wrapper
}

describe("WalletTab", () => {
  it("shows balance total after data loads", async () => {
    render(<WalletTab onQuickAction={() => {}} />, { wrapper: makeWrapper() })
    await waitFor(
      () => expect(screen.getByText("≈ ₦72,340")).toBeInTheDocument(),
      { timeout: 3000 }
    )
  })

  it("shows asset names after data loads", async () => {
    render(<WalletTab onQuickAction={() => {}} />, { wrapper: makeWrapper() })
    await waitFor(
      () => expect(screen.getByText("Tether USD")).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByText("Bitcoin")).toBeInTheDocument()
  })

  it("shows all four quick action buttons", async () => {
    render(<WalletTab onQuickAction={() => {}} />, { wrapper: makeWrapper() })
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: /buy/i })
        ).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /receive/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /swap/i })).toBeInTheDocument()
  })

  it("fires onQuickAction('buy', chipLabel('buy')) when Buy is clicked", async () => {
    const user = userEvent.setup()
    const onQuickAction = vi.fn()
    render(<WalletTab onQuickAction={onQuickAction} />, {
      wrapper: makeWrapper(),
    })
    const buyBtn = await screen.findByRole(
      "button",
      { name: /buy/i },
      { timeout: 3000 }
    )
    await user.click(buyBtn)
    expect(onQuickAction).toHaveBeenCalledWith("buy", expect.any(String))
  })

  it("fires onQuickAction('send', ...) when Send is clicked", async () => {
    const user = userEvent.setup()
    const onQuickAction = vi.fn()
    render(<WalletTab onQuickAction={onQuickAction} />, {
      wrapper: makeWrapper(),
    })
    const sendBtn = await screen.findByRole(
      "button",
      { name: /send/i },
      { timeout: 3000 }
    )
    await user.click(sendBtn)
    expect(onQuickAction).toHaveBeenCalledWith("send", expect.any(String))
  })
})
