import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Money } from "./money"

describe("Money", () => {
  it("renders the value text", () => {
    render(<Money value="₦72,340" />)
    expect(screen.getByText("₦72,340")).toBeInTheDocument()
  })

  it("applies tabular-nums class", () => {
    render(<Money value="₦72,340" />)
    const el = screen.getByText("₦72,340")
    expect(el).toHaveClass("tabular-nums")
  })

  it("merges additional className", () => {
    render(<Money value="₦100" className="text-lg font-bold" />)
    const el = screen.getByText("₦100")
    expect(el).toHaveClass("tabular-nums")
    expect(el).toHaveClass("font-bold")
    expect(el).toHaveClass("text-lg")
  })

  it("defaults to a span element when as is omitted", () => {
    render(<Money value="₦0" />)
    const el = screen.getByText("₦0")
    expect(el.tagName).toBe("SPAN")
    expect(el).toHaveClass("tabular-nums")
  })

  it("renders a div when as='div'", () => {
    render(<Money value="₦999" as="div" />)
    const el = screen.getByText("₦999")
    expect(el.tagName).toBe("DIV")
    expect(el).toHaveClass("tabular-nums")
  })

  it("renders a p when as='p'", () => {
    render(<Money value="₦1" as="p" />)
    const el = screen.getByText("₦1")
    expect(el.tagName).toBe("P")
    expect(el).toHaveClass("tabular-nums")
  })
})
