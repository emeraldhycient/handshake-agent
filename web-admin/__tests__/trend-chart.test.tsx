import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { TrendChart } from "@/components/admin/trend-chart"

describe("TrendChart", () => {
  it("renders an accessible svg image with a line path over the points", () => {
    render(
      <TrendChart
        ariaLabel="Daily volume, 3 days"
        points={[
          { label: "d1", value: 2 },
          { label: "d2", value: 8 },
          { label: "d3", value: 5 },
        ]}
      />
    )
    const svg = screen.getByRole("img", { name: "Daily volume, 3 days" })
    expect(svg.tagName.toLowerCase()).toBe("svg")
    // A line path with one move + two line commands (3 points).
    const line = svg.querySelector("path[data-role='line']")
    expect(line).not.toBeNull()
    const d = line!.getAttribute("d") ?? ""
    expect((d.match(/[ML]/g) ?? []).length).toBe(3)
  })

  it("maps the tallest value to the top of the viewBox and the smallest to the bottom", () => {
    render(
      <TrendChart
        ariaLabel="two points"
        points={[
          { label: "lo", value: 0 },
          { label: "hi", value: 10 },
        ]}
      />
    )
    const d =
      screen
        .getByRole("img", { name: "two points" })
        .querySelector("path[data-role='line']")!
        .getAttribute("d") ?? ""
    // First point (value 0 = min) sits at the bottom (y = 40), second (max) at top (y = 0).
    expect(d).toContain("M 0.00 40.00")
    expect(d).toContain("L 100.00 0.00")
  })

  it("renders an inline empty state (not an svg) when there are no points", () => {
    render(<TrendChart ariaLabel="empty" points={[]} />)
    expect(screen.queryByRole("img", { name: "empty" })).not.toBeInTheDocument()
    expect(screen.getByText(/no data/i)).toBeInTheDocument()
  })
})
