import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { MetricsFilterState } from "@/types"

import { MetricsFilterBar } from "@/components/admin/metrics-filter-bar"

// Options are catalog-derived by the orchestrator and passed down as a prop.
const currencyOptions = [
  { value: "", label: "All currencies" },
  { value: "NGN", label: "NGN" },
  { value: "XOF", label: "XOF" },
]

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
        currencyOptions={currencyOptions}
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
    render(
      <MetricsFilterBar
        value={state}
        onChange={onChange}
        currencyOptions={currencyOptions}
      />
    )
    await user.selectOptions(screen.getByLabelText("Filter by capability"), "buy")
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "buy" })
    )
  })

  it("editing a date switches to the custom preset", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <MetricsFilterBar
        value={state}
        onChange={onChange}
        currencyOptions={currencyOptions}
      />
    )
    await user.type(screen.getByLabelText("Filter from date"), "2026-06-01")
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ presetId: "custom" })
    )
  })

  it("shows a Clear control that resets when a filter is active", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <MetricsFilterBar
        value={{ ...state, capability: "buy" }}
        onChange={onChange}
        currencyOptions={currencyOptions}
      />
    )
    await user.click(screen.getByRole("button", { name: /clear/i }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "", tier: "", currency: "" })
    )
  })

  it("renders the catalog-derived currency options (runtime fiats included)", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <MetricsFilterBar
        value={state}
        onChange={onChange}
        currencyOptions={currencyOptions}
      />
    )
    await user.selectOptions(screen.getByLabelText("Filter by currency"), "XOF")
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "XOF" })
    )
  })

  it("hides the Clear control when no filter is active", () => {
    render(
      <MetricsFilterBar
        value={state}
        onChange={vi.fn()}
        currencyOptions={currencyOptions}
      />
    )
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument()
  })
})
