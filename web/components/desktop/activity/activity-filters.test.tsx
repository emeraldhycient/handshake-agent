import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ActivityFilters } from "./activity-filters"

describe("ActivityFilters", () => {
  it("renders all four filter pills", () => {
    render(<ActivityFilters active="all" onChange={() => {}} />)
    ;["All", "Received", "Sent", "Tickets"].forEach((label) =>
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    )
  })

  it("fires onChange with the selected filter id", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ActivityFilters active="all" onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: "Received" }))
    expect(onChange).toHaveBeenCalledWith("received")
  })
})
