/**
 * TreasuryPage test (design-reproduction build).
 *
 * The Treasury screen is a pixel-faithful reproduction of
 * `docs/design-ref/screens/Treasury.html` — it renders the design's own mock
 * content from module-level constants and does NOT fetch (no TanStack Query /
 * server). So these tests render the component bare and assert the design's static
 * structure: the custodial hero, the 4-up balance row, the low-float banner, the
 * payout approval queue, and the child-address sweeps + threshold.
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { TreasuryPage } from "@/components/admin/treasury-page"

describe("TreasuryPage (design reproduction)", () => {
  it("renders the header + low-float alert", () => {
    render(<TreasuryPage />)
    expect(
      screen.getByRole("heading", { name: "Treasury" })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/NGN float is at 18% of target/i)
    ).toBeInTheDocument()
  })

  it("renders the 4-up balance cards including the custodial hero", () => {
    render(<TreasuryPage />)
    expect(screen.getByText("Custodial · USDT")).toBeInTheDocument()
    expect(screen.getByText("412,908.44")).toBeInTheDocument()
    expect(
      screen.getByText(/12 wallets · Blockradar TRON/i)
    ).toBeInTheDocument()
    expect(screen.getByText("NGN fiat float")).toBeInTheDocument()
    expect(screen.getByText("FX position")).toBeInTheDocument()
    expect(screen.getByText("Exposure headroom")).toBeInTheDocument()
  })

  it("renders the payout approval queue with a maker-checker tag", () => {
    render(<TreasuryPage />)
    expect(
      screen.getByText("Payout / withdrawal approval queue")
    ).toBeInTheDocument()
    expect(screen.getByText("Kelechi Chukwu · GTBank")).toBeInTheDocument()
    // The large payout carries the amber maker-checker tag.
    expect(screen.getByText("Maker-checker")).toBeInTheDocument()
    // One Approve action per pending payout row (3 seeded rows).
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(3)
  })

  it("renders the child-address sweeps + 25 TRX threshold", () => {
    render(<TreasuryPage />)
    expect(screen.getByText("Child-address sweeps")).toBeInTheDocument()
    expect(screen.getByText("Swept")).toBeInTheDocument()
    expect(screen.getByText("Pending")).toBeInTheDocument()
    expect(screen.getByText("Below threshold")).toBeInTheDocument()
    expect(screen.getByText("Sweep threshold")).toBeInTheDocument()
    expect(screen.getByText("25 TRX")).toBeInTheDocument()
  })
})
