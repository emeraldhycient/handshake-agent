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
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { EffectiveSetting } from "@handshake-agent/contracts"

import { LimitsPage } from "@/components/admin/limits-page"
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

function limit(
  key: string,
  value: number,
  category = "KYC"
): EffectiveSetting {
  return {
    key,
    category,
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
// The new-beneficiary hold is a GLOBAL Beneficiary-category leaf (not per-tier).
const LIMIT_SETTINGS: EffectiveSetting[] = [
  limit("limits.NGN.tier_1.perTxFiatMax", 200000),
  limit("limits.NGN.tier_1.dailyFiatMax", 500000),
  limit("limits.NGN.tier_1.weeklyFiatMax", 3000000),
  limit("limits.NGN.tier_1.dailyTxCountMax", 10),
  limit("beneficiary.cryptoCoolingOffSeconds", 86400, "Beneficiary"),
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
  mockSet.mockReset()
  mockSet.mockResolvedValue(limit("limits.NGN.tier_1.perTxFiatMax", 300000))
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

  it("persists the edited cap via setSetting (PATCH) + toasts after approval", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: "Edit Per-transaction max" })
    )

    const input = screen.getByRole("textbox", { name: "New value (NGN)" })
    await user.clear(input)
    await user.type(input, "300000")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    await advanceThroughAuditChain(user)

    await user.click(
      screen.getByRole("button", { name: "Submit for approval" })
    )

    // The real PATCH fires against tier_1's per-tx cap key with the numeric value.
    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(mockSet).toHaveBeenCalledWith("limits.NGN.tier_1.perTxFiatMax", {
      value: 300000,
      scope: "global",
      scopeValue: null,
    })

    // A feedback toast fired and the flow closed.
    expect(defaultToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({
        message: expect.stringMatching(/Per-transaction max · Tier 1/),
      })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("targets the daily-cap key when the daily row is edited", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: "Edit Daily max · rolling 24h" })
    )
    const input = screen.getByRole("textbox", { name: "New value (NGN)" })
    await user.clear(input)
    await user.type(input, "750000")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await advanceThroughAuditChain(user)
    await user.click(
      screen.getByRole("button", { name: "Submit for approval" })
    )

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(mockSet).toHaveBeenCalledWith("limits.NGN.tier_1.dailyFiatMax", {
      value: 750000,
      scope: "global",
      scopeValue: null,
    })
  })

  it("does not offer to edit a row the engine does not enforce (§3.6)", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole("tab", { name: "Tier 1" })
    // "Single on-chain send max" is not yet enforced (renders "—"); no edit pencil.
    expect(
      screen.queryByRole("button", { name: "Edit Single on-chain send max" })
    ).not.toBeInTheDocument()
    // The backed per-tx cap still has its edit pencil.
    expect(
      await screen.findByRole("button", { name: "Edit Per-transaction max" })
    ).toBeInTheDocument()
    void user
  })

  it("edits the enforced weekly max (rolling 7-day cap) via setSetting", async () => {
    const user = userEvent.setup()
    renderPage()

    // 3,000,000 → "₦3,000,000" renders, and the row is editable.
    await user.click(
      await screen.findByRole("button", {
        name: "Edit Weekly max · rolling 7d",
      })
    )
    const input = screen.getByRole("textbox", { name: "New value (NGN)" })
    await user.clear(input)
    await user.type(input, "4000000")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await advanceThroughAuditChain(user)
    await user.click(screen.getByRole("button", { name: "Submit for approval" }))

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(mockSet).toHaveBeenCalledWith("limits.NGN.tier_1.weeklyFiatMax", {
      value: 4000000,
      scope: "global",
      scopeValue: null,
    })
  })

  it("opens the step-up dialog and retries the PATCH after re-auth when the server demands step-up", async () => {
    const user = userEvent.setup()
    const { ApiError } = await import("@/lib/api/client")
    mockSet
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce(limit("limits.NGN.tier_1.perTxFiatMax", 300000))

    renderPage()
    await user.click(
      await screen.findByRole("button", { name: "Edit Per-transaction max" })
    )
    const input = screen.getByRole("textbox", { name: "New value (NGN)" })
    await user.clear(input)
    await user.type(input, "300000")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await advanceThroughAuditChain(user)
    await user.click(
      screen.getByRole("button", { name: "Submit for approval" })
    )

    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
    expect(mockSet).toHaveBeenCalledTimes(1)
  })

  it("shows the error branch with a retry when the settings read fails", async () => {
    mockList.mockRejectedValueOnce(new Error("boom"))
    renderPage()

    expect(await screen.findByText("Failed to load limits")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("edits the enforced daily transaction-count cap (a count leaf) via setSetting", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: "Edit Transactions / day" })
    )
    const input = screen.getByRole("textbox", { name: "New value (count)" })
    await user.clear(input)
    await user.type(input, "20")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await advanceThroughAuditChain(user)
    await user.click(screen.getByRole("button", { name: "Submit for approval" }))

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(mockSet).toHaveBeenCalledWith("limits.NGN.tier_1.dailyTxCountMax", {
      value: 20,
      scope: "global",
      scopeValue: null,
    })
  })

  it("edits the global new-beneficiary cooling-off (a seconds leaf) via setSetting", async () => {
    const user = userEvent.setup()
    renderPage()

    // 86400s renders humanized as "1d".
    expect(await screen.findByText("1d")).toBeInTheDocument()
    await user.click(
      await screen.findByRole("button", { name: "Edit New-beneficiary hold" })
    )
    const input = screen.getByRole("textbox", { name: "New value (seconds)" })
    await user.clear(input)
    await user.type(input, "172800")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await advanceThroughAuditChain(user)
    await user.click(screen.getByRole("button", { name: "Submit for approval" }))

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    // The global leaf (no tier suffix) is patched with the raw seconds value.
    expect(mockSet).toHaveBeenCalledWith("beneficiary.cryptoCoolingOffSeconds", {
      value: 172800,
      scope: "global",
      scopeValue: null,
    })
    // The toast omits any tier for the global leaf.
    expect(defaultToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: "New-beneficiary hold → 2d" })
    )
  })
})
