import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ActivityGroupList } from "./activity-group-list"
import type { ActivityGroup } from "@/lib/schemas"

const groups: ActivityGroup[] = [
  {
    group: "Today",
    items: [
      {
        id: "a",
        dir: "in",
        icon: "↓",
        tint: "#eef",
        col: "#003",
        title: "Bought USDT",
        sub: "10:00",
        amount: "+50",
        status: "Completed",
        statusTone: "success",
      },
      {
        id: "b",
        dir: "out",
        icon: "↗",
        tint: "#fee",
        col: "#300",
        title: "Sent USDT",
        sub: "11:00",
        amount: "-5",
        status: "Completed",
        statusTone: "success",
      },
    ],
  },
]

describe("ActivityGroupList", () => {
  it("renders each group header and a row per item", () => {
    render(<ActivityGroupList groups={groups} />)
    expect(screen.getByText("Today")).toBeInTheDocument()
    expect(screen.getByText("Bought USDT")).toBeInTheDocument()
    expect(screen.getByText("Sent USDT")).toBeInTheDocument()
    expect(screen.getAllByRole("button")).toHaveLength(2)
  })
})
