import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { MetricsFilterState } from "@/types/components"

import { MetricsFilterBar } from "@/components/admin/metrics-filter-bar"

const state: MetricsFilterState = {
  presetId: "30d",
  from: "",
  to: "",
  capability: "",
  tier: "",
  currency: "",
}

describe("MetricsFilterBar", () => {
  it("selecting a preset reports it and clears any custom dates", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <MetricsFilterBar
        value={{ ...state, presetId: "custom", from: "2026-06-01", to: "2026-06-30" }}
        onChange={onChange}
      />
    )
    await user.click(screen.getByRole("button", { name: "7d" }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ presetId: "7d", from: "", to: "" })
    )
  })

  it("changing a filter select reports the new value", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MetricsFilterBar value={state} onChange={onChange} />)
    await user.selectOptions(screen.getByLabelText("Filter by capability"), "buy")
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "buy" })
    )
  })

  it("editing a date switches to the custom preset", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MetricsFilterBar value={state} onChange={onChange} />)
    await user.type(screen.getByLabelText("Filter from date"), "2026-06-01")
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ presetId: "custom" })
    )
  })

  it("shows a Clear control that resets when a filter is active", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <MetricsFilterBar value={{ ...state, capability: "buy" }} onChange={onChange} />
    )
    await user.click(screen.getByRole("button", { name: /clear/i }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "", tier: "", currency: "" })
    )
  })

  it("hides the Clear control when no filter is active", () => {
    render(<MetricsFilterBar value={state} onChange={vi.fn()} />)
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument()
  })
})
