import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RecentActivityTable } from "./recent-activity-table"
import type { ActivityGroup } from "@/lib/schemas"

const groups: ActivityGroup[] = [
  {
    group: "Today",
    items: [
      {
        id: "t1",
        dir: "in",
        icon: "↓",
        tint: "#e8f5e9",
        col: "#1b5e20",
        title: "Bought USDT",
        sub: "Today · 10:00",
        amount: "+ 50 USDT",
        status: "Done",
        statusTone: "success",
      },
    ],
  },
]

describe("RecentActivityTable", () => {
  it("renders the heading and a named table of rows", () => {
    render(<RecentActivityTable groups={groups} />)
    expect(screen.getByText(/Recent activity/i)).toBeInTheDocument()
    const table = screen.getByRole("table", { name: "Recent activity" })
    expect(within(table).getByText("Bought USDT")).toBeInTheDocument()
  })

  it("is headerless (no column headers) but still a semantic table", () => {
    render(<RecentActivityTable groups={groups} />)
    const table = screen.getByRole("table", { name: "Recent activity" })
    expect(within(table).queryAllByRole("columnheader")).toHaveLength(0)
  })

  it("shows the empty state when there are no items", () => {
    render(<RecentActivityTable groups={[]} />)
    expect(screen.getByText(/No recent activity/i)).toBeInTheDocument()
  })

  it("does not height-cap its wrapper (rows must not be clipped)", () => {
    render(<RecentActivityTable groups={groups} />)
    const heading = screen.getByText(/Recent activity/i)
    const card = heading.parentElement
    expect(card?.className ?? "").not.toMatch(/\bflex-1\b/)
  })
})
