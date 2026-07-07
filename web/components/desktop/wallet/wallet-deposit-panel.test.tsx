import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { WalletDepositPanel } from "./wallet-deposit-panel"
import type { WalletAsset, DepositView } from "@/lib/schemas"

const assets: WalletAsset[] = [
  {
    sym: "USDT",
    name: "Tether USD",
    sub: "USDT · TRON",
    amount: "50 USDT",
    value: "₦80,000",
    change: "—",
    tint: "#26A17B",
  } as WalletAsset,
  {
    sym: "BTC",
    name: "Bitcoin",
    sub: "BTC · Bitcoin",
    amount: "0.01 BTC",
    value: "—",
    change: "—",
    tint: "#f7931a",
  } as WalletAsset,
  {
    sym: "NGN",
    name: "Naira",
    sub: "NGN balance",
    amount: "₦1,000",
    value: "₦1,000",
    change: "—",
    tint: "#0a0",
  } as WalletAsset,
]
const deposit = {
  address: "TQn9Y2khEb7g5mZ8FjpRt1cWnH4dHkLm3vQ",
  network: "TRON · TRC-20",
} as DepositView

const base = {
  assets,
  depositData: deposit,
  depositLoading: false,
  depositError: false,
  onQuickAction: () => {},
}

describe("WalletDepositPanel", () => {
  it("renders a tablist of depositable (crypto-only) assets", async () => {
    render(<WalletDepositPanel {...base} />)
    const tablist = await screen.findByRole("tablist", {
      name: /deposit asset/i,
    })
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

  it("shows the address and network warning for the matching-network asset", async () => {
    render(<WalletDepositPanel {...base} />)
    expect(await screen.findByText(deposit.address)).toBeInTheDocument()
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent(/TRON/)
    expect(alert).toHaveTextContent(/lost permanently/i)
  })

  it("hides the (wrong-network) address when a non-matching asset is selected", async () => {
    const user = userEvent.setup()
    render(<WalletDepositPanel {...base} />)
    await user.click(await screen.findByRole("tab", { name: /BTC/i }))
    await waitFor(() =>
      expect(
        screen.getByText(/isn't available|not available|ask in chat/i)
      ).toBeInTheDocument()
    )
    expect(screen.queryByText(deposit.address)).not.toBeInTheDocument()
  })

  it("fires onQuickAction('receive', …) from the CTA", async () => {
    const onQuickAction = vi.fn()
    const user = userEvent.setup()
    render(<WalletDepositPanel {...base} onQuickAction={onQuickAction} />)
    await user.click(
      await screen.findByRole("button", { name: /Show QR in chat/i })
    )
    expect(onQuickAction).toHaveBeenCalledWith("receive", expect.any(String))
  })
})
