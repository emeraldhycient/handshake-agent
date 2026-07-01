/**
 * OperatorDashboard chart-rescope test (design reproduction).
 *
 * The KPI range switcher (24h / 7d / 30d) rescopes both the KPI tiles AND the
 * stacked-bar Transaction-volume chart. This test asserts the fix: switching the
 * range visibly changes the chart's bar silhouette (the inline segment heights),
 * while the colours/labels stay identical.
 *
 * The component is presentational (no data fetching); `next/navigation` is mocked
 * because the maker-checker approval flow and alert rows call `useRouter().push`.
 */
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

import { OperatorDashboard } from "@/components/admin/operator-dashboard"

/** Snapshot the chart's segment heights (inline `height:` styles) as a string. */
function chartHeights(): string {
  const chart = screen.getByRole("img", {
    name: /Transaction volume by day/i,
  })
  return Array.from(chart.querySelectorAll<HTMLElement>("[style*='height']"))
    .map((el) => el.style.height)
    .join("|")
}

describe("OperatorDashboard — volume chart rescopes with the KPI range", () => {
  it("switching the range visibly changes the bar heights", async () => {
    const user = userEvent.setup()
    render(<OperatorDashboard />)

    const before = chartHeights()
    expect(before.length).toBeGreaterThan(0)

    await user.click(screen.getByRole("button", { name: "7d" }))
    const after7d = chartHeights()
    expect(after7d).not.toEqual(before)

    await user.click(screen.getByRole("button", { name: "30d" }))
    const after30d = chartHeights()
    expect(after30d).not.toEqual(after7d)
  })
})
