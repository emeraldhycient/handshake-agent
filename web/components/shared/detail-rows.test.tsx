import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DetailRows } from "./detail-rows"

describe("DetailRows", () => {
  const rows = [{ label: "You pay", value: "₦50,000" }]

  it("renders the label", () => {
    render(<DetailRows rows={rows} />)
    expect(screen.getByText("You pay")).toBeInTheDocument()
  })

  it("renders the value", () => {
    render(<DetailRows rows={rows} />)
    expect(screen.getByText("₦50,000")).toBeInTheDocument()
  })

  it("value element has tabular-nums class", () => {
    render(<DetailRows rows={rows} />)
    const valueEl = screen.getByText("₦50,000")
    expect(valueEl).toHaveClass("tabular-nums")
  })

  it("renders multiple rows", () => {
    const multiRows = [
      { label: "You pay", value: "₦50,000" },
      { label: "You receive", value: "0.031 ETH" },
      { label: "Fee", value: "₦500" },
    ]
    render(<DetailRows rows={multiRows} />)
    expect(screen.getByText("You pay")).toBeInTheDocument()
    expect(screen.getByText("₦50,000")).toBeInTheDocument()
    expect(screen.getByText("You receive")).toBeInTheDocument()
    expect(screen.getByText("0.031 ETH")).toBeInTheDocument()
    expect(screen.getByText("Fee")).toBeInTheDocument()
    expect(screen.getByText("₦500")).toBeInTheDocument()
  })

  it("label element has text-muted-foreground class", () => {
    render(<DetailRows rows={rows} />)
    const labelEl = screen.getByText("You pay")
    expect(labelEl).toHaveClass("text-muted-foreground")
  })

  it("merges additional className on container", () => {
    render(<DetailRows rows={rows} className="mt-4" />)
    // Container should exist — find by the label child's parent chain
    const labelEl = screen.getByText("You pay")
    // Walk up to the container div
    const container = labelEl.closest(".mt-4")
    expect(container).toBeInTheDocument()
  })

  it("marks row values as non-translatable", () => {
    render(<DetailRows rows={[{ label: "Reference", value: "HS-abc123" }]} />)
    expect(screen.getByText("HS-abc123")).toHaveAttribute("translate", "no")
  })
})
