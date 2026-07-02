/**
 * AssetsPage render test — WIRED to real data (Phase 6b).
 *
 * The page renders `useAdminCatalog()` (GET /admin/config/catalog) instead of a
 * module-level asset seed. The api client (`@/lib/api/catalog`) is mocked (like
 * users-page.test.tsx) so no server is needed.
 *
 * Asserted branches:
 *  - loading → data: a real asset row derived from the mocked `AdminCatalogView`
 *    renders — symbol, display name, joined chain label, decimals, and the
 *    Live/Paused pill from the server `live` flag (including a *disabled* row).
 *  - Min/max + Contract have no backing field → render "—".
 *  - empty: an empty `assets[]` renders the design's "No assets in the catalog".
 *  - error: a rejected fetch renders the inline retry affordance.
 *  - the Blockradar "Sync" ghost action still opens the ReasonModal (design-mock).
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminCatalogView } from "@handshake-agent/contracts"

import { AssetsPage } from "@/components/admin/assets-page"
import { defaultToastStore } from "@/lib/store/toast-store"

vi.mock("@/lib/api/catalog", () => ({
  getAdminCatalog: vi.fn(),
}))

import { getAdminCatalog } from "@/lib/api/catalog"

const mockGetAdminCatalog = vi.mocked(getAdminCatalog)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VIEW: AdminCatalogView = {
  assets: [
    {
      symbol: "USDT",
      displayName: "Tether USD",
      kind: "crypto",
      decimals: 6,
      networks: ["TRON", "Ethereum"],
      live: true,
    },
    {
      symbol: "BTC",
      displayName: "Bitcoin",
      kind: "crypto",
      decimals: 8,
      networks: ["Bitcoin"],
      live: false,
    },
  ],
  fiats: [],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AssetsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
  mockGetAdminCatalog.mockReset()
})

describe("AssetsPage", () => {
  it("renders real asset rows (symbol, name, joined chain, decimals, live status)", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    renderPage()

    // Data branch: the live USDT row.
    const usdtName = await screen.findByText("Tether USD")
    expect(usdtName).toBeInTheDocument()
    // The two networks are joined into one chain label.
    expect(screen.getByText("TRON · Ethereum")).toBeInTheDocument()

    // A *disabled* asset from the admin view renders as Paused (the enabled-only
    // public /config could not have surfaced it).
    const btcToggle = screen.getByRole("button", {
      name: /Toggle BTC on Bitcoin live status/i,
    })
    expect(within(btcToggle).getByText("Paused")).toBeInTheDocument()

    const usdtToggle = screen.getByRole("button", {
      name: /Toggle USDT on TRON · Ethereum live status/i,
    })
    expect(within(usdtToggle).getByText("Live")).toBeInTheDocument()
  })

  it("renders — for Min/max and Contract (no backing field in the read)", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    renderPage()
    await screen.findByText("Tether USD")
    // Both the Min/max and Contract cells fall back to the em dash.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2)
  })

  it("renders the empty state when the catalog has no assets", async () => {
    mockGetAdminCatalog.mockResolvedValue({ assets: [], fiats: [] })
    renderPage()
    expect(
      await screen.findByText(/No assets in the catalog/i)
    ).toBeInTheDocument()
  })

  it("renders the error state with a retry affordance when the fetch fails", async () => {
    mockGetAdminCatalog.mockRejectedValue(new Error("boom"))
    renderPage()
    expect(
      await screen.findByText(/Couldn't load the asset catalog/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Retry/i })
    ).toBeInTheDocument()
  })

  it("opens the Blockradar sync ReasonModal (design-mock action)", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Tether USD")

    await user.click(
      screen.getByRole("button", { name: /Sync Blockradar catalog/i })
    )
    await user.type(screen.getByLabelText("Reason"), "Weekly catalog refresh")
    await user.click(screen.getByRole("button", { name: /Continue/i }))

    await waitFor(() => {
      const { toasts } = defaultToastStore.getState()
      expect(toasts).toHaveLength(1)
      expect(toasts[0].message).toMatch(/Blockradar catalog synced/i)
    })
  })
})
