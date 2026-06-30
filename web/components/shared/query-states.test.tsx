import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi } from "vitest"
import { QueryErrorState, QueryEmptyState } from "./query-states"

describe("QueryErrorState", () => {
  it("renders a default title and a Retry button", () => {
    render(<QueryErrorState onRetry={vi.fn()} />)
    expect(screen.getByText("Couldn't load this")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument()
  })

  it("calls onRetry (the query's refetch) when Retry is clicked", async () => {
    const onRetry = vi.fn()
    render(<QueryErrorState onRetry={onRetry} />)
    await userEvent.click(screen.getByRole("button", { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("accepts an override title and description", () => {
    render(
      <QueryErrorState
        onRetry={vi.fn()}
        title="Failed to load activity"
        description="Check your connection."
      />
    )
    expect(screen.getByText("Failed to load activity")).toBeInTheDocument()
    expect(screen.getByText("Check your connection.")).toBeInTheDocument()
  })

  it("omits the Retry button when no onRetry is provided", () => {
    render(<QueryErrorState />)
    expect(
      screen.queryByRole("button", { name: /retry/i })
    ).not.toBeInTheDocument()
  })

  it("uses the danger token for the title (failure is high-signal)", () => {
    render(<QueryErrorState onRetry={vi.fn()} />)
    expect(screen.getByText("Couldn't load this")).toHaveClass("text-danger")
  })
})

describe("QueryEmptyState", () => {
  it("renders a default empty message", () => {
    render(<QueryEmptyState />)
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument()
  })

  it("accepts an override title and description", () => {
    render(
      <QueryEmptyState
        title="No activity yet"
        description="Your transactions will appear here."
      />
    )
    expect(screen.getByText("No activity yet")).toBeInTheDocument()
    expect(
      screen.getByText("Your transactions will appear here.")
    ).toBeInTheDocument()
  })
})
