import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, afterEach } from "vitest"
import { WalletTab } from "./wallet-tab"

// ─── Per-test mock control for the error-branch tests ────────────────────────
// We import the gateway module so vitest can spy/override specific methods.
import * as gatewayModule from "@/lib/api/gateway"

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return Wrapper
}

afterEach(() => {
  vi.restoreAllMocks()
})

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

  // ── §13.6 four-branch coverage ────────────────────────────────────────────

  it("loading branch: renders skeleton before data resolves", () => {
    // The mock gateway resolves async; on synchronous render the component
    // is in the loading state and renders Skeleton elements.
    render(<WalletTab onQuickAction={() => {}} />, { wrapper: makeWrapper() })
    // The balance text is NOT yet present (data hasn't resolved)
    expect(screen.queryByText("≈ ₦72,340")).not.toBeInTheDocument()
    // The component itself is rendered — skeletons are shown (not null / error)
    // Skeleton divs have role="none" by default; assert the loading container is present.
    const container = document.querySelector(
      ".flex.flex-1.flex-col.bg-background"
    )
    expect(container).not.toBeNull()
  })

  it("error branch: renders error message when queries fail", async () => {
    // Spy on gateway to make getBalances and getWalletAssets reject
    vi.spyOn(gatewayModule.gateway, "getBalances").mockRejectedValue(
      new Error("Network error")
    )
    vi.spyOn(gatewayModule.gateway, "getWalletAssets").mockRejectedValue(
      new Error("Network error")
    )

    render(<WalletTab onQuickAction={() => {}} />, { wrapper: makeWrapper() })
    await waitFor(
      () =>
        expect(screen.getByText("Could not load wallet")).toBeInTheDocument(),
      { timeout: 3000 }
    )
  })
})
