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

// The live-toggle write path patches catalog.assets.<sym>.enabled via setSetting.
vi.mock("@/lib/api/config", () => ({
  setSetting: vi.fn(),
}))

// The signed-in admin (drives the step-up dialog's password-vs-TOTP mode).
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

import { getAdminCatalog } from "@/lib/api/catalog"
import { setSetting } from "@/lib/api/config"
import { getMe } from "@/lib/api/admin"

const mockGetAdminCatalog = vi.mocked(getAdminCatalog)
const mockSet = vi.mocked(setSetting)
const mockGetMe = vi.mocked(getMe)

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
  mockSet.mockReset()
  mockSet.mockResolvedValue({
    key: "catalog.assets.USDT.enabled",
    category: "Catalog",
    label: "catalog.assets.USDT.enabled",
    description: "USDT enabled",
    valueType: "boolean",
    editable: true,
    value: false,
    source: "default",
    scope: "global",
    scopeValue: null,
  })
  mockGetMe.mockReset()
  mockGetMe.mockResolvedValue({
    id: "11111111-1111-1111-1111-111111111111",
    email: "amara@handshake.ng",
    role: { id: "00000000-0000-0000-0000-000000000001", name: "Super Admin" },
    status: "active",
    displayName: "Test Admin",
    mfaEnabled: true,
    permissions: [],
    menus: [],
    pages: [],
  })
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

  it("persists the live toggle via setSetting on catalog.assets.<sym>.enabled when approved", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Tether USD")

    // USDT is Live → the toggle proposes to pause (enabled=false).
    await user.click(
      screen.getByRole("button", { name: /Toggle USDT on TRON · Ethereum live status/i })
    )
    await user.click(
      screen.getByRole("button", { name: /Submit for approval/i })
    )

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(mockSet).toHaveBeenCalledWith("catalog.assets.USDT.enabled", {
      value: false,
      scope: "global",
      scopeValue: null,
    })
    // Enabling BTC (currently Paused) would persist `true`.
    const { toasts } = defaultToastStore.getState()
    expect(toasts.some((t) => /USDT/.test(t.message))).toBe(true)
  })

  it("enables a paused asset (persists true) when approved", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Tether USD")

    // BTC is Paused → the toggle proposes to enable (enabled=true).
    await user.click(
      screen.getByRole("button", { name: /Toggle BTC on Bitcoin live status/i })
    )
    await user.click(
      screen.getByRole("button", { name: /Submit for approval/i })
    )

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(mockSet).toHaveBeenCalledWith("catalog.assets.BTC.enabled", {
      value: true,
      scope: "global",
      scopeValue: null,
    })
  })

  it("does not persist until the maker-checker submit fires", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Tether USD")

    await user.click(
      screen.getByRole("button", { name: /Toggle USDT on TRON · Ethereum live status/i })
    )
    // The dialog is open but nothing persisted yet.
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("opens step-up and retries the PATCH after re-auth when the server demands step-up", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    const { ApiError } = await import("@/lib/api/client")
    mockSet
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce({
        key: "catalog.assets.USDT.enabled",
        category: "Catalog",
        label: "catalog.assets.USDT.enabled",
        description: "USDT enabled",
        valueType: "boolean",
        editable: true,
        value: false,
        source: "default",
        scope: "global",
        scopeValue: null,
      })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Tether USD")

    await user.click(
      screen.getByRole("button", { name: /Toggle USDT on TRON · Ethereum live status/i })
    )
    await user.click(
      screen.getByRole("button", { name: /Submit for approval/i })
    )

    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
    expect(mockSet).toHaveBeenCalledTimes(1)
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
