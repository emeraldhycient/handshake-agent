import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ActivityRow } from "./activity-row"
import type { ActivityItem } from "@/lib/schemas"

const item = {
  id: "tx1",
  dir: "in",
  icon: "↓",
  tint: "#e8f5e9",
  col: "#1b5e20",
  title: "Bought USDT",
  sub: "Today · 10:00",
  amount: "+ 50 USDT",
  status: "Completed",
  statusTone: "success",
} as ActivityItem

describe("ActivityRow", () => {
  it("renders the title, sub, amount and status as an accessible button", () => {
    render(<ActivityRow item={item} idx={0} />)
    const btn = screen.getByRole("button", {
      name: /View details for Bought USDT/i,
    })
    expect(btn).toBeInTheDocument()
    expect(screen.getByText("Bought USDT")).toBeInTheDocument()
    expect(screen.getByText("Completed")).toBeInTheDocument()
  })

  it("calls onSelect with the item id when clicked", async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ActivityRow item={item} idx={0} onSelect={onSelect} />)
    await user.click(screen.getByRole("button"))
    expect(onSelect).toHaveBeenCalledWith("tx1")
  })
})
