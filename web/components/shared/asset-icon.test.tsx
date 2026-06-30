import { fireEvent, render, screen } from "@testing-library/react"
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

  describe("logoUrl", () => {
    const LOGO = "https://res.cloudinary.com/blockradar/usdt.png"

    it("renders an <img> with the logoUrl and the symbol as alt when logoUrl is set", () => {
      render(<AssetIcon sym="USDT" tint="#7fd1a8" logoUrl={LOGO} />)
      const img = screen.getByRole("img", { name: "USDT" })
      expect(img).toHaveAttribute("src", LOGO)
    })

    it("the logo image is lazy-loaded", () => {
      render(<AssetIcon sym="USDT" tint="#7fd1a8" logoUrl={LOGO} />)
      const img = screen.getByRole("img", { name: "USDT" })
      expect(img).toHaveAttribute("loading", "lazy")
    })

    it("does not render the text badge symbol while the logo is shown", () => {
      render(<AssetIcon sym="USDT" tint="#7fd1a8" logoUrl={LOGO} />)
      // The text badge "USDT" must not be present — only the img (alt=USDT) is.
      expect(screen.queryByText("USDT")).not.toBeInTheDocument()
    })

    it("falls back to the tinted text badge when logoUrl is absent", () => {
      render(<AssetIcon sym="USDT" tint="#7fd1a8" />)
      expect(screen.queryByRole("img")).not.toBeInTheDocument()
      expect(screen.getByText("USDT")).toBeInTheDocument()
    })

    it("falls back to the text badge when the image fails to load (onError)", () => {
      render(<AssetIcon sym="USDT" tint="#7fd1a8" logoUrl={LOGO} />)
      const img = screen.getByRole("img", { name: "USDT" })
      fireEvent.error(img)
      // After the error, the img is gone and the text badge is shown.
      expect(screen.queryByRole("img")).not.toBeInTheDocument()
      expect(screen.getByText("USDT")).toBeInTheDocument()
    })

    it("keeps the tinted wrapper (data exception) even when showing the logo", () => {
      render(<AssetIcon sym="USDT" tint="#7fd1a8" logoUrl={LOGO} />)
      const el = screen.getByTestId("asset-icon")
      expect((el as HTMLElement).style.backgroundColor).toBeTruthy()
    })
  })
})
