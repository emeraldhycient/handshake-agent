import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ActivityTab } from "./activity-tab"

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return Wrapper
}

describe("ActivityTab", () => {
  it("shows 'Today' group label after data loads", async () => {
    render(<ActivityTab />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText("Today")).toBeInTheDocument(), {
      timeout: 3000,
    })
  })

  it("shows 'Yesterday' group label after data loads", async () => {
    render(<ActivityTab />, { wrapper: makeWrapper() })
    await waitFor(
      () => expect(screen.getByText("Yesterday")).toBeInTheDocument(),
      { timeout: 3000 }
    )
  })

  it("shows a transaction title after data loads", async () => {
    render(<ActivityTab />, { wrapper: makeWrapper() })
    await waitFor(
      () => expect(screen.getByText("Bought USDT")).toBeInTheDocument(),
      { timeout: 3000 }
    )
  })

  it("shows status pills (Completed)", async () => {
    render(<ActivityTab />, { wrapper: makeWrapper() })
    const pills = await screen.findAllByText("Completed", undefined, {
      timeout: 3000,
    })
    expect(pills.length).toBeGreaterThan(0)
  })

  it("shows the Activity page header text", async () => {
    render(<ActivityTab />, { wrapper: makeWrapper() })
    await waitFor(
      () => expect(screen.getByText("Activity")).toBeInTheDocument(),
      { timeout: 3000 }
    )
  })
})
