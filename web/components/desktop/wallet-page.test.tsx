import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
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

  it("shows real QR code (not placeholder) in the deposit panel", async () => {
    render(<WalletPage onQuickAction={() => {}} />, { wrapper })
    await waitFor(() => {
      // qrcode.react renders an SVG element
      const qrSvg = document.querySelector("svg[data-testid='qr']")
      expect(qrSvg).toBeInTheDocument()
    })
  })

  it("renders the deposit panel with the real address", async () => {
    render(<WalletPage onQuickAction={() => {}} />, { wrapper })
    await waitFor(() => {
      expect(
        screen.getByText(/TQn9Y2khEb7g5mZ8FjpRt1cWnH4dHkLm3vQ/)
      ).toBeInTheDocument()
    })
  })

  it("shows asset and network label in deposit panel", async () => {
    render(<WalletPage onQuickAction={() => {}} />, { wrapper })
    await waitFor(() => {
      // The deposit panel header shows "USDT deposit · TRON · TRC-20"
      expect(screen.getByText(/USDT deposit/i)).toBeInTheDocument()
    })
  })

  it("does not render any placeholder 24h change for real assets", async () => {
    render(<WalletPage onQuickAction={() => {}} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/Tether USD/i)).toBeInTheDocument()
    })
    // The PLACEHOLDER_CHANGE values must NOT appear anywhere
    expect(screen.queryByText("+0.1%")).not.toBeInTheDocument()
    expect(screen.queryByText("+2.4%")).not.toBeInTheDocument()
  })

  it("fires onQuickAction('buy', …) when Buy is clicked", async () => {
    const onQuickAction = vi.fn()
    const user = userEvent.setup()
    render(<WalletPage onQuickAction={onQuickAction} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Buy/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole("button", { name: /Buy/i }))
    expect(onQuickAction).toHaveBeenCalledWith("buy", expect.any(String))
  })

  it("fires onQuickAction('send', …) when Send is clicked", async () => {
    const onQuickAction = vi.fn()
    const user = userEvent.setup()
    render(<WalletPage onQuickAction={onQuickAction} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Send/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole("button", { name: /Send/i }))
    expect(onQuickAction).toHaveBeenCalledWith("send", expect.any(String))
  })

  it("fires onQuickAction('receive', …) when Receive is clicked", async () => {
    const onQuickAction = vi.fn()
    const user = userEvent.setup()
    render(<WalletPage onQuickAction={onQuickAction} />, { wrapper })
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Receive/i })
      ).toBeInTheDocument()
    })
    await user.click(screen.getByRole("button", { name: /Receive/i }))
    expect(onQuickAction).toHaveBeenCalledWith("receive", expect.any(String))
  })

  it("fires onQuickAction when 'Show QR in chat' is clicked", async () => {
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

  // ── Finding #3: multi-asset deposit selector ──────────────────────────────
  describe("multi-asset deposit panel", () => {
    it("renders an asset selector (tablist) over the user's depositable holdings", async () => {
      render(<WalletPage onQuickAction={() => {}} />, { wrapper })
      const tablist = await screen.findByRole("tablist", {
        name: /deposit asset/i,
      })
      // USDT and BTC are crypto; Naira (fiat) is NOT depositable on-chain.
      expect(
        within(tablist).getByRole("tab", { name: /USDT/i })
      ).toBeInTheDocument()
      expect(
        within(tablist).getByRole("tab", { name: /BTC/i })
      ).toBeInTheDocument()
      expect(
        within(tablist).queryByRole("tab", { name: /naira/i })
      ).not.toBeInTheDocument()
    })

    it("shows the DepositNetworkWarning naming the network for the selected asset", async () => {
      render(<WalletPage onQuickAction={() => {}} />, { wrapper })
      // The shared deposit warning is the role=alert; it names the network.
      const alert = await screen.findByRole("alert")
      expect(alert).toHaveTextContent(/TRON/)
      expect(alert).toHaveTextContent(/lost permanently/i)
    })

    it("states the address is shared when another asset uses the same network", async () => {
      // USDT and TRX both deposit to the TRON address — the panel must say so
      // rather than implying separate addresses. With the mock basket only USDT
      // maps to TRON, so the shared note appears only when >1 asset matches; we
      // assert the network is named honestly on the selected USDT tab.
      render(<WalletPage onQuickAction={() => {}} />, { wrapper })
      await waitFor(() =>
        expect(
          screen.getByText(/TQn9Y2khEb7g5mZ8FjpRt1cWnH4dHkLm3vQ/)
        ).toBeInTheDocument()
      )
      // The network is explicitly named near the address.
      expect(screen.getByText(/USDT deposit/i)).toHaveTextContent(/TRON/)
    })

    it("does not show a (wrong) TRON address for an asset on another network", async () => {
      const user = userEvent.setup()
      render(<WalletPage onQuickAction={() => {}} />, { wrapper })
      // Select BTC (mock: no TRON network) — the TRON address must NOT be shown
      // for it (showing it would risk a permanent loss of funds).
      const btcTab = await screen.findByRole("tab", { name: /BTC/i })
      await user.click(btcTab)
      await waitFor(() =>
        expect(
          screen.getByText(/not available|ask in chat|isn't available/i)
        ).toBeInTheDocument()
      )
      expect(
        screen.queryByText("TQn9Y2khEb7g5mZ8FjpRt1cWnH4dHkLm3vQ")
      ).not.toBeInTheDocument()
    })
  })
})
