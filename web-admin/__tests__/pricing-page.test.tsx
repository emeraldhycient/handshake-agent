/**
 * PricingPage test (design §6.22) — wired to real pricing settings.
 *
 * The pricing figures resolve from `pricing.assets.<A>.buySpreadBps` /
 * `.sellSpreadBps` / `.baseRates.NGN` + the global `pricing.processingFeeBps` (GET
 * /admin/settings, mocked). Each priced asset contributes a Buy + Sell row; the
 * user-sees rate + operator margin are DERIVED from base rate + spread + fee. The Edit
 * pill opens the reason → step-up → maker-checker chain (submit is a Phase-7 stub).
 * The api layer is mocked — no server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { EffectiveSetting } from "@handshake-agent/contracts"

import { PricingPage } from "@/components/admin/pricing-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/config", () => ({
  listEffectiveSettings: vi.fn(),
}))

import { listEffectiveSettings } from "@/lib/api/config"

const mockList = vi.mocked(listEffectiveSettings)

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

beforeEach(() => {
  mockList.mockReset()
  mockList.mockResolvedValue(PRICING_SETTINGS)
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
})
