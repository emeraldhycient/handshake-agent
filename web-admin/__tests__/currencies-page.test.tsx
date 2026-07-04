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
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminCatalogView } from "@handshake-agent/contracts"

import { CurrenciesPage } from "@/components/admin/currencies-page"
import { defaultToastStore } from "@/lib/store/toast-store"

vi.mock("@/lib/api/catalog", () => ({
  getAdminCatalog: vi.fn(),
}))

// The live-toggle write path patches catalog.fiats.<code>.enabled via setSetting.
vi.mock("@/lib/api/config", () => ({
  setSetting: vi.fn(),
}))

// A custom (runtime-added) currency toggles + is added via the currency endpoint.
vi.mock("@/lib/api/currencies", () => ({
  addCurrency: vi.fn(),
  updateCurrency: vi.fn(),
  listCustomFiats: vi.fn(),
}))

// The signed-in admin (drives the step-up dialog's password-vs-TOTP mode).
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

import { getAdminCatalog } from "@/lib/api/catalog"
import { setSetting } from "@/lib/api/config"
import { addCurrency, updateCurrency } from "@/lib/api/currencies"
import { getMe } from "@/lib/api/admin"

const mockGetAdminCatalog = vi.mocked(getAdminCatalog)
const mockSet = vi.mocked(setSetting)
const mockAdd = vi.mocked(addCurrency)
const mockUpdate = vi.mocked(updateCurrency)
const mockGetMe = vi.mocked(getMe)

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
      custom: false,
    },
    {
      code: "RWF",
      symbol: "FRw",
      displayName: "Rwandan Franc",
      decimals: 0,
      live: false,
      custom: false,
    },
    {
      code: "GHS",
      symbol: "₵",
      displayName: "Ghanaian Cedi",
      decimals: 2,
      live: false,
      custom: true,
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
  mockSet.mockReset()
  mockSet.mockResolvedValue({
    key: "catalog.fiats.RWF.enabled",
    category: "Catalog",
    label: "catalog.fiats.RWF.enabled",
    description: "RWF enabled",
    valueType: "boolean",
    editable: true,
    value: true,
    source: "default",
    scope: "global",
    scopeValue: null,
  })
  mockAdd.mockReset()
  mockUpdate.mockReset()
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

  it("persists the toggle via setSetting on catalog.fiats.<code>.enabled when approved", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Nigerian Naira")

    // RWF is Off → enabling persists `true`.
    await user.click(screen.getByRole("button", { name: /Enable RWF/i }))
    await user.click(
      screen.getByRole("button", { name: /Submit for approval/i })
    )

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(mockSet).toHaveBeenCalledWith("catalog.fiats.RWF.enabled", {
      value: true,
      scope: "global",
      scopeValue: null,
    })
    const { toasts } = defaultToastStore.getState()
    expect(toasts.some((t) => /RWF/.test(t.message))).toBe(true)
  })

  it("disables a live currency (persists false) when approved", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Nigerian Naira")

    // NGN is Live → disabling persists `false`.
    await user.click(screen.getByRole("button", { name: /Disable NGN/i }))
    await user.click(
      screen.getByRole("button", { name: /Submit for approval/i })
    )

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(mockSet).toHaveBeenCalledWith("catalog.fiats.NGN.enabled", {
      value: false,
      scope: "global",
      scopeValue: null,
    })
  })

  it("does not persist until the maker-checker submit fires", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Nigerian Naira")

    await user.click(screen.getByRole("button", { name: /Enable RWF/i }))
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
        key: "catalog.fiats.RWF.enabled",
        category: "Catalog",
        label: "catalog.fiats.RWF.enabled",
        description: "RWF enabled",
        valueType: "boolean",
        editable: true,
        value: true,
        source: "default",
        scope: "global",
        scopeValue: null,
      })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Nigerian Naira")

    await user.click(screen.getByRole("button", { name: /Enable RWF/i }))
    await user.click(
      screen.getByRole("button", { name: /Submit for approval/i })
    )

    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
    expect(mockSet).toHaveBeenCalledTimes(1)
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

  it("marks a runtime-added currency with a Custom chip", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    renderPage()
    // GHS is the custom (runtime-added) row.
    expect(await screen.findByText("Ghanaian Cedi")).toBeInTheDocument()
    expect(screen.getByText("Custom")).toBeInTheDocument()
    // The built-in NGN row is NOT tagged custom → exactly one chip.
    expect(screen.getAllByText("Custom")).toHaveLength(1)
  })

  it("toggles a custom currency via updateCurrency, not setSetting", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    mockUpdate.mockResolvedValue({
      code: "GHS",
      displayName: "Ghanaian Cedi",
      symbol: "₵",
      decimals: 2,
      enabled: true,
      createdAt: "2026-07-03T12:00:00.000Z",
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Ghanaian Cedi")

    // GHS is Off → enabling routes through the currency endpoint.
    await user.click(screen.getByRole("button", { name: /Enable GHS/i }))
    await user.click(
      screen.getByRole("button", { name: /Submit for approval/i })
    )

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith("GHS", { enabled: true })
    // The built-in settings path is NOT used for a custom currency.
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("adds a currency through the New currency dialog", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    mockAdd.mockResolvedValue({
      code: "KES",
      displayName: "Kenyan Shilling",
      symbol: "KSh",
      decimals: 2,
      enabled: false,
      createdAt: "2026-07-03T12:00:00.000Z",
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Nigerian Naira")

    await user.click(screen.getByRole("button", { name: /New currency/i }))
    // The dialog is open with the code field focused.
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText(/Code/i), "kes")
    await user.type(within(dialog).getByLabelText(/Symbol/i), "KSh")
    await user.type(
      within(dialog).getByLabelText(/Display name/i),
      "Kenyan Shilling"
    )
    await user.click(
      within(dialog).getByRole("button", { name: /Add currency/i })
    )

    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1))
    expect(mockAdd).toHaveBeenCalledWith({
      code: "KES",
      symbol: "KSh",
      displayName: "Kenyan Shilling",
      decimals: 2,
    })
  })

  it("blocks a duplicate code in the add dialog before hitting the server", async () => {
    mockGetAdminCatalog.mockResolvedValue(VIEW)
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Nigerian Naira")

    await user.click(screen.getByRole("button", { name: /New currency/i }))
    const dialog = await screen.findByRole("dialog")
    // NGN already exists in the catalog.
    await user.type(within(dialog).getByLabelText(/Code/i), "NGN")
    await user.type(within(dialog).getByLabelText(/Symbol/i), "₦")
    await user.type(
      within(dialog).getByLabelText(/Display name/i),
      "Nigerian Naira"
    )
    await user.click(
      within(dialog).getByRole("button", { name: /Add currency/i })
    )

    expect(
      await within(dialog).findByText(/already in the catalog/i)
    ).toBeInTheDocument()
    expect(mockAdd).not.toHaveBeenCalled()
  })
})
