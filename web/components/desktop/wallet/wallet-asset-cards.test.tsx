import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { WalletAssetCards } from "./wallet-asset-cards"
import type { WalletAsset } from "@/lib/schemas"

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
    sym: "NGN",
    name: "Naira",
    sub: "NGN balance",
    amount: "₦1,000",
    value: "₦1,000",
    change: "—",
    tint: "#0a0",
  } as WalletAsset,
]

describe("WalletAssetCards", () => {
  it("renders a card per asset with name, sub and value", () => {
    render(<WalletAssetCards assets={assets} />)
    expect(screen.getByText("Tether USD")).toBeInTheDocument()
    expect(screen.getByText("Naira")).toBeInTheDocument()
    expect(screen.getByText("₦80,000")).toBeInTheDocument()
  })

  it("shows the crypto amount and no placeholder 24h change", () => {
    render(<WalletAssetCards assets={assets} />)
    expect(screen.getByText("50 USDT")).toBeInTheDocument()
    expect(screen.queryByText("+0.1%")).not.toBeInTheDocument()
  })
})
