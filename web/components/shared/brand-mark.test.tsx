import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { BrandMark } from "./brand-mark"

describe("BrandMark", () => {
  it("default variant renders a static centre, not the spark", () => {
    render(<BrandMark />)
    expect(screen.queryByTestId("brand-spark")).not.toBeInTheDocument()
  })

  it("spark variant renders the animated sunburst with the spin animation", () => {
    render(<BrandMark variant="spark" />)
    const spark = screen.getByTestId("brand-spark")
    expect(spark).toBeInTheDocument()
    // Multiple radiating blades make up the sunburst.
    expect(spark.querySelectorAll("rect").length).toBeGreaterThanOrEqual(8)
    // The spin animation is applied (only when motion is allowed).
    expect(spark.getAttribute("class") ?? "").toContain("animate-hs-spark-spin")
  })

  it("size prop scales the outer tile", () => {
    const { container } = render(<BrandMark size={56} />)
    const tile = container.firstChild as HTMLElement
    expect(tile.style.width).toBe("56px")
    expect(tile.style.height).toBe("56px")
  })

  it("is decorative (aria-hidden) by default", () => {
    const { container } = render(<BrandMark />)
    const tile = container.firstChild as HTMLElement
    expect(tile).toHaveAttribute("aria-hidden", "true")
  })

  it("exposes role=img with an accessible name when ariaLabel is set", () => {
    render(
      <BrandMark variant="spark" ariaLabel="Handshake Agent is thinking" />
    )
    expect(
      screen.getByRole("img", { name: /handshake agent is thinking/i })
    ).toBeInTheDocument()
  })
})
