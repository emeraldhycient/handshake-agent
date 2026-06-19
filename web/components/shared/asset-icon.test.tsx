import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AssetIcon } from "./asset-icon"

describe("AssetIcon", () => {
  it("renders the symbol text", () => {
    render(<AssetIcon sym="$" tint="#7fd1a8" />)
    expect(screen.getByText("$")).toBeInTheDocument()
  })

  it("applies tint as inline backgroundColor style", () => {
    render(<AssetIcon sym="$" tint="#7fd1a8" />)
    const el = screen.getByText("$").closest("[data-testid='asset-icon']")
    expect(el).toBeInTheDocument()
    // jsdom normalises #7fd1a8 to rgb(127, 209, 168)
    expect((el as HTMLElement).style.backgroundColor).toBeTruthy()
  })

  it("wrapper has the data-testid asset-icon attribute", () => {
    render(<AssetIcon sym="ETH" tint="#f5c46b" />)
    expect(screen.getByTestId("asset-icon")).toBeInTheDocument()
  })

  it("sm size applies ~32px dimension class", () => {
    render(<AssetIcon sym="BTC" tint="#f5c46b" size="sm" />)
    const el = screen.getByTestId("asset-icon")
    expect(el.className).toMatch(/h-8|size-8|w-8/)
  })

  it("md size (default) applies ~38px dimension class", () => {
    render(<AssetIcon sym="BTC" tint="#f5c46b" size="md" />)
    const el = screen.getByTestId("asset-icon")
    expect(el.className).toMatch(/h-\[38px\]|size-\[38px\]|w-\[38px\]/)
  })

  it("merges additional className", () => {
    render(<AssetIcon sym="₦" tint="#cfe6d8" className="shadow-sm" />)
    const el = screen.getByTestId("asset-icon")
    expect(el).toHaveClass("shadow-sm")
  })

  it("does not apply tint as a class (no hex in className)", () => {
    render(<AssetIcon sym="$" tint="#7fd1a8" />)
    const el = screen.getByTestId("asset-icon")
    // Tint must NOT appear in className — it's only in inline style
    expect(el.className).not.toContain("#")
    expect(el.className).not.toContain("7fd1a8")
  })
})
