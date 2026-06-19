import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { QrPlaceholder } from "./qr-placeholder"

describe("QrPlaceholder", () => {
  it("renders an element with data-testid qr", () => {
    render(<QrPlaceholder />)
    expect(screen.getByTestId("qr")).toBeInTheDocument()
  })

  it("renders the three finder squares", () => {
    render(<QrPlaceholder />)
    const finders = screen.getAllByTestId("qr-finder")
    expect(finders).toHaveLength(3)
  })

  it("applies default size of 150px via inline style", () => {
    render(<QrPlaceholder />)
    const root = screen.getByTestId("qr")
    expect(root.style.width).toBe("150px")
    expect(root.style.height).toBe("150px")
  })

  it("accepts a custom size prop and applies it via style", () => {
    render(<QrPlaceholder size={120} />)
    const root = screen.getByTestId("qr")
    expect(root.style.width).toBe("120px")
    expect(root.style.height).toBe("120px")
  })

  it("merges additional className on root", () => {
    render(<QrPlaceholder className="mx-auto" />)
    const root = screen.getByTestId("qr")
    expect(root).toHaveClass("mx-auto")
  })

  it("root has no hex literals in className (tokens only)", () => {
    render(<QrPlaceholder />)
    const root = screen.getByTestId("qr")
    expect(root.className).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })

  it("root has border-border class for visible outline", () => {
    render(<QrPlaceholder />)
    const root = screen.getByTestId("qr")
    expect(root).toHaveClass("border-border")
    expect(root).toHaveClass("border")
  })

  it("module div does NOT carry bg-foreground (stripe visibility regression)", () => {
    render(<QrPlaceholder />)
    const moduleDiv = screen.getByTestId("qr-module")
    expect(moduleDiv).not.toHaveClass("bg-foreground")
  })

  it("module div has no hex literals in className (tokens only)", () => {
    render(<QrPlaceholder />)
    const moduleDiv = screen.getByTestId("qr-module")
    expect(moduleDiv.className).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })
})
