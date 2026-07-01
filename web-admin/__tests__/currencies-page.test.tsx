/**
 * CurrenciesPage render test — WIRED to real data (Phase 6b).
 *
 * The page renders `useAdminCatalog()` (GET /admin/config/catalog) instead of a
 * module-level currency seed. The api client (`@/lib/api/catalog`) is mocked so
 * no server is needed.
 *
 * Asserted branches:
 *  - loading → data: real fiat rows derived from the mocked `AdminCatalogView` —
 *    code, name, symbol, rounding (from decimals), and the Live/Off pill from the
 *    server `live` flag (including a *disabled* row the enabled-only public
 *    /config could not surface).
 *  - the Live pill opens the MakerCheckerModal (dual-control), which on submit
 *    toasts the queued change (the persisted toggle is a Phase-7 write).
 *  - empty: an empty `fiats[]` renders the design's "No currencies in the catalog".
 *  - error: a rejected fetch renders the inline retry affordance.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminCatalogView } from "@handshake-agent/contracts"

import { CurrenciesPage } from "@/components/admin/currencies-page"
import { defaultToastStore } from "@/lib/store/toast-store"

vi.mock("@/lib/api/catalog", () => ({
  getAdminCatalog: vi.fn(),
}))

import { getAdminCatalog } from "@/lib/api/catalog"

const mockGetAdminCatalog = vi.mocked(getAdminCatalog)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VIEW: AdminCatalogView = {
  assets: [],
  fiats: [
    {
      code: "NGN",
      symbol: "₦",
      displayName: "Nigerian Naira",
      decimals: 2,
      live: true,
    },
    {
      code: "RWF",
      symbol: "FRw",
      displayName: "Rwandan Franc",
      decimals: 0,
      live: false,
    },
  ],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CurrenciesPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
  mockGetAdminCatalog.mockReset()
})

describe("CurrenciesPage", () => {
  it("renders real fiat rows (code, name, rounding, live status incl. a disabled row)", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    renderPage()

    expect(await screen.findByText("Nigerian Naira")).toBeInTheDocument()
    // The live NGN row offers to Disable it (currently Live).
    const ngn = screen.getByRole("button", { name: /Disable NGN/i })
    expect(ngn).toHaveTextContent(/Live/)
    // The *disabled* RWF row (0-dp) offers to Enable it (currently Off).
    const rwf = screen.getByRole("button", { name: /Enable RWF/i })
    expect(rwf).toHaveTextContent(/Off/)
    // Rounding is sourced from decimals.
    expect(screen.getByText("0 dp")).toBeInTheDocument()
  })

  it("opens the maker-checker modal and toasts the queued change on submit", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Nigerian Naira")

    await user.click(screen.getByRole("button", { name: /Enable RWF/i }))
    await user.click(
      screen.getByRole("button", { name: /Submit for approval/i })
    )

    await waitFor(() => {
      const { toasts } = defaultToastStore.getState()
      expect(toasts).toHaveLength(1)
      expect(toasts[0].message).toMatch(/RWF/)
    })
  })

  it("renders the empty state when the catalog has no currencies", async () => {
    mockGetAdminCatalog.mockResolvedValue({ assets: [], fiats: [] })
    renderPage()
    expect(
      await screen.findByText(/No currencies in the catalog/i)
    ).toBeInTheDocument()
  })

  it("renders the error state with a retry affordance when the fetch fails", async () => {
    mockGetAdminCatalog.mockRejectedValue(new Error("boom"))
    renderPage()
    expect(
      await screen.findByText(/Couldn't load the currency catalog/i)
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument()
  })
})
