import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import type { PlatformKpis } from "@handshake-agent/contracts"

import { PlatformKpisCard } from "@/components/admin/platform-kpis-card"

const DATA: PlatformKpis = {
  newUsers: { current: 12, previous: 8, growthRate: 0.5 },
  churn: { activePrevious: 10, churned: 3, churnRate: 0.3 },
  failedJobs: 2,
}

describe("PlatformKpisCard", () => {
  it("renders the three lifecycle KPIs with formatted values", () => {
    render(<PlatformKpisCard data={DATA} isLoading={false} isError={false} />)
    expect(screen.getByText("New users")).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    // Signed growth percentage.
    expect(screen.getByText("+50.0%")).toBeInTheDocument()
    // Churn rate (unsigned).
    expect(screen.getByText("Churn")).toBeInTheDocument()
    expect(screen.getByText("30.0%")).toBeInTheDocument()
    // Failed jobs.
    expect(screen.getByText("Failed jobs")).toBeInTheDocument()
    expect(screen.getByLabelText("Failed jobs count")).toHaveTextContent("2")
  })

  it("shows a negative growth rate with a minus sign", () => {
    render(
      <PlatformKpisCard
        data={{ ...DATA, newUsers: { current: 6, previous: 10, growthRate: -0.4 } }}
        isLoading={false}
        isError={false}
      />
    )
    expect(screen.getByText("-40.0%")).toBeInTheDocument()
  })

  it("renders a busy skeleton while loading", () => {
    const { container } = render(
      <PlatformKpisCard data={undefined} isLoading isError={false} />
    )
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it("renders an error note on failure", () => {
    render(<PlatformKpisCard data={undefined} isLoading={false} isError />)
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument()
  })
})
