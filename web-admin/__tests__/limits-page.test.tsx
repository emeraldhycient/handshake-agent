/**
 * LimitsPage test (design §6.26) — wired to real per-tier limit settings.
 *
 * The per-tier caps resolve from the `limits.NGN.<tier>.*` registry keys (GET
 * /admin/settings, mocked). Design rows the registry has no key for (Weekly max,
 * Single on-chain send max, and the extra velocity windows) render "—". Editing an
 * amount cap is maker-checker: the pencil opens a new-value prompt → reason → step-up
 * → maker-checker; approving overlays the new value onto the row (Phase-7 write is
 * local-only) and toasts. The api layer is mocked — no server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { EffectiveSetting } from "@handshake-agent/contracts"

import { LimitsPage } from "@/components/admin/limits-page"
import { defaultToastStore } from "@/lib/store/toast-store"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/config", () => ({
  listEffectiveSettings: vi.fn(),
}))

import { listEffectiveSettings } from "@/lib/api/config"

const mockList = vi.mocked(listEffectiveSettings)

// ─── Fixture ──────────────────────────────────────────────────────────────────

function limit(key: string, value: number): EffectiveSetting {
  return {
    key,
    category: "KYC",
    label: key,
    description: `Limit ${key}`,
    valueType: "number",
    editable: true,
    value,
    source: "default",
    scope: "global",
    scopeValue: null,
  }
}

// Only tier_1 needs real values for the assertions; the mapper handles missing tiers.
const LIMIT_SETTINGS: EffectiveSetting[] = [
  limit("limits.NGN.tier_1.perTxFiatMax", 200000),
  limit("limits.NGN.tier_1.dailyFiatMax", 500000),
  limit("limits.NGN.tier_1.dailyTxCountMax", 10),
]

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <LimitsPage />
    </QueryClientProvider>
  )
}

/** Drive the shared flow chain: reason → step-up (6 digits) → maker-checker. */
async function advanceThroughAuditChain(
  user: ReturnType<typeof userEvent.setup>
) {
  await user.type(
    screen.getByRole("textbox", { name: "Reason" }),
    "Ops correction"
  )
  await user.click(screen.getByRole("button", { name: "Continue" }))
  for (const d of "123456") {
    await user.click(screen.getByRole("button", { name: d }))
  }
}

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
  mockList.mockReset()
  mockList.mockResolvedValue(LIMIT_SETTINGS)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LimitsPage (wired maker-checker amount-cap edit)", () => {
  it("renders the tier tabs and the real per-tier caps", async () => {
    renderPage()

    expect(
      screen.getByRole("heading", { name: "Limits & velocity" })
    ).toBeInTheDocument()
    // The tier tabs render only after the settings resolve (data branch).
    expect(await screen.findByRole("tab", { name: "Tier 1" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    // The real per-transaction cap (200,000 → "₦200,000").
    expect(screen.getByText("₦200,000")).toBeInTheDocument()
    // The real daily cap (500,000 → "₦500,000").
    expect(screen.getByText("₦500,000")).toBeInTheDocument()
    // The real daily tx-count (10) is the one backed velocity row.
    expect(screen.getByText("10")).toBeInTheDocument()
  })

  it("updates the displayed cap + toasts after the edit is approved", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: "Edit Per-transaction max" })
    )

    const input = screen.getByRole("textbox", { name: "New value" })
    await user.clear(input)
    await user.type(input, "₦300,000")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    await advanceThroughAuditChain(user)

    await user.click(
      screen.getByRole("button", { name: "Submit for approval" })
    )

    // The row's displayed cap changed and the old value is gone.
    expect(screen.getByText("₦300,000")).toBeInTheDocument()
    expect(screen.queryByText("₦200,000")).not.toBeInTheDocument()

    // A feedback toast fired and the flow closed.
    expect(defaultToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({
        message: "Per-transaction max · Tier 1 → ₦300,000",
      })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("shows the error branch with a retry when the settings read fails", async () => {
    mockList.mockRejectedValueOnce(new Error("boom"))
    renderPage()

    expect(await screen.findByText("Failed to load limits")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })
})
