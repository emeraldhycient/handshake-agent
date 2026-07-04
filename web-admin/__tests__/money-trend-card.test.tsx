import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { MoneySeriesMetrics } from "@handshake-agent/contracts"

import { MoneyTrendCard } from "@/components/admin/money-trend-card"

const DATA: MoneySeriesMetrics = {
  buckets: [
    {
      date: "2026-06-01",
      gmv: [{ currency: "NGN", amount: "50000" }],
      revenue: [{ currency: "NGN", amount: "150" }],
      profit: [{ currency: "NGN", amount: "240" }],
    },
    {
      date: "2026-06-02",
      gmv: [{ currency: "NGN", amount: "80000" }],
      revenue: [{ currency: "NGN", amount: "300" }],
      profit: [{ currency: "NGN", amount: "500" }],
    },
  ],
  currencies: ["NGN"],
}

describe("MoneyTrendCard", () => {
  it("renders a trend chart for the default metric (profit) with the peak day formatted", () => {
    render(<MoneyTrendCard data={DATA} isLoading={false} isError={false} />)
    // Default metric = Profit → peak day 500 formatted with the NGN symbol.
    expect(screen.getByRole("img", { name: /profit/i })).toBeInTheDocument()
    expect(screen.getByText("₦500.00")).toBeInTheDocument()
  })

  it("switches the plotted metric when a segment is clicked", async () => {
    const user = userEvent.setup()
    render(<MoneyTrendCard data={DATA} isLoading={false} isError={false} />)
    await user.click(screen.getByRole("button", { name: "GMV" }))
    // GMV peak is 80,000 formatted.
    expect(screen.getByText("₦80,000.00")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /gmv/i })).toBeInTheDocument()
  })

  it("shows an empty state (no chart) when there is no money movement", () => {
    render(
      <MoneyTrendCard
        data={{ buckets: [], currencies: [] }}
        isLoading={false}
        isError={false}
      />
    )
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.getByText(/no money movement/i)).toBeInTheDocument()
  })

  it("renders a busy skeleton while loading", () => {
    const { container } = render(
      <MoneyTrendCard data={undefined} isLoading isError={false} />
    )
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it("renders an error note on failure", () => {
    render(<MoneyTrendCard data={undefined} isLoading={false} isError />)
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument()
  })
})
