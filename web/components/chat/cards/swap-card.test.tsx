import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi } from "vitest"
import { SwapCard } from "./swap-card"
import type { SwapCardProps } from "@/types"

const baseProps: SwapCardProps = {
  kind: "swap",
  fromAsset: "USDT",
  toAsset: "BTC",
  fromAmount: "100",
  toAmount: "0.00095",
  rate: "0.0000095",
  networkFee: "1",
  transactionFee: "0.5",
  estimatedArrivalSec: 120,
  lockSeconds: 58,
  expiresAt: undefined as unknown as string,
  density: "mobile",
  onConfirm: vi.fn(),
}

describe("SwapCard", () => {
  it("renders the fromAsset → toAsset header label", () => {
    render(<SwapCard {...baseProps} />)
    expect(screen.getByText("USDT → BTC")).toBeInTheDocument()
  })

  it("renders toAmount and toAsset as the receive amount", () => {
    render(<SwapCard {...baseProps} />)
    expect(screen.getByText("0.00095 BTC")).toBeInTheDocument()
  })

  it('renders "You receive" subtitle', () => {
    render(<SwapCard {...baseProps} />)
    expect(screen.getByText("You receive")).toBeInTheDocument()
  })

  it("renders rate row without a spread line", () => {
    render(<SwapCard {...baseProps} />)
    expect(screen.getByText("Rate")).toBeInTheDocument()
    expect(screen.getByText("1 USDT = 0.0000095 BTC")).toBeInTheDocument()
    // No spread/markup line item
    expect(screen.queryByText(/spread/i)).not.toBeInTheDocument()
  })

  it("renders network fee row with fromAsset denomination", () => {
    render(<SwapCard {...baseProps} />)
    expect(screen.getByText("Network fee")).toBeInTheDocument()
    expect(screen.getByText("1 USDT")).toBeInTheDocument()
  })

  it("renders transaction fee row with fromAsset denomination", () => {
    render(<SwapCard {...baseProps} />)
    expect(screen.getByText("Transaction fee")).toBeInTheDocument()
    expect(screen.getByText("0.5 USDT")).toBeInTheDocument()
  })

  it("renders estimated arrival row", () => {
    render(<SwapCard {...baseProps} />)
    expect(screen.getByText("Estimated arrival")).toBeInTheDocument()
    // 120 sec → "~2 min"
    expect(screen.getByText("~2 min")).toBeInTheDocument()
  })

  it("renders estimated arrival as seconds when under 60", () => {
    render(<SwapCard {...baseProps} estimatedArrivalSec={45} />)
    expect(screen.getByText("~45 sec")).toBeInTheDocument()
  })

  it("renders estimated arrival as 'instant' when 0", () => {
    render(<SwapCard {...baseProps} estimatedArrivalSec={0} />)
    expect(screen.getByText("instant")).toBeInTheDocument()
  })

  it("renders Total debit row with fromAmount and fromAsset", () => {
    render(<SwapCard {...baseProps} />)
    expect(screen.getByText("Total debit")).toBeInTheDocument()
    // fromAmount formatted value appears in the total area
    expect(screen.getAllByText("100 USDT").length).toBeGreaterThan(0)
  })

  it("renders lock countdown from lockSeconds=58 when no expiresAt", () => {
    render(<SwapCard {...baseProps} lockSeconds={58} />)
    expect(screen.getByText("Locked 0:58")).toBeInTheDocument()
  })

  it("renders at desktop density without crashing", () => {
    render(<SwapCard {...baseProps} density="desktop" />)
    expect(screen.getByText("USDT → BTC")).toBeInTheDocument()
  })

  it("calls onConfirm when Review & confirm button is clicked (mobile)", async () => {
    const onConfirm = vi.fn()
    render(<SwapCard {...baseProps} density="mobile" onConfirm={onConfirm} />)
    await userEvent.click(
      screen.getByRole("button", { name: /review & confirm/i })
    )
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it("calls onConfirm when Review & confirm button is clicked (desktop)", async () => {
    const onConfirm = vi.fn()
    render(<SwapCard {...baseProps} density="desktop" onConfirm={onConfirm} />)
    await userEvent.click(
      screen.getByRole("button", { name: /review & confirm/i })
    )
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it("disables the button and shows 'Quote expired' when lockSeconds is 0", () => {
    render(<SwapCard {...baseProps} lockSeconds={0} />)
    const btn = screen.getByRole("button", { name: /quote expired/i })
    expect(btn).toBeDisabled()
  })
})

describe("SwapCard — fee denomination + reconcilable total (finding: swap-receive)", () => {
  it("renders the network fee in its own fee asset when feeAsset is provided (gas, not fromAsset)", () => {
    // feeAsset is being added to the SwapView contract (lib/schemas); attach it
    // via a spread cast until that lands so this card-side test compiles.
    const withFeeAsset = {
      ...baseProps,
      networkFee: "3.2",
      transactionFee: "0",
      feeAsset: "TRX",
    } as SwapCardProps
    render(<SwapCard {...withFeeAsset} />)
    expect(screen.getByText("Network fee")).toBeInTheDocument()
    // gas denominated in the fee asset, NOT the fromAsset
    expect(screen.getByText("3.2 TRX")).toBeInTheDocument()
    expect(screen.queryByText("3.2 USDT")).not.toBeInTheDocument()
  })

  it("falls back to the fromAsset denomination when no feeAsset is provided", () => {
    render(<SwapCard {...baseProps} networkFee="1" />)
    expect(screen.getByText("1 USDT")).toBeInTheDocument()
  })

  it("keeps Total debit at the reserved fromAmount of fromAsset", () => {
    render(<SwapCard {...baseProps} />)
    expect(screen.getByText("Total debit")).toBeInTheDocument()
    expect(screen.getAllByText("100 USDT").length).toBeGreaterThan(0)
  })

  it("tells the user fees are deducted from the amount received (reconcilable total)", () => {
    render(<SwapCard {...baseProps} />)
    expect(
      screen.getByText(/fees are deducted from the amount you receive/i)
    ).toBeInTheDocument()
  })
})
