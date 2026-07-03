/**
 * PricingPage test (design §6.22) — wired to real pricing settings + real persistence.
 *
 * The pricing figures resolve from `pricing.assets.<A>.buySpreadBps` /
 * `.sellSpreadBps` / `.baseRates.NGN` + the global `pricing.processingFeeBps` (GET
 * /admin/settings, mocked). Each priced asset contributes a Buy + Sell row; the
 * user-sees rate + operator margin are DERIVED from base rate + spread + fee. The Edit
 * pill opens the reason → step-up → maker-checker chain; the maker-checker submit fires
 * the REAL step-up-guarded PATCH /admin/settings/:key (setSetting) for the edited row's
 * spread key. The api layer is mocked — no server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { EffectiveSetting } from "@handshake-agent/contracts"

import { PricingPage } from "@/components/admin/pricing-page"
import { defaultToastStore } from "@/lib/store/toast-store"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/config", () => ({
  listEffectiveSettings: vi.fn(),
  setSetting: vi.fn(),
}))

// The signed-in admin (drives the step-up dialog's password-vs-TOTP mode).
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

import { listEffectiveSettings, setSetting } from "@/lib/api/config"
import { getMe } from "@/lib/api/admin"

const mockList = vi.mocked(listEffectiveSettings)
const mockSet = vi.mocked(setSetting)
const mockGetMe = vi.mocked(getMe)

// ─── Fixture ──────────────────────────────────────────────────────────────────

function n(key: string, value: number): EffectiveSetting {
  return {
    key,
    category: "Pricing",
    label: key,
    description: `Pricing ${key}`,
    valueType: "number",
    editable: true,
    value,
    source: "default",
    scope: "global",
    scopeValue: null,
  }
}

/** An unpriced base-rate leaf (no value) — the "Add price" flow's raw material. */
function unpriced(key: string): EffectiveSetting {
  return { ...n(key, 0), value: undefined }
}

// USDT only: base 1000 NGN, buy spread 100 bps (1.00%), sell 50 bps (0.50%),
// processing fee 50 bps (0.50%).
const PRICING_SETTINGS: EffectiveSetting[] = [
  n("pricing.processingFeeBps", 50),
  n("pricing.assets.USDT.baseRates.NGN", 1000),
  n("pricing.assets.USDT.buySpreadBps", 100),
  n("pricing.assets.USDT.sellSpreadBps", 50),
]

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PricingPage />
    </QueryClientProvider>
  )
}

/** Drive the shared flow chain: reason → step-up (6 digits) → maker-checker submit. */
async function advanceToApproval(
  user: ReturnType<typeof userEvent.setup>,
  newSpread: string
) {
  const input = screen.getByRole("textbox", { name: "New spread (basis points)" })
  await user.clear(input)
  await user.type(input, newSpread)
  await user.click(screen.getByRole("button", { name: "Continue" }))
  // reason leg
  await user.type(
    screen.getByRole("textbox", { name: "Reason" }),
    "Repricing"
  )
  await user.click(screen.getByRole("button", { name: "Continue" }))
  // step-up leg (presentational TOTP keypad)
  for (const d of "123456") {
    await user.click(screen.getByRole("button", { name: d }))
  }
  // maker-checker submit
  await user.click(screen.getByRole("button", { name: "Submit for approval" }))
}

/** Drive only the audit chain (reason → step-up → maker-checker), value already captured. */
async function finishAuditChain(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: "Reason" }), "Repricing")
  await user.click(screen.getByRole("button", { name: "Continue" }))
  for (const d of "123456") {
    await user.click(screen.getByRole("button", { name: d }))
  }
  await user.click(screen.getByRole("button", { name: "Submit for approval" }))
}

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
  mockList.mockReset()
  mockList.mockResolvedValue(PRICING_SETTINGS)
  mockSet.mockReset()
  mockSet.mockResolvedValue(n("pricing.assets.USDT.buySpreadBps", 120))
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PricingPage (wired to pricing settings)", () => {
  it("pivots the flat keys into per-asset Buy + Sell rows with derived rates", async () => {
    renderPage()

    // Buy + Sell rows for the priced asset, both bound to USDT / NGN.
    const pairs = await screen.findAllByText("USDT / NGN")
    expect(pairs).toHaveLength(2)

    // Spread label 1.00% appears for the buy row (and again as the sell row's
    // margin: 0.50% spread + 0.50% fee), so match by count.
    expect(screen.getAllByText("1.00%").length).toBeGreaterThanOrEqual(1)
    // Derived buy rate: 1000 * (1 + 0.01) = 1010.00 → "₦1,010.00".
    expect(screen.getByText("₦1,010.00")).toBeInTheDocument()
    // Derived sell rate: 1000 * (1 - 0.005) = 995.00 → "₦995.00".
    expect(screen.getByText("₦995.00")).toBeInTheDocument()

    // Edit pills for both rows.
    expect(
      screen.getByRole("button", { name: "Edit crypto.buy USDT / NGN spread" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Edit crypto.sell USDT / NGN spread" })
    ).toBeInTheDocument()
  })

  it("shows the error branch with a retry when the read fails", async () => {
    mockList.mockRejectedValueOnce(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText("Failed to load pricing")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("shows an empty branch when no priced assets are configured", async () => {
    mockList.mockResolvedValueOnce([])
    renderPage()

    await waitFor(() =>
      expect(screen.getByText("No pricing rows")).toBeInTheDocument()
    )
  })

  it("persists the edited spread via setSetting (PATCH) when the maker-checker is approved", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", {
        name: "Edit crypto.buy USDT / NGN spread",
      })
    )
    await advanceToApproval(user, "120")

    // The real PATCH fires against the buy row's spread key with the new bps value.
    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(mockSet).toHaveBeenCalledWith("pricing.assets.USDT.buySpreadBps", {
      value: 120,
      scope: "global",
      scopeValue: null,
    })
    // A feedback toast fired and the flow closed.
    expect(defaultToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({
        message: expect.stringMatching(/crypto\.buy/),
      })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("targets the sell spread key when the sell row is edited", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", {
        name: "Edit crypto.sell USDT / NGN spread",
      })
    )
    await advanceToApproval(user, "75")

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(mockSet).toHaveBeenCalledWith("pricing.assets.USDT.sellSpreadBps", {
      value: 75,
      scope: "global",
      scopeValue: null,
    })
  })

  it("does not persist until the maker-checker submit fires", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", {
        name: "Edit crypto.buy USDT / NGN spread",
      })
    )
    // Open the flow but stop before submitting.
    const input = screen.getByRole("textbox", {
      name: "New spread (basis points)",
    })
    await user.clear(input)
    await user.type(input, "120")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("opens the step-up dialog and retries the PATCH after re-auth when the server demands step-up", async () => {
    const user = userEvent.setup()
    const { ApiError } = await import("@/lib/api/client")
    mockSet
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce(n("pricing.assets.USDT.buySpreadBps", 120))

    renderPage()
    await user.click(
      await screen.findByRole("button", {
        name: "Edit crypto.buy USDT / NGN spread",
      })
    )
    await advanceToApproval(user, "120")

    // The re-auth dialog appears (TOTP mode, since mfaEnabled).
    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
    expect(mockSet).toHaveBeenCalledTimes(1)
  })

  it("renders configured base rates (the add-more-prices surface)", async () => {
    renderPage()
    expect(await screen.findByText("Base rates")).toBeInTheDocument()
    // USDT / NGN base rate 1000 → "1,000 NGN" (rendered once the read resolves).
    expect(await screen.findByText("1,000 NGN")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Edit USDT / NGN base rate" })
    ).toBeInTheDocument()
  })

  it("edits the processing fee via setSetting (PATCH) when approved", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: "Edit processing fee" })
    )
    const input = screen.getByRole("textbox", {
      name: "New processing fee (basis points)",
    })
    await user.clear(input)
    await user.type(input, "75")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await finishAuditChain(user)

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(mockSet).toHaveBeenCalledWith("pricing.processingFeeBps", {
      value: 75,
      scope: "global",
      scopeValue: null,
    })
  })

  it("edits an existing base rate via setSetting (PATCH) when approved", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: "Edit USDT / NGN base rate" })
    )
    const input = screen.getByRole("textbox", {
      name: "New base rate (NGN per 1 USDT)",
    })
    await user.clear(input)
    await user.type(input, "1650")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await finishAuditChain(user)

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(mockSet).toHaveBeenCalledWith("pricing.assets.USDT.baseRates.NGN", {
      value: 1650,
      scope: "global",
      scopeValue: null,
    })
  })

  it("previews spread rates in the selected currency (multi-currency, not just NGN)", async () => {
    // Add a GHS base rate (19 per USDT). Switching the Preview currency to GHS re-derives
    // the effective-rate preview + the pair label in GHS.
    mockList.mockResolvedValue([
      ...PRICING_SETTINGS,
      n("pricing.assets.USDT.baseRates.GHS", 19),
    ])
    const user = userEvent.setup()
    renderPage()
    // Default (NGN) preview — buy + sell rows.
    expect(await screen.findAllByText("USDT / NGN")).toHaveLength(2)

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Preview currency" }),
      "GHS"
    )

    // The pair + derived rate now show GHS. Buy: 19 × (1 + 0.01) = 19.19 → "19.19 GHS".
    expect(await screen.findAllByText("USDT / GHS")).toHaveLength(2)
    expect(screen.getByText("19.19 GHS")).toBeInTheDocument()
  })

  it("adds a base rate for an unpriced currency through the Add-price dialog", async () => {
    mockList.mockResolvedValue([
      ...PRICING_SETTINGS,
      unpriced("pricing.assets.USDT.baseRates.GHS"),
    ])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("button", { name: "Add price" }))
    const dialog = await screen.findByRole("dialog")
    await user.selectOptions(within(dialog).getByLabelText("Asset"), "USDT")
    await user.selectOptions(within(dialog).getByLabelText("Currency"), "GHS")
    await user.type(within(dialog).getByLabelText(/Base rate/), "19")
    await user.click(within(dialog).getByRole("button", { name: "Continue" }))
    // The dialog captured the value; finish the audit chain to persist.
    await finishAuditChain(user)

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(mockSet).toHaveBeenCalledWith("pricing.assets.USDT.baseRates.GHS", {
      value: 19,
      scope: "global",
      scopeValue: null,
    })
  })
})
