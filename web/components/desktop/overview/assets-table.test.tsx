import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AssetsTable } from "./assets-table"
import type { WalletAsset } from "@/lib/schemas"

const assets: WalletAsset[] = [
  {
    sym: "USDT",
    name: "Tether USD",
    sub: "TRC-20",
    amount: "50 USDT",
    value: "₦80,000",
    change: "+0.01%",
    tint: "#26A17B",
  } as WalletAsset,
]

describe("AssetsTable", () => {
  it("renders a named table with Asset/Holdings/Value headers", () => {
    render(<AssetsTable assets={assets} />)
    const table = screen.getByRole("table", { name: "Assets" })
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent)
    ).toEqual(["Asset", "Holdings", "Value"])
  })

  it("renders one row per asset with its name and value", () => {
    render(<AssetsTable assets={assets} />)
    const table = screen.getByRole("table", { name: "Assets" })
    expect(within(table).getByText("Tether USD")).toBeInTheDocument()
    expect(within(table).getByText("₦80,000")).toBeInTheDocument()
    // header row + 1 asset row
    expect(within(table).getAllByRole("row")).toHaveLength(2)
  })

  it("does not advertise Price or 24h columns it cannot fill", () => {
    render(<AssetsTable assets={assets} />)
    expect(screen.queryByText("Price")).not.toBeInTheDocument()
    expect(screen.queryByText("24h")).not.toBeInTheDocument()
  })
})
