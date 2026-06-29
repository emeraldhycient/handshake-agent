import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, afterEach } from "vitest"
import { ActivityTab } from "./activity-tab"

// ─── Per-test mock control for the error-branch tests ────────────────────────
import * as gatewayModule from "@/lib/api/gateway"
import * as chatApi from "@/lib/api/chat"

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return Wrapper
}

afterEach(() => {
  vi.restoreAllMocks()
})

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

  // ── §13.6 four-branch coverage ────────────────────────────────────────────

  it("loading branch: renders skeleton before data resolves", () => {
    // The mock gateway resolves async; on synchronous render the component
    // is in the loading state and renders Skeleton elements.
    render(<ActivityTab />, { wrapper: makeWrapper() })
    // The group label is NOT yet present (data hasn't resolved)
    expect(screen.queryByText("Today")).not.toBeInTheDocument()
    // The component itself renders (not null) — skeleton is shown.
    // Loading branch renders a container div; confirm it's present.
    const container = document.querySelector(".flex.min-h-0.flex-1.flex-col")
    expect(container).not.toBeNull()
  })

  it("error branch: renders error message when query fails", async () => {
    // Spy on gateway to make getActivity reject
    vi.spyOn(gatewayModule.gateway, "getActivity").mockRejectedValue(
      new Error("Network error")
    )

    render(<ActivityTab />, { wrapper: makeWrapper() })
    await waitFor(
      () =>
        expect(screen.getByText("Could not load activity")).toBeInTheDocument(),
      { timeout: 3000 }
    )
  })

  it("clicking a row opens the TransactionDetailModal", async () => {
    // Make detail fetch hang so the dialog loading state is visible
    vi.spyOn(chatApi, "getTransactionDetail").mockReturnValue(
      new Promise(() => {})
    )
    const user = userEvent.setup()
    render(<ActivityTab />, { wrapper: makeWrapper() })

    // Wait for data to load
    await waitFor(() => expect(screen.getByText("Today")).toBeInTheDocument(), {
      timeout: 3000,
    })

    // Click the first row (Bought USDT) by exact aria-label
    const row = screen.getByRole("button", {
      name: "View details for Bought USDT",
    })
    await user.click(row)

    // Dialog should open with the generic loading title
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument()
    })
    expect(screen.getByText("Transaction Detail")).toBeInTheDocument()
  })
})
